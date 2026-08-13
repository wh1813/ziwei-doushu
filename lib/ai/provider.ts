import type { AiConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export async function streamChatCompletion(
  config: AiConfig,
  systemPrompt: string,
  chartContext: string,
  messages: ChatMessage[],
): Promise<ReadableStream<Uint8Array>> {
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

    if (!upstream.ok) {
      console.error('AI upstream rejected request', upstream.status);
      throw new Error(`AI upstream failed with status ${upstream.status}`);
    }

    const result = await upstream.json() as CompletionResponse;
    const content = result.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('AI upstream returned an empty response');

    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.enqueue(
          encoder.encode(`data: ${JSON.stringify({ delta: { text: content } })}\n\n`),
        );
        streamController.enqueue(encoder.encode('data: [DONE]\n\n'));
        streamController.close();
      },
    });
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
