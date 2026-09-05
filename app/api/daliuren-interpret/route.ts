import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getProviderChain } from '@/lib/ai/config';
import { streamChatCompletionWithFallback } from '@/lib/ai/provider';
import { writeQueryLog } from '@/lib/logging/query-log';
import { sanitizeDivinationOutput } from '@/lib/divination/sanitize';
import {
  validateDaliurenInput,
  castDaliurenChart,
  extractChartSummary,
  buildDaliurenPrompt,
  type DaliurenInput,
} from '@/lib/daliuren/engine';
import { updateDaliurenRecordInterpret } from '@/lib/daliuren/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
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

/**
 * 大六壬解课接口（再解课）：
 *   前端提交起课要素 → 服务端确定性起课（与 /api/daliuren-chart 同一引擎）→
 *   防幻觉 Prompt → 复用 streamChatCompletion（OpenRouter 模型链）→ SSE 输出
 *
 * 请求体：{ solarDate, timeIndex, questionType?, questionGoal?, gender?, recordId? }
 *   - 起课时间 = 当前时间（求测者起心动念那一刻）
 *   - 可选 recordId = /api/daliuren-chart 返回的起课记录 id：解课成功后 best-effort 回填
 *     interpret_text 至该 D1 记录；非法或缺失时跳过，不影响解课。
 * 要素缺失时返回 400 + 具体缺失文案（NEED_CLARIFICATION 语义），严禁强排。
 */
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

  const {
    solarDate,
    timeIndex,
    questionType,
    questionGoal,
    gender,
    recordId,
  } = body as Record<string, unknown>;
  const interpretRecordId = typeof recordId === 'string' && recordId.trim() ? recordId.trim() : null;

  // ── 第一步：要素校验（缺要素严禁强排）──
  const validation = validateDaliurenInput({ solarDate: typeof solarDate === "string" ? solarDate : String(solarDate), timeIndex: typeof timeIndex === "number" ? timeIndex : -1 });
  if (!validation.ok) return errorResponse(typeof validation.error === 'string' ? validation.error : '起课要素不合法', 400);

  const normalizedType = typeof questionType === 'string' ? questionType.trim().slice(0, 20) : '';
  const normalizedGoal = typeof questionGoal === 'string' ? questionGoal.trim().slice(0, 500) : '';
  const normalizedGender =
    gender === '男' || gender === '女' || gender === '不指定' ? gender : '不指定';
  const chartQuestion = [normalizedType, normalizedGoal].filter(Boolean).join('：') || '大六壬解课';

  // ── 第二步：确定性刚性起课 + 课体骨架提炼 ──
  let result: ReturnType<typeof castDaliurenChart>;
  try {
    const input: DaliurenInput = {
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
      gender: normalizedGender,
    };
    result = castDaliurenChart(input);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('Daliuren chart failed', errorMessage);
    return errorResponse('起课失败，请核对起课日期与时辰后重试', 400);
  }

  const summary = extractChartSummary(result);
  const { systemPrompt, userPrompt, chartContext } = buildDaliurenPrompt(
    {
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
      gender: normalizedGender,
    },
    result,
    summary,
  );

  // ── 第三步：调用 LLM（按 provider 优先级链依次回退）──
  const chain = getProviderChain().map((config) => ({
    ...config,
    maxOutputTokens: Math.max(config.maxOutputTokens, 3000),
    timeoutMs: Math.max(config.timeoutMs, 30000),
  }));

  const startedAt = Date.now();
  const logId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const country = request.headers.get('cf-ipcountry');

  try {
    const completion = await streamChatCompletionWithFallback(
      chain,
      systemPrompt,
      chartContext,
      [{ role: 'user', content: userPrompt }],
    );
    const cleaned = sanitizeDivinationOutput(completion.content);
    await writeQueryLog({
      id: logId,
      sessionId,
      question: chartQuestion,
      answer: cleaned,
      chartSummary: chartContext,
      status: 'success',
      errorMessage: null,
      durationMs: Date.now() - startedAt,
      country,
    });
    if (interpretRecordId) {
      await updateDaliurenRecordInterpret(interpretRecordId, cleaned);
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: { text: cleaned } })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(stream, {
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
      sessionId,
      question: chartQuestion,
      answer: null,
      chartSummary: chartContext,
      status: 'error',
      errorMessage,
      durationMs: Date.now() - startedAt,
      country,
    });
    console.error('Daliuren interpretation failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
