import { getCloudflareContext } from '@opennextjs/cloudflare';
import { buildChartContext, isChartLike } from '@/lib/ai/chart-context';
import { getAiConfig } from '@/lib/ai/config';
import { streamChatCompletion, type ChatMessage } from '@/lib/ai/provider';
import { SYSTEM_PROMPT } from '@/lib/ai/prompt';
import { writeQueryLog } from '@/lib/logging/query-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 96 * 1024;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1000;

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function normalizeMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const result: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > MAX_MESSAGE_CHARS) return null;
    result.push({ role, content: trimmed });
  }
  return result;
}

function normalizeSessionId(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(value)) return value;
  return crypto.randomUUID();
}

async function isRateLimited(request: Request): Promise<boolean> {
  try {
    const { env } = getCloudflareContext();
    const limiter = (env as unknown as { AI_RATE_LIMITER?: RateLimiter }).AI_RATE_LIMITER;
    if (!limiter) return false;
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return errorResponse('请求内容过大', 413);
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return errorResponse('仅支持 JSON 请求', 415);
  }
  if (await isRateLimited(request)) return errorResponse('请求过于频繁，请稍后再试', 429);

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return errorResponse('请求内容过大', 413);
    body = JSON.parse(raw);
  } catch {
    return errorResponse('请求格式无效', 400);
  }

  if (!body || typeof body !== 'object') return errorResponse('请求格式无效', 400);
  const { chart, messages, sessionId } = body as {
    chart?: unknown;
    messages?: unknown;
    sessionId?: unknown;
  };
  const normalizedMessages = normalizeMessages(messages);
  if (!isChartLike(chart) || !normalizedMessages) return errorResponse('命盘或对话内容无效', 400);

  const startedAt = Date.now();
  const chartContext = buildChartContext(chart);
  const question = [...normalizedMessages].reverse().find(message => message.role === 'user')?.content || '';
  const logId = crypto.randomUUID();
  const normalizedSessionId = normalizeSessionId(sessionId);
  const country = request.headers.get('cf-ipcountry');

  try {
    const completion = await streamChatCompletion(
      getAiConfig(),
      SYSTEM_PROMPT,
      chartContext,
      normalizedMessages,
    );
    await writeQueryLog({
      id: logId,
      sessionId: normalizedSessionId,
      question,
      answer: completion.content,
      chartSummary: chartContext,
      status: 'success',
      errorMessage: null,
      durationMs: Date.now() - startedAt,
      country,
    });
    return new Response(completion.stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    await writeQueryLog({
      id: logId,
      sessionId: normalizedSessionId,
      question,
      answer: null,
      chartSummary: chartContext,
      status: 'error',
      errorMessage,
      durationMs: Date.now() - startedAt,
      country,
    });
    console.error('AI interpretation request failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
