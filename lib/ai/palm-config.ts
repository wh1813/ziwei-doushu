export interface PalmAiConfig {
  geminiApiKey: string;
  geminiModel: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  maxOutputTokens: number;
}

/**
 * 读取手相功能的 AI 配置。全部来自服务端环境变量/绑定，前端不可见。
 * 与现有 /api/interpret 的 lib/ai/config 风格一致；此处前缀多用 PALM_ 以隔离两个功能。
 */
export function getPalmAiConfig(env: Record<string, unknown>): PalmAiConfig {
  return {
    geminiApiKey: str(env.PALM_GEMINI_API_KEY) || str(env.GEMINI_API_KEY) || '',
    geminiModel: str(env.PALM_GEMINI_MODEL) || 'gemini-2.5-flash',
    deepseekApiKey: str(env.PALM_DEEPSEEK_API_KEY) || str(env.AI_API_KEY) || '',
    deepseekBaseUrl: str(env.PALM_DEEPSEEK_BASE_URL) || str(env.AI_BASE_URL) || 'https://api.deepseek.com',
    deepseekModel: str(env.PALM_DEEPSEEK_MODEL) || str(env.AI_MODEL) || 'deepseek-v4-flash',
    maxOutputTokens: num(env.PALM_MAX_OUTPUT_TOKENS) || num(env.AI_MAX_OUTPUT_TOKENS) || 1800,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : undefined;
}