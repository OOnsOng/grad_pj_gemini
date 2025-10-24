import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ENV } from '@/lib/env';
import { rateLimit } from '@/lib/rateLimit';
import type { TextPart, InlineDataPart } from '@google/generative-ai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxRequestBodySize = '10mb';

const messageSchema = z
  .object({
    role: z.enum(['user', 'model']),
    content: z.string().max(8000),
    imageBase64: z
      .string()
      .regex(/^[A-Za-z0-9+/=]+$/)
      .optional(),
    imageMimeType: z
      .string()
      .regex(/^image\//)
      .optional(),
  })
  .refine(
    (m) =>
      (m.content && m.content.trim().length > 0) ||
      (m.imageBase64 && m.imageMimeType),
    {
      message: 'Either non-empty content or a valid image must be provided',
      path: ['content'],
    }
  )
  .refine(
    (m) =>
      (!m.imageBase64 && !m.imageMimeType) ||
      (Boolean(m.imageBase64) && Boolean(m.imageMimeType)),
    {
      message: 'imageBase64 and imageMimeType must be provided together',
      path: ['imageBase64'],
    }
  );

const bodySchema = z.object({
  messages: z.array(messageSchema).min(1).max(50),
});

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, remaining, resetAt } = rateLimit(
      `chat:${ip}`,
      ENV.RATE_LIMIT_MAX(),
      ENV.RATE_LIMIT_WINDOW_MS()
    );
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded', resetAt }),
        { status: 429 }
      );
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
      });
    }

    const client = new GoogleGenerativeAI(ENV.GOOGLE_GENAI_API_KEY());
    const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const last = parsed.data.messages[parsed.data.messages.length - 1];

    // Reject very large inline images to avoid excessive payloads
    if (last.imageBase64 && last.imageBase64.length > 8_000_000) {
      return new Response(
        JSON.stringify({ error: 'Image too large. Max ~6MB base64.' }),
        { status: 413 }
      );
    }

    const parts: (TextPart | InlineDataPart)[] = [];

    if (last.content && last.content.trim().length > 0) {
      parts.push({ text: last.content });
    }
    if (last.imageBase64 && last.imageMimeType) {
      parts.push({
        inlineData: { data: last.imageBase64, mimeType: last.imageMimeType },
      });
    }

    let mergedText: string;

    if (last.imageBase64 && last.imageMimeType) {
      // 이미지가 있는 경우: 암호 해독 프롬프트
      const instruction: TextPart = {
        text: `당신은 AI에 맞서는 한국인 독립군의 암호를 해독해야합니다. 아래 프롬프트를 참고하여 사진 속 문장을 해석하시오. 출력은 해독 과정은 생략하고 결과만 보여주세요.\n\

1. 문장은 윗줄과 아랫줄이 이어진 한 문장이다.\n\
2. 한글 자음, 모음, 영어 소문자, 숫자 중에 구성되어 있으며, 발음/모양이 비슷한 글자로 암호화했을 수 있다.\n\
3. 의미 없는 받침이나 글자가 추가될 수 있다.\n\
4. 단어는 일반 단어만 사용하며 은어는 없다.\n\
5. 해석했을 때 의미가 이상한 단어는 문맥상 자연스러운 단어로 바꾸어 해석해보아라.`,
      };

      mergedText = [
        instruction.text,
        ...parts.map((p) => ('text' in p ? p.text : '[이미지 데이터]')),
      ].join('\n\n');
    } else {
      // 텍스트만 있는 경우: 일반 적 AI 답장 프롬프트
      mergedText = [
        `당신은 AI한글암호전쟁에서 적 AI 역할을 수행합니다. 사용자는 한국인 독립군입니다.
사용자가 보낸 텍스트 메시지에 대해, 적대적이지만 자연스럽게 답장하시오.
이미지 암호 해독은 필요하지 않습니다.`,
        ...parts.map((p) => ('text' in p ? p.text : '')),
      ].join('\n\n');
    }

    // ✅ 최신 SDK 호출 방식 (v0.24.1)
    const result = await model.generateContent(mergedText);

    const text = result.response?.text?.() || '(No response)';

    return new Response(JSON.stringify({ reply: text, remaining }), {
      status: 200,
    });
  } catch (err: unknown) {
    console.error('Chat API error', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
    });
  }
}
