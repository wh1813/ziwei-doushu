import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { QueryLogListResponse, QueryLogRow, QueryLogStatus } from './types';

interface D1Result<T> {
  results?: T[];
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T>(): Promise<D1Result<T>>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

export interface WriteQueryLogInput {
  id: string;
  sessionId: string;
  question: string;
  answer: string | null;
  chartSummary: string;
  status: QueryLogStatus;
  errorMessage: string | null;
  durationMs: number;
  country: string | null;
}

export function getQueryLogDatabase(): D1DatabaseLike | null {
  try {
    const { env } = getCloudflareContext();
    return ((env as unknown as { QUERY_LOGS_DB?: D1DatabaseLike }).QUERY_LOGS_DB) || null;
  } catch {
    return null;
  }
}

export async function writeQueryLog(input: WriteQueryLogInput): Promise<boolean> {
  const db = getQueryLogDatabase();
  if (!db) return false;

  try {
    const cleanup = db.prepare(
      "DELETE FROM ai_query_logs WHERE created_at < datetime('now', '-30 days')",
    );
    const insert = db.prepare(
      `INSERT INTO ai_query_logs (
        id, session_id, question, answer, chart_summary, status,
        error_message, duration_ms, country
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.sessionId.slice(0, 80),
      input.question.slice(0, 1000),
      input.answer?.slice(0, 16000) ?? null,
      input.chartSummary.slice(0, 12000),
      input.status,
      input.errorMessage?.slice(0, 500) ?? null,
      Math.max(0, Math.round(input.durationMs)),
      input.country?.slice(0, 8) ?? null,
    );
    await db.batch([cleanup, insert]);
    return true;
  } catch (error) {
    console.error('Query log write failed', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function buildFilters(query: string, status: string): { clause: string; values: unknown[] } {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (query) {
    const pattern = `%${query.slice(0, 100)}%`;
    conditions.push('(question LIKE ? OR answer LIKE ? OR chart_summary LIKE ?)');
    values.push(pattern, pattern, pattern);
  }
  if (status === 'success' || status === 'error') {
    conditions.push('status = ?');
    values.push(status);
  }

  return {
    clause: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export async function listQueryLogs(
  db: D1DatabaseLike,
  options: { page: number; pageSize: number; query: string; status: string },
): Promise<QueryLogListResponse> {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.min(100, Math.max(10, Math.floor(options.pageSize)));
  const offset = (page - 1) * pageSize;
  const filters = buildFilters(options.query.trim(), options.status);

  const countStatement = db.prepare(
    `SELECT COUNT(*) AS count FROM ai_query_logs${filters.clause}`,
  ).bind(...filters.values);
  const listStatement = db.prepare(
    `SELECT id, created_at, session_id, question, answer, chart_summary,
      status, error_message, duration_ms, country
     FROM ai_query_logs${filters.clause}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(...filters.values, pageSize, offset);

  const [countRow, rows] = await Promise.all([
    countStatement.first<{ count: number }>(),
    listStatement.all<QueryLogRow>(),
  ]);

  return {
    logs: rows.results || [],
    total: Number(countRow?.count || 0),
    page,
    pageSize,
  };
}

export async function exportQueryLogs(
  db: D1DatabaseLike,
  options: { query: string; status: string },
): Promise<QueryLogRow[]> {
  const filters = buildFilters(options.query.trim(), options.status);
  const rows = await db.prepare(
    `SELECT id, created_at, session_id, question, answer, chart_summary,
      status, error_message, duration_ms, country
     FROM ai_query_logs${filters.clause}
     ORDER BY created_at DESC
     LIMIT 5000`,
  ).bind(...filters.values).all<QueryLogRow>();
  return rows.results || [];
}

export async function deleteQueryLogs(db: D1DatabaseLike, ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)].filter(id => /^[0-9a-f-]{20,80}$/i.test(id)).slice(0, 100);
  if (!uniqueIds.length) return;
  await db.batch(uniqueIds.map(id => db.prepare('DELETE FROM ai_query_logs WHERE id = ?').bind(id)));
}
