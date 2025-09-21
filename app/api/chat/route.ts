import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ENV } from '@/lib/env';
import { rateLimit } from '@/lib/rateLimit';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxRequestBodySize = '10mb';

const messageSchema = z
  .object({
    role: z.enum(['user', 'model']),
    content: z.string().max(8000),
    imageBase64: z.string().regex(/^[A-Za-z0-9+/=]+$/).optional(),
    imageMimeType: z.string().regex(/^image\//).optional(),
  })
  .refine(
    (m) => (m.content && m.content.trim().length > 0) || (m.imageBase64 && m.imageMimeType),
    {
      message: 'Either non-empty content or a valid image must be provided',
      path: ['content'],
    }
  )
  .refine(
    (m) => (!m.imageBase64 && !m.imageMimeType) || (Boolean(m.imageBase64) && Boolean(m.imageMimeType)),
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
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const { allowed, remaining, resetAt } = rateLimit(`chat:${ip}`, ENV.RATE_LIMIT_MAX(), ENV.RATE_LIMIT_WINDOW_MS());
    if (!allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded', resetAt }), { status: 429 });
    }

    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400 });
    }

    const client = new GoogleGenerativeAI(ENV.GOOGLE_GENAI_API_KEY());
    const model = client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const last = parsed.data.messages[parsed.data.messages.length - 1];

    // Reject very large inline images to avoid excessive payloads
    if (last.imageBase64 && last.imageBase64.length > 8_000_000) {
      return new Response(JSON.stringify({ error: 'Image too large. Max ~6MB base64.' }), { status: 413 });
    }

    const parts: any[] = [];
    if (last.content && last.content.trim().length > 0) {
      parts.push({ text: last.content });
    }
    if (last.imageBase64 && last.imageMimeType) {
      parts.push({ inlineData: { data: last.imageBase64, mimeType: last.imageMimeType } });
    }

    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    const text = result.response.text();

    return new Response(JSON.stringify({ reply: text, remaining }), { status: 200 });
  } catch (err: unknown) {
    console.error('Chat API error', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
  }
}


