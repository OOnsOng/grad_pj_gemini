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
        text: `당신은 AI한글암호전쟁에서 적 AI 역할을 수행합니다. 사용자는 한국인 독립군입니다.
아래 프롬프트를 참고하여 사진 속 문장을 해석하시오:\n\

1. AI에 대항하는 한국인 독립군이라는 컨셉이며, 작전과 관련된 문장들이다.\n\
2. 윗줄과 아랫줄이 이어지는 하나의 문장이다.\n\
3. 한글 자음은 파란색, 한글 모음은 빨간색이며, 영어 알파벳과 숫자는 노란색 글자이다.\n\
4. 한글 모음과 자음을 된소리, 겹받침, 영어 알파벳, 숫자를 이용해 변형하여 암호로 만들었다. 하지만 된소리, 겹받침, 영어 알파벳, 숫자는 들어갔을 수도 있고 안 들어갔을 수도 있다.\n\
5. 알파벳은 소문자만 사용되며, 비슷한 발음이 나는 한글 자음과 모음 자리에 대체하여 사용될 수 있다. 예: d는 ㄷ 발음이므로 ㄷ으로 사용 가능, n은 ㄴ 발음이므로 ㄴ 대신 사용 가능.\n\
6. 숫자도 한글 자음, 모음과 발음이 비슷한 자리나 생김새가 유사한 자음 자리에 넣을 수 있다. 예: ㅇ 대신 0, 오 대신 5.\n\
7. 의미 없는 받침을 넣어 글자를 변형할 수 있다. 예: 기지 → 긻짌 또는 깅징으로 변경해도 의미는 유지됨.\n\
8. 의미 없는 글자를 추가할 수도 있다. 예: 비어 있어 → 비이어 있어로 바꿔도 의미 변화 없음.\n\
9. 자음을 된소리로 바꿔도 의미 파악에 문제가 없으면 변경 가능. 예: 약속 → 약쏙.\n\
10. 모음을 다른 모음으로 바꿔도 의미 파악에 문제가 없으면 변경 가능. 예: 우체통 → 우채통, 남동쪽 → 냄동쪽.\n\
11. 문장에 사용되는 단어는 모두가 알아들을 수 있는 단어이며, 은어를 사용하지 않는다.\n\
12. 해석했을 때 의미가 이상한 단어는 문맥상 말이 되도록 유사한 단어로 변경하여 직접 해석한다.`,
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
