import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  validateQimenInput,
  castQimenChart,
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
 * 奇门遁甲排盘接口（先排盘）：
 *   前端提交起局日期与时辰 → 服务端确定性排盘（阴阳遁/定局/天地盘/星门神/旬空/值符值使/格局）
 *   → 返回结构化盘面 JSON，由前端渲染九宫格；解盘另行调用 /api/qimen-interpret。
 *
 * 请求体：{ solarDate, timeIndex, questionType?, questionGoal?, birthDate?, birthTimeIndex? }
 *   - 起局时间 = 当前时间（起局要素）；birthDate/birthTimeIndex 为可选出生信息，
 *     仅用于排盘后按八字定位「本人/灵魂伴侣/生年干」用神落宫并检测击刑/入墓/空亡。
 * 要素缺失时返回 400 + 具体缺失文案，严禁强排。
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

  // ── 第二步：确定性刚性排盘 ──
  try {
    const result = castQimenChart({
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
    });
    // ── 第三步：附加检测层（不动排盘主输出）──
    // 全盘不利状态（击刑/入墓）恒返回；个人用神仅在提供出生信息时计算
    const chartUnfavorable = detectChartUnfavorable(result.chart);
    const personal = birthParse.birth ? analyzePersonalSymbols(result, birthParse.birth) : null;
    return Response.json(
      { ...result, personal, chartUnfavorable },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('Qimen chart failed', errorMessage);
    return errorResponse('排盘失败，请核对起局日期与时辰后重试', 400);
  }
}
