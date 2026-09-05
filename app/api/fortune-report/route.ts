// app/api/fortune-report/route.ts
// 运势中心 V1.0：跨模块综合解读接口
//
// 请求体（POST application/json）：
//   {
//     charts: [{ module: 'qimen'|'liuyao'|'daliuren'|'xiaoliuren', json: <chart API response> }, ...],
//     period:  'month' | 'season' | 'year',
//     focus:   'career' | 'relationship' | 'health' | 'wealth' | 'overall',
//     birthDate?: 'YYYY-MM-DD' | null,        // 可选
//     birthTimeIndex?: 0-12 | null,           // 可选
//   }
//
// 响应：SSE（text/event-stream），单帧 data: {delta:{text}} + [DONE]
//
// 设计要点：
// - 4 术数 JSON 输入：每个模块由对应 chart API 返回的完整响应（deterministic engine output）
// - 不依赖 D1 迁移：recordId 总是 null（V1.0 阶段不落 fortune_records 表）
// - 后台日志：复用 ai_query_logs（writeQueryLog）落 chartSummary 字段供审计
// - 失败模式：input 校验失败 → 400；LLM 异常 → 503 + 兜底文案
// - 速率限制：复用 AI_RATE_LIMITER Cloudflare binding（与 qimen-interpret 同款）

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getProviderChain } from '@/lib/ai/config';
import { streamChatCompletionWithFallback } from '@/lib/ai/provider';
import { writeQueryLog } from '@/lib/logging/query-log';
import { sanitizeDivinationOutput } from '@/lib/divination/sanitize';
import {
  validateFortuneInput,
  extractFortuneContext,
  type FortuneChartInput,
  type FortuneModule,
} from '@/lib/fortune/extract';
import {
  buildFortunePrompt,
  type FortunePeriod,
  type FortuneFocus,
  FORTUNE_PERIODS,
  FORTUNE_FOCUSES,
} from '@/lib/fortune/prompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 4 术数 JSON 完整响应：每个约 1.5-3 KB；4 个 + 元数据 = 上限 8 KB 足够
const MAX_BODY_BYTES = 8 * 1024;

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

function asFortuneModule(v: unknown): FortuneModule | null {
  return v === 'qimen' || v === 'liuyao' || v === 'daliuren' || v === 'xiaoliuren'
    ? v
    : null;
}

function asFortunePeriod(v: unknown): FortunePeriod | null {
  return v === 'month' || v === 'season' || v === 'year' ? v : null;
}

function asFortuneFocus(v: unknown): FortuneFocus | null {
  return v === 'career' || v === 'relationship' || v === 'health' || v === 'wealth' || v === 'overall'
    ? v
    : null;
}

function asBirthDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const t = v.trim();
  // 接受 YYYY-MM-DD 形式；其它形式直接拒绝
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function asBirthTimeIndex(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 12) return null;
  return Math.floor(n);
}

export async function POST(request: Request): Promise<Response> {
  // ── 0. 入参预处理（与现有术数 route 同款：content-length + content-type + 速率限制）──
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

  // ── 1. 入参校验 ──
  const obj = body as Record<string, unknown>;
  const rawCharts = Array.isArray(obj.charts) ? obj.charts : [];
  if (rawCharts.length === 0) {
    return errorResponse('请至少提供 1 个起局 JSON（从对应模块页面复制）', 400);
  }

  const charts: FortuneChartInput[] = [];
  for (let i = 0; i < rawCharts.length; i += 1) {
    const el = rawCharts[i];
    if (!el || typeof el !== 'object') {
      return errorResponse(`charts[${i}] 必须是 {module, json} 形式`, 400);
    }
    const e = el as Record<string, unknown>;
    const mod = asFortuneModule(e.module);
    if (!mod) return errorResponse(`charts[${i}].module 必须是 qimen/liuyao/daliuren/xiaoliuren 之一`, 400);
    charts.push({ module: mod, json: e.json });
  }

  const validation = validateFortuneInput({ charts });
  if (!validation.ok) return errorResponse(validation.error, 400);

  const period = asFortunePeriod(obj.period);
  if (!period) return errorResponse('period 必须是 month/season/year 之一', 400);
  const focus = asFortuneFocus(obj.focus);
  if (!focus) return errorResponse('focus 必须是 career/relationship/health/wealth/overall 之一', 400);

  const birthDate = asBirthDate(obj.birthDate);
  if (obj.birthDate !== undefined && obj.birthDate !== null && birthDate === null) {
    return errorResponse('birthDate 必须是 YYYY-MM-DD 形式或留空', 400);
  }
  const birthTimeIndex = asBirthTimeIndex(obj.birthTimeIndex);
  if (obj.birthTimeIndex !== undefined && obj.birthTimeIndex !== null && birthTimeIndex === null) {
    return errorResponse('birthTimeIndex 必须是 0-12 整数或留空', 400);
  }

  // ── 2. 跨模块摘要聚合（确定性引擎产物）──
  let context;
  try {
    context = extractFortuneContext(charts);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    console.error('Fortune extract failed', msg);
    return errorResponse(`盘面摘要失败：${msg}`, 400);
  }

  // ── 3. 拼装 Prompt ──
  const { systemPrompt, userPrompt, chartContext } = buildFortunePrompt(
    { period, focus, birthDate, birthTimeIndex },
    context,
  );

  // ── 4. LLM 调用（链式回退，提升首字节成功率）──
  const chain = getProviderChain().map((config) => ({
    ...config,
    // 长上下文 + 五段结构输出：上调 token 与超时
    maxOutputTokens: Math.max(config.maxOutputTokens, 2500),
    timeoutMs: Math.max(config.timeoutMs, 30000),
  }));

  const chartQuestion = `运势中心·${FORTUNE_PERIODS[period]}·${FORTUNE_FOCUSES[focus]}·${context.charts.map((c) => c.module).join('+')}`;

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
    // 兜底清洗：要求首行必须是【】标题（运势中心输出铁律）
    const cleaned = sanitizeDivinationOutput(completion.content, { requireBracketHeader: true });
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
    console.error('Fortune report failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
