import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  validateLiuyaoInput,
  castLiuyaoChart,
  type LiuyaoInput,
} from '@/lib/liuyao/engine';
import { saveLiuyaoRecord } from '@/lib/liuyao/history';

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
 * 六爻起卦接口（先起卦）：
 *   前端提交起卦日期 + 时辰 + 起卦方式 → 服务端确定性起卦（金钱卦 + 京房纳甲）
 *   → 返回结构化卦象 JSON（前后卦、纳甲、六亲、六兽、世应、动爻、用神、命中格局）
 *   解卦另行调用 /api/liuyao-interpret。
 *
 * 请求体：{
 *   solarDate, timeIndex, questionType, questionGoal, method,
 *   manualYao?（manual 方式）, numberA?/numberB?（number 方式）, gender?
 * }
 *   - 起卦时间 = 当前时间（起心动念那一刻），birthDate 暂不参与六爻（六爻不查八字用神）
 *   - 响应附 record_id（best-effort 落库成功时）：解盘请求回传该 id，解卦内容将回填至该起卦记录。
 * 要素缺失或起卦方式对应字段不齐时返回 400 + 具体缺失文案，严禁强排。
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

  const { solarDate, timeIndex, questionType, questionGoal, method, manualYao, numberA, numberB, gender } =
    body as Record<string, unknown>;

  // ── 第一步：要素校验（缺要素严禁强排）──
  const validation = validateLiuyaoInput({ solarDate, timeIndex, method, manualYao, numberA, numberB });
  if (!validation.ok) return errorResponse(validation.error || '起卦要素不合法', 400);

  const normalizedType = typeof questionType === 'string' ? questionType.trim().slice(0, 20) : '';
  const normalizedGoal = typeof questionGoal === 'string' ? questionGoal.trim().slice(0, 500) : '';
  const normalizedGender =
    gender === '男' || gender === '女' || gender === '不指定' ? gender : '不指定';

  // ── 第二步：确定性刚性起卦 ──
  try {
    const input: LiuyaoInput = {
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
      method: method as LiuyaoInput['method'],
      manualYao: Array.isArray(manualYao) ? (manualYao as boolean[]) : undefined,
      numberA: typeof numberA === 'number' ? numberA : undefined,
      numberB: typeof numberB === 'number' ? numberB : undefined,
      gender: normalizedGender,
    };
    const result = castLiuyaoChart(input);
    // ── 第三步：起卦历史落库（best-effort：D1 不可用/表未建时静默跳过，不影响起卦）──
    // 返回 record_id：前端解卦时回传，/api/liuyao-interpret 成功后据此回填 interpret_text
    const recordId = await saveLiuyaoRecord(result);
    return Response.json(
      { ...result, recordId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('Liuyao chart failed', errorMessage);
    return errorResponse('起卦失败，请核对起卦日期与时辰后重试', 400);
  }
}