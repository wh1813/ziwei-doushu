export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export function getAiConfig(): AiConfig {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) throw new Error('AI service is not configured');

  const rawBaseUrl = process.env.AI_BASE_URL?.trim() || 'https://api.deepseek.com';
  const baseUrl = rawBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const maxOutputTokens = Number.parseInt(process.env.AI_MAX_OUTPUT_TOKENS || '1800', 10);
  const timeoutMs = Number.parseInt(process.env.AI_TIMEOUT_MS || '90000', 10);

  return {
    baseUrl,
    apiKey,
    model: process.env.AI_MODEL?.trim() || 'deepseek-chat',
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? Math.min(Math.max(maxOutputTokens, 256), 4096) : 1800,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 5000), 120000) : 90000,
  };
}
