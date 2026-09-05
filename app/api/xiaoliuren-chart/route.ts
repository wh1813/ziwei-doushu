import { getCloudflareContext } from '@opennextjs/cloudflare';
import {
  validateXiaoliurenInput,
  castXiaoliurenChart,
  type XiaoliurenInput,
} from '@/lib/xiaoliuren/engine';
import { saveXiaoliurenRecord } from '@/lib/xiaoliuren/history';

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
 * 小六壬起课接口（先起课）：
 *   前端提交起课日期 + 时辰 + 问事 → 服务端确定性起课（三步掌诀顺数）
 *   → 返回结构化课体 JSON；解课另行调用 /api/xiaoliuren-interpret。
 *
 * 请求体：{
 *   solarDate, timeIndex, questionType, questionGoal, gender?
 * }
 *   - 起课时间 = 当前时间（求测者起心动念那一刻）
 *   - 响应附 record_id（best-effort 落库成功时）：解课请求回传该 id，解课内容将回填至该起课记录。
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

  const { solarDate, timeIndex, questionType, questionGoal, gender } = body as Record<string, unknown>;

  // ── 第一步：要素校验（缺要素严禁强排）──
  const validation = validateXiaoliurenInput({ solarDate, timeIndex });
  if (!validation.ok) return errorResponse(typeof validation.error === 'string' ? validation.error : '起课要素不合法', 400);

  const normalizedType = typeof questionType === 'string' ? questionType.trim().slice(0, 20) : '';
  const normalizedGoal = typeof questionGoal === 'string' ? questionGoal.trim().slice(0, 500) : '';
  const normalizedGender =
    gender === '男' || gender === '女' || gender === '不指定' ? gender : '不指定';

  // ── 第二步：确定性刚性起课 ──
  try {
    const input: XiaoliurenInput = {
      solarDate: solarDate as string,
      timeIndex: timeIndex as number,
      questionType: normalizedType,
      questionGoal: normalizedGoal,
      gender: normalizedGender,
    };
    const result = castXiaoliurenChart(input);
    // ── 第三步：起课历史落库（best-effort：D1 不可用/表未建时静默跳过，不影响起课）──
    const recordId = await saveXiaoliurenRecord(result);
    return Response.json(
      { ...result, recordId },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'unknown error';
    console.error('Xiaoliuren chart failed', errorMessage);
    return errorResponse('起课失败，请核对起课日期与时辰后重试', 400);
  }
}