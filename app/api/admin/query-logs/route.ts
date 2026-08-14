import { getAuthenticatedAdminEmail } from '@/lib/admin/auth';
import {
  deleteQueryLogs,
  exportQueryLogs,
  getQueryLogDatabase,
  listQueryLogs,
} from '@/lib/logging/query-log';
import type { QueryLogRow } from '@/lib/logging/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: QueryLogRow[]): string {
  const headers = [
    '时间', '状态', '问题', '回答', '命盘摘要', '错误', '耗时毫秒',
    '国家地区', '匿名会话', '记录编号',
  ];
  const lines = rows.map(row => [
    row.created_at,
    row.status,
    row.question,
    row.answer,
    row.chart_summary,
    row.error_message,
    row.duration_ms,
    row.country,
    row.session_id,
    row.id,
  ].map(csvCell).join(','));
  return '\uFEFF' + [headers.map(csvCell).join(','), ...lines].join('\n');
}

export async function GET(request: Request): Promise<Response> {
  if (!getAuthenticatedAdminEmail(request.headers)) return json({ error: '无权访问' }, 403);

  const db = getQueryLogDatabase();
  if (!db) return json({ error: 'D1 数据库尚未绑定' }, 503);

  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '';
  const format = url.searchParams.get('format');

  try {
    if (format === 'csv') {
      const rows = await exportQueryLogs(db, { query, status });
      return new Response(toCsv(rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="ai-query-logs.csv"',
          'Cache-Control': 'no-store',
        },
      });
    }

    const page = Number(url.searchParams.get('page') || '1');
    const pageSize = Number(url.searchParams.get('pageSize') || '20');
    return json(await listQueryLogs(db, { page, pageSize, query, status }));
  } catch (error) {
    console.error('Query log read failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '读取记录失败' }, 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (!getAuthenticatedAdminEmail(request.headers)) return json({ error: '无权访问' }, 403);

  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: '请求来源无效' }, 403);

  const db = getQueryLogDatabase();
  if (!db) return json({ error: 'D1 数据库尚未绑定' }, 503);

  try {
    const body = await request.json() as { ids?: unknown };
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100) {
      return json({ error: '请选择1至100条记录' }, 400);
    }
    await deleteQueryLogs(db, body.ids.filter((id): id is string => typeof id === 'string'));
    return json({ ok: true });
  } catch (error) {
    console.error('Query log delete failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: '删除记录失败' }, 500);
  }
}
