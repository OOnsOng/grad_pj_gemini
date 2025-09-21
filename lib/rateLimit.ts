type Bucket = { tokens: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, max: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    const fresh: Bucket = { tokens: max - 1, resetAt };
    buckets.set(key, fresh);
    return { allowed: true, remaining: fresh.tokens, resetAt };
  }
  if (bucket.tokens <= 0) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.tokens -= 1;
  return { allowed: true, remaining: bucket.tokens, resetAt: bucket.resetAt };
}


