import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ENV } from '@/lib/env';
import { rateLimit } from '@/lib/rateLimit';
import type { TextPart, InlineDataPart } from '@google/generative-ai';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxRequestBodySize = '10mb';

// ------------------ 메시지 검증 ------------------
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

// ------------------ POST 핸들러 ------------------
export async function POST(req: NextRequest) {
  try {
    // ------------------ Rate limit ------------------
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

    // ------------------ 요청 검증 ------------------
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
      });
    }

    const client = new GoogleGenerativeAI(ENV.GOOGLE_GENAI_API_KEY());
    const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const last = parsed.data.messages[parsed.data.messages.length - 1];

    // ------------------ 이미지 용량 체크 ------------------
    if (last.imageBase64 && last.imageBase64.length > 8_000_000) {
      return new Response(
        JSON.stringify({ error: 'Image too large. Max ~6MB base64.' }),
        { status: 413 }
      );
    }

    // ------------------ 시스템 메시지 (미리 설정된 프롬프트) ------------------
    const systemMessage = {
      role: 'system',
      parts: [
        {
          text: '아래의 프롬프트를 참고하여 사진의 문장을 해석해보아라. 1. ai에 대항하는 한국인 독립군이라는 컨셉이며, 작전과 관련된 문장들이다. 2. 윗줄과 아랫줄이 이어지는 한 문장이다. 3. 한글 모음과 자음을 된소리, 겹받침, 영어 알파벳, 숫자를 이용해서 변형하여 암호로 만든 것이다. 하지만 된소리, 겹받침, 영어 알파벳, 숫자는 들어갔을 수도 있고 안들어갔을 수도 있다. 4. 알파벳은 소문자만 사용되었으며, 비슷한 발음이 나는 한글 자음과 모음 자리를 대체하여 사용된다. 암호 변경 예시는 이러하다. ‘d’는 ‘ㄷ’ 발음이 나므로 ‘ㄷ’으로 사용이 가능하고, ‘n’은 ‘ㄴ’ 발음이 나므로 ‘ㄴ’ 대신 사용할 수 있다. 5. 숫자도 한글 자음, 모음과 발음이 비슷한 자리에 대신 넣거나, 생김새가 유사한 자음 자리에 넣을 수 있다. 예시로는 ‘ㅇ’ 대신 생김새가 유사한 ‘0’을 사용하거나, ‘오’ 대신에 발음이 비슷한 ‘5’를 넣어 변형할 수 있다. 6. 의미없는 받침을 넣어서 글자를 변형했을 수 있다. 예를 들면, ‘기지’는 ‘긻짌’으로 변경하거나 ‘깅징’으로 변경해도 ‘기지’라는 의미가 크게 변질되지 않기 때문에 받침을 넣어 변형했을 수 있다. 7. 의미없는 글자를 추가하기도 한다. 예를 들면, ‘비어 있어’를 ‘비이어 있어’로 변경해도 ‘비어 있다’라는 의미는 바뀌지 않는다. 이처럼 의미가 부여되지 않는 글자를 추가하여 변형하기도 한다. 8. 자음을 된소리로 바꾸어도 의미에 문제가 없다면 변경하여 사용하기도 한다. 예를 들면, ‘약속’을 ‘약쏙’으로 바꾸어도 읽는데 크게 문제가 없으며, 의미는 바뀌지 않는다. 9.모음을 다른 모음으로 변경하여 사용하기도 한다. 예를 들어, ‘우체통’을 ‘우채통’으로 변경하여도 의미는 같고, ‘남동쪽’을 ‘냄동쪽’으로 변경하여도 의미를 파악하는데 크게 문제가 없기 때문에 이런식으로 변형하기도 한다. 10. 문장에 사용되는 단어는, 모두가 알아들을 수 있는 단어이며, 은어를 사용하지는 않는다. 11. 해석했을 때 의미가 이상한 단어는 문맥상 말이 되도록 유사한 단어로 변경하여 직접 해석해보아라.',
        },
      ] as TextPart[],
    };

    // ------------------ 사용자 메시지 파트 ------------------
    const userParts: (TextPart | InlineDataPart)[] = [];
    if (last.content && last.content.trim().length > 0) {
      userParts.push({ text: last.content });
    }
    if (last.imageBase64 && last.imageMimeType) {
      userParts.push({
        inlineData: { data: last.imageBase64, mimeType: last.imageMimeType },
      });
    }

    // ------------------ 모델 호출 ------------------
    const result = await model.generateContent({
      contents: [
        systemMessage, // ✅ 미리 정의된 프롬프트
        { role: 'user', parts: userParts }, // 사용자 입력
      ],
    });

    const text = result.response.text();

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
