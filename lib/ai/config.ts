export interface AiConfig {
  providerId: 'openrouter' | 'sensenova' | 'deepseek';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

/**
 * Provider 回退链（按序尝试，任一成功即返回）：
 *   1. OpenRouter 免费模型（优先；限免额度按序回退）
 *   2. 商汤日日新免费档（glm-5.2 限流较紧，deepseek-v4-flash 较宽松）
 *   3. 原有 AI_API_KEY（DeepSeek 兼容网关）兜底
 */

const OPENROUTER_DEFAULT_MODELS = [
  'minimax/minimax-m3:free',
  'z-ai/glm-5.2:free',
  'google/gemma-4-31b-it:free',
];

const SENSENOVA_DEFAULT_MODELS = ['glm-5.2', 'deepseek-v4-flash', 'deepseek-v4-pro'];

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const SENSENOVA_BASE_URL = 'https://token.sensenova.cn/v1';

function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw || '', 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function parseModels(raw: string | undefined, fallback: string[]): string[] {
  const list = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

function normalizedBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

function buildConfigs(
  providerId: AiConfig['providerId'],
  apiKey: string,
  baseUrl: string,
  models: string[],
  maxOutputTokens: number,
  timeoutMs: number,
): AiConfig[] {
  return models.map((model) => ({ providerId, baseUrl, apiKey, model, maxOutputTokens, timeoutMs }));
}

/** 按优先级组装 provider 链：OpenRouter → 商汤日日新 → 原 DeepSeek 兜底。未配置的 provider 自动跳过。 */
export function getProviderChain(): AiConfig[] {
  const maxOutputTokens = intEnv(process.env.AI_MAX_OUTPUT_TOKENS, 1000, 256, 4096);
  const timeoutMs = intEnv(process.env.AI_TIMEOUT_MS, 25000, 5000, 30000);
  const chain: AiConfig[] = [];

  const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouterKey) {
    chain.push(
      ...buildConfigs(
        'openrouter',
        openrouterKey,
        OPENROUTER_BASE_URL,
        parseModels(process.env.OPENROUTER_MODELS, OPENROUTER_DEFAULT_MODELS),
        maxOutputTokens,
        timeoutMs,
      ),
    );
  }

  const sensenovaKey = process.env.SENSENOVA_API_KEY?.trim();
  if (sensenovaKey) {
    chain.push(
      ...buildConfigs(
        'sensenova',
        sensenovaKey,
        SENSENOVA_BASE_URL,
        parseModels(process.env.SENSENOVA_MODELS, SENSENOVA_DEFAULT_MODELS),
        maxOutputTokens,
        timeoutMs,
      ),
    );
  }

  const legacyKey = process.env.AI_API_KEY?.trim();
  if (legacyKey) {
    const rawBaseUrl = process.env.AI_BASE_URL?.trim() || 'https://api.deepseek.com';
    chain.push({
      providerId: 'deepseek',
      baseUrl: normalizedBaseUrl(rawBaseUrl),
      apiKey: legacyKey,
      model: process.env.AI_MODEL?.trim() || 'deepseek-v4-flash',
      maxOutputTokens,
      timeoutMs,
    });
  }

  return chain;
}

/** 兼容旧调用：返回链首配置；链为空（无任何密钥）时抛错。 */
export function getAiConfig(): AiConfig {
  const chain = getProviderChain();
  if (chain.length === 0) throw new Error('AI service is not configured');
  return chain[0];
}
