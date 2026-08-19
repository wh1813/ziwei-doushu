import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 查询某用户最近的手相测算历史，从 D1 读取，按时间倒序。
 * 路径：/api/palm-history/{userId}
 */
export async function GET(request: Request, ctx: { params: Promise<{ userId: string }> | { userId: string } }): Promise<Response> {
  const params = await ctx.params;
  const userId = params.userId;

  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(userId)) {
    return Response.json({ error: '无效的用户标识' }, { status: 400 });
  }

  const { env } = getCloudflareContext();
  const { results } = await env.QUERY_LOGS_DB.prepare(
    `SELECT id, image_url, extracted_features, report_content, created_at
     FROM palm_records
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(userId)
    .all<{
      id: string;
      image_url: string;
      extracted_features: string;
      report_content: string;
      created_at: string;
    }>();

  return Response.json({ success: true, history: results }, { headers: { 'Cache-Control': 'no-store' } });
}