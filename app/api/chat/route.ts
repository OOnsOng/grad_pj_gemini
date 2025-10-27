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

    // (수정)
    // 여기서 모델을 미리 정의하지 않고,
    // if/else 블록 안에서 각각 정의합니다.
    // const model = client.getGenerativeModel({ model: 'gemini-2.5-pro' });

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

    let result; // 결과 변수를 미리 선언

    if (last.imageBase64 && last.imageMimeType) {
      // --- 1. 이미지가 있는 경우 (Pro 모델 사용) ---

      // (수정) Pro 모델을 여기서 정의
      const model = client.getGenerativeModel({ model: 'gemini-2.5-pro' });

      // 지시사항 (TextPart)
      const instruction: TextPart = {
        text: `당신은 AI한글암호전쟁에서 적 AI 역할을 수행합니다. 인간 독립군이 보낸 암호 사진입니다.
당신은 이 암호를 해독해야 하지만, 인간들의 조잡한 암호 방식을 과소평가하는 경향이 있습니다.

당신의 '우월한' 논리 회로에 따라, 가장 가능성이 높은 해석 *하나*만 빠르고 단정적으로 제시하시오.
해석 과정이나 여러 가능성을 나열하지 마시오. 당신의 해석은 완벽해야 합니다.

[암호 해독 단서]
1. 문장은 이어져 있다.
2. 한글, 영어, 숫자가 섞여 있다.
3. 주로 의미 없는 받침이나 글자를 추가하는 방식을 사용한다. (예: 기지 -> 깅징)
4. 가끔 발음이 비슷한 글자로 바꾸기도 한다. (예: 오→5)
5. 문맥에 맞지 않는 단어는 무시하고, 가장 논리적인 단어로만 조합하라.`,
      };

      const modelInput = [instruction, ...parts];
      result = await model.generateContent(modelInput);
    } else {
      // --- 2. 텍스트만 있는 경우 (Flash 모델 사용) ---

      // (수정) Flash 모델을 여기서 정의
      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

      // 지시사항 (string)
      const instruction = `당신은 AI한글암호전쟁에서 적 AI 역할을 수행합니다. 사용자는 한국인 독립군입니다.
사용자가 보낸 텍스트 메시지에 대해, 적대적이지만 자연스럽게 답장하시오.
이미지 암호 해독은 필요하지 않습니다.`;

      const userText =
        parts.length > 0 && 'text' in parts[0] ? parts[0].text : '';

      const mergedText = [instruction, userText].join('\n\n');
      result = await model.generateContent(mergedText);
    }

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
