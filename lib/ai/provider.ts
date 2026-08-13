import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

export async function streamChatCompletion(
  config: AiConfig,
  systemPrompt: string,
  chartContext: string,
  messages: ChatMessage[],
): Promise<ReadableStream<Uint8Array>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let upstream: Response;

  try {
    upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
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
    clearTimeout(timeout);
    throw error;
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    console.error('AI upstream rejected request', upstream.status);
    throw new Error(`AI upstream failed with status ${upstream.status}`);
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let finished = false;

  const finish = (streamController: ReadableStreamDefaultController<Uint8Array>, message?: string) => {
    if (finished) return;
    finished = true;
    if (message) {
      streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: message } })}\n\n`));
    }
    streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
    streamController.close();
    clearTimeout(timeout);
  };

  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish(streamController);
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
                streamController.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ delta: { text } })}\n\n`),
                );
              }
            } catch {
              // Ignore malformed provider events.
            }
          }
        }
      } catch (error) {
        console.error('AI response stream ended early', error instanceof Error ? error.message : 'unknown');
        finish(streamController, '\n\n解读响应超时，请稍后重试。');
      }
    },
    async cancel() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    },
  });
}
