import { getCloudflareContext } from '@opennextjs/cloudflare';
import { listQimenRecords, deleteQimenRecord } from '@/lib/qimen/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
 * 奇门起局历史记录接口：
 *   GET /api/qimen-history?limit=20 → { records: [...] }（时间倒序，不含 chart_summary 大字段）
 *   DELETE /api/qimen-history  body { id } → { ok: true }（删除单条，id 须为 UUID）
 *
 * D1 表未建（迁移未执行）或库不可用时 GET 返回 200 + available:false（前端降级隐藏面板），
 * 保证 /qimen 主流程不受影响。
 */
export async function GET(request: Request): Promise<Response> {
  if (await isRateLimited(request)) return errorResponse('请求过于频繁，请稍后再试', 429);

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get('limit') || '20', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  const records = await listQimenRecords(limit);
  if (records === null) {
    return Response.json({ available: false, records: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return Response.json(
    {
      available: true,
      records: records.map((r) => ({
        ...r,
        question_goal: (r.question_goal || '').slice(0, 120),
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  if (await isRateLimited(request)) return errorResponse('请求过于频繁，请稍后再试', 429);

  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return errorResponse('请求格式无效', 400);
  }
  const id = (body as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return errorResponse('记录 ID 无效', 400);
  }

  const ok = await deleteQimenRecord(id);
  if (!ok) return errorResponse('删除失败（记录不存在或存储不可用）', 503);
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
