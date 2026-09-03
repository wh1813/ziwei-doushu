import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getAiConfig } from '@/lib/ai/config';
import { streamChatCompletion } from '@/lib/ai/provider';
import { writeQueryLog } from '@/lib/logging/query-log';
import {
  validateTianjiInput,
  castAstrolabe,
  extractNatalSummary,
  checkTianjiPatterns,
  buildTianjiPrompt,
  type TianjiInput,
} from '@/lib/tianji/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 8 * 1024;
const MAX_QUESTION_CHARS = 500;

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
 * 天纪深度解读接口：
 *   前端只提交出生要素与咨询意图 → 服务端 iztro 确定性排盘 → 天纪格局规则匹配
 *   → 防幻觉 Prompt → 复用 streamChatCompletion（DeepSeek，服务端密钥）→ SSE 输出
 *
 * 请求体：{ solarDate, timeIndex, gender, question? }
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

  const { solarDate, timeIndex, gender, question } = body as {
    solarDate?: unknown;
    timeIndex?: unknown;
    gender?: unknown;
    question?: unknown;
  };

  // ── 第一步：要素校验（缺要素严禁强排）──
  const validationError = validateTianjiInput({ solarDate, timeIndex, gender });
  if (validationError) return errorResponse(validationError, 400);

  const normalizedQuestion =
    typeof question === 'string' && question.trim().length > 0 && question.trim().length <= MAX_QUESTION_CHARS
      ? question.trim()
      : '';

  // ── 第二步：确定性刚性排盘（iztro）──
  let astrolabe: any;
  try {
    astrolabe = castAstrolabe({
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      gender: gender as '男' | '女',
    });
  } catch {
    return errorResponse('排盘失败，请核对出生日期、时辰与性别后重试', 400);
  }

  const summary = extractNatalSummary(astrolabe);
  const patterns = checkTianjiPatterns(astrolabe);
  const { systemPrompt, userPrompt, chartContext } = buildTianjiPrompt(
    { solarDate: solarDate as string, timeIndex: timeIndex as number, gender: gender as '男' | '女', question: normalizedQuestion },
    summary,
    patterns,
  );

  // ── 第三步：调用 LLM（低发散、防幻觉，复用现有流式基建）──
  const baseConfig = getAiConfig();
  // 深度解读篇幅更长：上调输出上限与超时（均在基建安全区间内）
  const tianjiConfig = {
    ...baseConfig,
    maxOutputTokens: Math.max(baseConfig.maxOutputTokens, 3000),
    timeoutMs: Math.max(baseConfig.timeoutMs, 30000),
  };

  const startedAt = Date.now();
  const logId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const country = request.headers.get('cf-ipcountry');

  try {
    const completion = await streamChatCompletion(
      tianjiConfig,
      systemPrompt,
      chartContext,
      [{ role: 'user', content: userPrompt }],
    );
    await writeQueryLog({
      id: logId,
      sessionId,
      question: normalizedQuestion || '天纪全面剖析',
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
      question: normalizedQuestion || '天纪全面剖析',
      answer: null,
      chartSummary,
      status: 'error',
      errorMessage,
      durationMs: Date.now() - startedAt,
      country,
    });
    console.error('Tianji interpretation failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
