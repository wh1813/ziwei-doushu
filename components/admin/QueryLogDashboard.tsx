'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { QueryLogListResponse, QueryLogRow } from '@/lib/logging/types';

interface QueryLogDashboardProps {
  adminEmail: string;
}

function formatDate(value: string): string {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(normalized));
}

export default function QueryLogDashboard({ adminEmail }: QueryLogDashboardProps) {
  const [data, setData] = useState<QueryLogListResponse>({ logs: [], total: 0, page: 1, pageSize: 20 });
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        q: query,
        status,
      });
      const response = await fetch(`/api/admin/query-logs?${params}`, { cache: 'no-store' });
      const payload = await response.json() as QueryLogListResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || '读取失败');
      setData(payload);
      setSelected(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams({ format: 'csv', q: query, status });
    return `/api/admin/query-logs?${params}`;
  }, [query, status]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setQuery(queryInput.trim());
  }

  function toggleOne(id: string) {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePage() {
    setSelected(current => {
      if (data.logs.length && data.logs.every(log => current.has(log.id))) return new Set();
      return new Set(data.logs.map(log => log.id));
    });
  }

  async function removeSelected() {
    if (!selected.size || !window.confirm(`确定删除选中的 ${selected.size} 条记录吗？此操作不可恢复。`)) return;
    setMessage('');
    const response = await fetch('/api/admin/query-logs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(payload.error || '删除失败');
      return;
    }
    setMessage('所选记录已删除');
    await load();
  }

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs tracking-[0.28em] text-amber-400">管理后台</p>
            <h1 className="text-2xl font-semibold sm:text-3xl">AI 询问记录</h1>
            <p className="mt-2 text-xs text-slate-400">
              当前管理员：{adminEmail} · 记录匿名保存30天 · 不保存真实IP
            </p>
          </div>
          <a href="/" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-amber-500">
            返回网站
          </a>
        </div>

        <section className="mb-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <form onSubmit={submitSearch} className="flex flex-wrap gap-3">
            <input
              value={queryInput}
              onChange={event => setQueryInput(event.target.value)}
              placeholder="搜索问题、回答或命盘摘要"
              className="min-w-64 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
            <select
              value={status}
              onChange={event => { setStatus(event.target.value); setPage(1); }}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="">全部状态</option>
              <option value="success">成功</option>
              <option value="error">失败</option>
            </select>
            <button className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-400">
              搜索
            </button>
            <a href={exportUrl} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-amber-500">
              导出 CSV
            </a>
            <button
              type="button"
              onClick={removeSelected}
              disabled={!selected.size}
              className="rounded-lg border border-red-900 px-4 py-2 text-sm text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              删除所选
            </button>
          </form>
          {message && <p className="mt-3 text-sm text-amber-300">{message}</p>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-950/60 text-xs text-slate-400">
                <tr>
                  <th className="p-3">
                    <input
                      type="checkbox"
                      aria-label="选择本页"
                      checked={Boolean(data.logs.length) && data.logs.every(log => selected.has(log.id))}
                      onChange={togglePage}
                    />
                  </th>
                  <th className="p-3">时间</th>
                  <th className="p-3">状态</th>
                  <th className="p-3">问题与回答</th>
                  <th className="p-3">耗时</th>
                  <th className="p-3">地区</th>
                  <th className="p-3">匿名会话</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log: QueryLogRow) => (
                  <tr key={log.id} className="border-b border-slate-800/70 align-top">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label="选择记录"
                        checked={selected.has(log.id)}
                        onChange={() => toggleOne(log.id)}
                      />
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs text-slate-400">{formatDate(log.created_at)}</td>
                    <td className="p-3">
                      <span className={log.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
                        {log.status === 'success' ? '成功' : '失败'}
                      </span>
                      {log.error_message && <p className="mt-1 max-w-52 text-xs text-red-300">{log.error_message}</p>}
                    </td>
                    <td className="max-w-2xl p-3">
                      <p className="font-medium text-amber-200">{log.question}</p>
                      {log.answer && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-slate-400">查看完整回答</summary>
                          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-300">{log.answer}</pre>
                        </details>
                      )}
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-slate-500">查看命盘摘要</summary>
                        <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs leading-6 text-slate-400">{log.chart_summary}</pre>
                      </details>
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs text-slate-400">{(log.duration_ms / 1000).toFixed(1)}秒</td>
                    <td className="p-3 text-xs text-slate-400">{log.country || '未知'}</td>
                    <td className="max-w-40 truncate p-3 text-xs text-slate-500" title={log.session_id}>{log.session_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!loading && data.logs.length === 0 && (
            <div className="p-12 text-center text-sm text-slate-500">暂无符合条件的记录</div>
          )}
          {loading && <div className="p-12 text-center text-sm text-slate-500">正在读取记录…</div>}

          <div className="flex items-center justify-between border-t border-slate-800 p-4 text-sm text-slate-400">
            <span>共 {data.total} 条</span>
            <div className="flex items-center gap-3">
              <button
                disabled={page <= 1}
                onClick={() => setPage(value => Math.max(1, value - 1))}
                className="rounded border border-slate-700 px-3 py-1 disabled:opacity-30"
              >
                上一页
              </button>
              <span>{page} / {pageCount}</span>
              <button
                disabled={page >= pageCount}
                onClick={() => setPage(value => Math.min(pageCount, value + 1))}
                className="rounded border border-slate-700 px-3 py-1 disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
