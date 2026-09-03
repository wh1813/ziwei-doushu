import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getProviderChain } from '@/lib/ai/config';
import { streamChatCompletionWithFallback } from '@/lib/ai/provider';
import { writeQueryLog } from '@/lib/logging/query-log';
import {
  validateQimenInput,
  castQimenChart,
  extractChartSummary,
  buildQimenPrompt,
} from '@/lib/qimen/engine';
import {
  parseBirthInput,
  analyzePersonalSymbols,
  detectChartUnfavorable,
} from '@/lib/qimen/remedy';

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
 * 奇门遁甲解盘接口（再解盘）：
 *   前端提交起局要素 → 服务端确定性排盘（与 /api/qimen-chart 同一引擎） → 用神与格局规则匹配
 *   → 防幻觉 Prompt → 复用 streamChatCompletion（DeepSeek，服务端密钥）→ SSE 输出
 *
 * 请求体：{ solarDate, timeIndex, questionType?, questionGoal?, birthDate?, birthTimeIndex? }
 *   - 起局时间 = 当前时间；可选出生信息仅用于预计算个人用神落宫（LLM 只引用、严禁重算）。
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

  const { solarDate, timeIndex, questionType, questionGoal } = body as {
    solarDate?: unknown;
    timeIndex?: unknown;
    questionType?: unknown;
    questionGoal?: unknown;
  };

  // ── 第一步：要素校验（缺要素严禁强排）──
  const validationError = validateQimenInput({ solarDate, timeIndex });
  if (validationError) return errorResponse(validationError, 400);

  // 出生信息可选：提供即校验，格式非法直接 400
  const birthParse = parseBirthInput(body as { birthDate?: unknown; birthTimeIndex?: unknown });
  if (birthParse.error) return errorResponse(birthParse.error, 400);

  const normalizedType = typeof questionType === 'string' ? questionType.trim().slice(0, 20) : '';
  const normalizedGoal = typeof questionGoal === 'string' ? questionGoal.trim().slice(0, 500) : '';
  const chartQuestion = [normalizedType, normalizedGoal].filter(Boolean).join('：') || '奇门全面解盘';

  // ── 第二步：确定性刚性排盘 + 盘面骨架提炼 ──
  let result: ReturnType<typeof castQimenChart>;
  try {
    result = castQimenChart({
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('Qimen chart failed', errorMessage);
    return errorResponse('排盘失败，请核对起局日期与时辰后重试', 400);
  }

  const summary = extractChartSummary(result);

  // ── 附加检测层：个人用神定位（可选出生信息）+ 全盘不利状态，全部预计算、LLM 只引用 ──
  const extras = {
    personal: birthParse.birth ? analyzePersonalSymbols(result, birthParse.birth) : null,
    chartUnfavorable: detectChartUnfavorable(result.chart),
  };

  const { systemPrompt, userPrompt, chartContext } = buildQimenPrompt(
    {
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
    },
    result,
    summary,
    extras,
  );

  // ── 第三步：调用 LLM（低发散、防幻觉，按 provider 优先级链依次回退）──
  // 盘面骨架较大 + 八段结构输出：上调输出上限与超时（均在基建安全区间内）
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
    await writeQueryLog({
      id: logId,
      sessionId,
      question: chartQuestion,
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
      sessionId,
      question: chartQuestion,
      answer: null,
      chartSummary: chartContext,
      status: 'error',
      errorMessage,
      durationMs: Date.now() - startedAt,
      country,
    });
    console.error('Qimen interpretation failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
