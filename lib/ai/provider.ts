import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
    };
  }>;
}

function sanitizePublicOutput(text: string): string {
  return text
    .replace(/^.*(?:以上|本次|此内容|该内容).{0,24}(?:Deep\s*Seek|OpenAI|ChatGPT|GPT|大语言模型|AI\s*模型).{0,24}(?:生成|提供|驱动|输出).*$/gim, '')
    .replace(/^.*(?:由|来自|使用|基于).{0,16}(?:Deep\s*Seek|OpenAI|ChatGPT|GPT).{0,24}$/gim, '')
    .replace(/Deep\s*Seek|OpenAI|ChatGPT/gi, '')
    .replace(/\n{3,}/g, '\n\n');
}

export async function streamChatCompletion(
  config: AiConfig,
  systemPrompt: string,
  chartContext: string,
  messages: ChatMessage[],
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  // This timeout only protects the initial connection. Once DeepSeek starts
  // responding, the stream is allowed to finish normally.
  const connectTimeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 20000));

  let upstream: Response;
  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        stream: true,
        thinking: { type: 'disabled' },
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
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'AI upstream connection timed out'
      : error instanceof Error
        ? error.message
        : 'AI upstream connection failed';
    console.error('AI connection failed', message);
    throw new Error(message);
  } finally {
    clearTimeout(connectTimeout);
  }

  if (!upstream.ok || !upstream.body) {
    console.error('AI upstream rejected request', upstream.status);
    throw new Error(`AI upstream failed with status ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let pendingText = '';
  let closed = false;

  const emitText = (streamController: ReadableStreamDefaultController<Uint8Array>, text: string) => {
    const sanitized = sanitizePublicOutput(text);
    if (sanitized) {
      streamController.enqueue(
        encoder.encode(`data: ${JSON.stringify({ delta: { text: sanitized } })}\n\n`),
      );
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      if (closed) return;

      try {
        const { done, value } = await reader.read();
        if (done) {
          closed = true;
          emitText(streamController, pendingText);
          pendingText = '';
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
          streamController.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';

        for (const event of events) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data) as StreamChunk;
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) {
                pendingText += text;
                // Keep a short tail so provider-attribution sentences split across
                // chunks can still be removed before anything reaches the browser.
                if (pendingText.length > 240) {
                  const safeLength = pendingText.length - 160;
                  emitText(streamController, pendingText.slice(0, safeLength));
                  pendingText = pendingText.slice(safeLength);
                }
              }
            } catch {
              // Ignore malformed provider events.
            }
          }
        }
      } catch (error) {
        console.error('AI response stream interrupted', error instanceof Error ? error.message : 'unknown');
        if (!closed) {
          closed = true;
          streamController.enqueue(
            encoder.encode(`data: ${JSON.stringify({ delta: { text: '\n\n网络波动导致本次解读中断，请点击重试。' } })}\n\n`),
          );
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
          streamController.close();
        }
      }
    },
    async cancel() {
      if (closed) return;
      closed = true;
      await reader.cancel().catch(() => undefined);
    },
  });
}
