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
import { updateQimenRecordInterpret } from '@/lib/qimen/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// 前端为纯文本渲染（whitespace-pre-wrap），Markdown 符号会原样显示成乱码。
// Prompt 已禁用 Markdown 与开场白（【输出格式铁律】），此处做代码级兜底清洗：
// 1) 剔除开头元话语行（"我将严格遵循……""好的，……""以下是为您……"等）
// 2) 全文剔除 #、*、` 与行首引用符/无序列表符
const QIMEN_META_LINE_RE =
  /(我将|我会|以下是|为您解读|为您剖析|严格遵循|遵循.{0,12}(体系|方法)|作为一(位|名))/;

function sanitizeQimenOutput(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  // 仅清理正文最前部的元话语行（短行且非【】段落标题），逐行剔除直到遇到正文
  while (lines.length > 0) {
    const first = lines.findIndex((l) => l.trim() !== '');
    if (first === -1) {
      lines.length = 0;
      break;
    }
    const line = lines[first].trim();
    if (line.length < 80 && !line.startsWith('【') && QIMEN_META_LINE_RE.test(line)) {
      lines.splice(first, 1);
    } else {
      break;
    }
  }
  return lines
    .map((l) => {
      let s = l.replace(/^\s*#{1,6}\s*/, ''); // 行首标题井号
      s = s.replace(/\*/g, ''); // 粗体/斜体星号（本域文本中 * 无实义）
      s = s.replace(/`/g, ''); // 行内代码反引号
      s = s.replace(/^\s*>\s?/, ''); // 引用符
      s = s.replace(/^\s*[-•]\s+/, '· '); // 无序列表符 → 间隔点
      return s;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
 * 请求体：{ solarDate, timeIndex, questionType?, questionGoal?, birthDate?, birthTimeIndex?, recordId? }
 *   - 起局时间 = 当前时间；可选出生信息仅用于预计算个人用神落宫（LLM 只引用、严禁重算）。
 *   - 可选 recordId = /api/qimen-chart 返回的起局记录 id：解盘成功后 best-effort 回填
 *     interpret_text 至该 D1 记录（后台起局历史含解盘内容）；非法或缺失时跳过，不影响解盘。
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

  const { solarDate, timeIndex, questionType, questionGoal, recordId } = body as {
    solarDate?: unknown;
    timeIndex?: unknown;
    questionType?: unknown;
    questionGoal?: unknown;
    recordId?: unknown;
  };
  // 回填目标记录 id：仅接受合法 UUID，其余（缺失/非法）一律置空跳过，绝不因此阻塞解盘
  const interpretRecordId = typeof recordId === 'string' && recordId.trim() ? recordId.trim() : null;

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
    // 兜底清洗：剔除元话语开场与 Markdown 符号（前端纯文本渲染），再包装为 SSE
    const cleaned = sanitizeQimenOutput(completion.content);
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
    // 起局历史回填解盘内容（best-effort：recordId 缺失/非法或迁移 0004 未应用时静默跳过）
    if (interpretRecordId) {
      await updateQimenRecordInterpret(interpretRecordId, cleaned);
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
    console.error('Qimen interpretation failed', errorMessage);
    return errorResponse('解读服务暂时不可用，请稍后再试', 503);
  }
}
