import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionResult {
  content: string;
  stream: ReadableStream<Uint8Array>;
  /** 实际服务的 provider（fallback 命中后用于日志/观测） */
  providerId?: AiConfig['providerId'];
  model?: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

function sanitizePublicOutput(text: string): string {
  return text
    .replace(/^.*(?:以上|本次|此内容|该内容).{0,32}(?:Deep\s*Seek|OpenAI|ChatGPT|GPT|大语言模型|AI\s*模型).{0,32}(?:生成|提供|驱动|输出).*$/gim, '')
    .replace(/^.*(?:由|来自|使用|基于).{0,20}(?:Deep\s*Seek|OpenAI|ChatGPT).{0,32}$/gim, '')
    .replace(/Deep\s*Seek|OpenAI|ChatGPT/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 单 provider 同步补全（非流式上游 → 包装为伪 SSE）。
 * `thinking` 参数仅对 DeepSeek 兼容网关附加（OpenRouter/商汤的 OpenAI 兼容接口不识别该字段）。
 */
export async function streamChatCompletion(
  config: AiConfig,
  systemPrompt: string,
  chartContext: string,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        ...(config.providerId === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
        max_tokens: config.maxOutputTokens,
        temperature: 0.5,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: `以下是程序已计算好的命盘上下文。不得自行改盘：\n\n${chartContext}` },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });

    if (!upstream.ok) {
      console.error('AI upstream rejected request', upstream.status, config.providerId, config.model);
      throw new Error(`AI upstream failed with status ${upstream.status}`);
    }

    const result = await upstream.json() as CompletionResponse;
    const rawContent = result.choices?.[0]?.message?.content?.trim();
    if (!rawContent) throw new Error('AI upstream returned an empty response');
    const content = sanitizePublicOutput(rawContent);
    if (!content) throw new Error('AI response was removed by output policy');

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ delta: { text: content } })}\n\n`),
        );
        streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
        streamController.close();
      },
    });

    return { content, stream, providerId: config.providerId, model: config.model };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'AI upstream timed out'
      : error instanceof Error
        ? error.message
        : 'AI upstream failed';
    console.error('AI completion failed', message);
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 按优先级依次尝试 provider 链（链序由 lib/ai/config 的 getProviderChain 决定：
 * OpenRouter 免费模型 → 商汤日日新免费档 → 原 DeepSeek 兜底），任一成功立即返回；
 * 全部失败时抛出聚合错误（含每个 provider 的失败原因，便于排查限流/超时）。
 */
export async function streamChatCompletionWithFallback(
  configs: AiConfig[],
  systemPrompt: string,
  chartContext: string,
  messages: ChatMessage[],
): Promise<ChatCompletionResult> {
  if (configs.length === 0) throw new Error('AI service is not configured');
  const failures: string[] = [];
  for (const config of configs) {
    try {
      return await streamChatCompletion(config, systemPrompt, chartContext, messages);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      failures.push(`[${config.providerId}/${config.model}] ${message}`);
      console.warn(`AI provider failed, trying next`, `${config.providerId}/${config.model}:`, message);
    }
  }
  throw new Error(`All AI providers failed: ${failures.join(' | ')}`);
}
