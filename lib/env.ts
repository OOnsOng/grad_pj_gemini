export function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const ENV = {
  GOOGLE_GENAI_API_KEY: () => getEnv('GOOGLE_GENAI_API_KEY'),
  RATE_LIMIT_WINDOW_MS: () => Number(getEnv('RATE_LIMIT_WINDOW_MS', '60000')),
  RATE_LIMIT_MAX: () => Number(getEnv('RATE_LIMIT_MAX', '30')),
};


