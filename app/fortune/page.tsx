"use client";

import React, { useState } from "react";
import TopNav from "@/components/TopNav";

/**
 * 运势中心（V1.0）—— 跨模块综合解读（不起新盘）
 *
 * 工作流：
 * 1. 用户先到对应模块（奇门 / 六爻 / 大六壬 / 小六壬）页面起卦 + 解读
 * 2. 把每个模块 chart API 的完整 JSON 响应粘贴到本页对应 textarea
 * 3. 选 period（本月/本季/本年）+ focus（事业/感情/健康/财运/综合）+ 可选生辰
 * 4. 提交 → SSE 流式渲染综合报告
 *
 * 不依赖 D1 迁移（fortune_records 表 0005 迁移未应用）。
 */

const MODULES = [
  { key: "qimen",      label: "奇门遁甲", placeholder: '从 /qimen 页起局后，把 /api/qimen-chart 返回的 JSON 整体粘贴到此处' },
  { key: "liuyao",     label: "周易六爻", placeholder: '从 /liuyao 页起卦后，把 /api/liuyao-chart 返回的 JSON 整体粘贴到此处' },
  { key: "daliuren",   label: "大六壬",   placeholder: '从 /daliuren 页起局后，把 /api/daliuren-chart 返回的 JSON 整体粘贴到此处' },
  { key: "xiaoliuren", label: "小六壬",   placeholder: '从 /xiaoliuren 页起局后，把 /api/xiaoliuren-chart 返回的 JSON 整体粘贴到此处' },
] as const;

const PERIODS = [
  { value: "month",   label: "本月（30 天）" },
  { value: "season",  label: "本季（90 天）" },
  { value: "year",    label: "本年（12 个月）" },
] as const;

const FOCUSES = [
  { value: "overall",      label: "综合" },
  { value: "career",       label: "事业" },
  { value: "relationship", label: "感情" },
  { value: "health",       label: "健康" },
  { value: "wealth",       label: "财运" },
] as const;

const TIME_OPTIONS = [
  { value: "",           label: "未填写" },
  { value: "0",  label: "0 子时（23-01）" },
  { value: "1",  label: "1 丑时（01-03）" },
  { value: "2",  label: "2 寅时（03-05）" },
  { value: "3",  label: "3 卯时（05-07）" },
  { value: "4",  label: "4 辰时（07-09）" },
  { value: "5",  label: "5 巳时（09-11）" },
  { value: "6",  label: "6 午时（11-13）" },
  { value: "7",  label: "7 未时（13-15）" },
  { value: "8",  label: "8 申时（15-17）" },
  { value: "9",  label: "9 酉时（17-19）" },
  { value: "10", label: "10 戌时（19-21）" },
  { value: "11", label: "11 亥时（21-23）" },
] as const;

export default function FortunePage() {
  const [charts, setCharts] = useState<Record<string, string>>({
    qimen: "",
    liuyao: "",
    daliuren: "",
    xiaoliuren: "",
  });
  const [period, setPeriod] = useState<"month" | "season" | "year">("month");
  const [focus, setFocus] = useState<"overall" | "career" | "relationship" | "health" | "wealth">("overall");
  const [birthDate, setBirthDate] = useState("");
  const [birthTimeIndex, setBirthTimeIndex] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [done, setDone] = useState(false);

  const onChartChange = (key: string, v: string) => {
    setCharts((s) => ({ ...s, [key]: v }));
  };

  const submit = async () => {
    setErrorMsg(null);
    setAnswer("");
    setDone(false);

    const entries = Object.entries(charts).filter(([, v]) => v.trim().length > 0);
    if (entries.length === 0) {
      setErrorMsg("请至少粘贴 1 个模块的起局 JSON");
      return;
    }

    const chartsPayload: { module: string; json: unknown }[] = [];
    for (const [module, raw] of entries) {
      try {
        const parsed = JSON.parse(raw);
        chartsPayload.push({ module, json: parsed });
      } catch {
        setErrorMsg(`${module} 粘贴内容不是合法 JSON，请检查复制完整性`);
        return;
      }
    }

    setLoading(true);
    try {
      const res = await fetch("/api/fortune-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          charts: chartsPayload,
          period,
          focus,
          birthDate: birthDate || null,
          birthTimeIndex: birthTimeIndex === "" ? null : Number(birthTimeIndex),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `请求失败 HTTP ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式读取");
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done: rDone, value } = await reader.read();
        if (rDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") {
            setDone(true);
            continue;
          }
          try {
            const j = JSON.parse(payload);
            const text = j?.delta?.text;
            if (text) setAnswer((prev) => prev + text);
          } catch {
            /* 忽略非 JSON 行 */
          }
        }
      }
      setDone(true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "请求失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setCharts({ qimen: "", liuyao: "", daliuren: "", xiaoliuren: "" });
    setBirthDate("");
    setBirthTimeIndex("");
    setAnswer("");
    setErrorMsg(null);
    setDone(false);
  };

  return (
    <div className="max-w-4xl mx-auto pt-14 px-4 pb-12">
      <TopNav />

      <div className="flex items-center justify-between mt-4 mb-6 pb-4 border-b border-purple-900/40">
        <h1 className="text-xl font-bold tracking-wider text-purple-300" data-banner="fortune">
          运势中心 · 跨模块综合解读
        </h1>
        <div className="w-12" />
      </div>

      <p className="text-sm text-slate-300/80 leading-relaxed mb-6">
        把已起好的 1-4 个术数盘面 JSON 粘贴到下方，每模块一格；不依赖起新盘，直接把既有盘面交给综合解读。
        必含：时间范围、聚焦维度；生辰可选（如提供可让解读结合日主 / 用神类推断）。
      </p>

      {/* —— 表单 —— */}
      <div className="space-y-5">
        {/* 4 模块 textarea */}
        <div className="space-y-4">
          <div className="text-xs uppercase tracking-widest text-purple-300/70">已起局盘面（1-4 个）</div>
          {MODULES.map((m) => (
            <div key={m.key}>
              <label className="block text-sm font-semibold text-slate-200 mb-1">
                {m.label} <span className="text-slate-500 text-xs font-normal">（可留空）</span>
              </label>
              <textarea
                value={charts[m.key]}
                onChange={(e) => onChartChange(m.key, e.target.value)}
                placeholder={m.placeholder}
                rows={3}
                className="w-full text-xs font-mono bg-slate-900/60 border border-slate-700 rounded p-2 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-purple-500/60"
              />
            </div>
          ))}
        </div>

        {/* period + focus */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">时间范围</label>
            <div className="flex gap-2">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    period === p.value
                      ? "border-purple-400 text-purple-200 bg-purple-500/15"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">聚焦维度</label>
            <div className="flex flex-wrap gap-2">
              {FOCUSES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFocus(f.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    focus === f.value
                      ? "border-purple-400 text-purple-200 bg-purple-500/15"
                      : "border-slate-700 text-slate-400 hover:border-slate-500"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 生辰可选 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">
              出生日期 <span className="text-slate-500 text-xs font-normal">（可选）</span>
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full text-sm bg-slate-900/60 border border-slate-700 rounded px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500/60"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-1">
              出生时辰 <span className="text-slate-500 text-xs font-normal">（可选）</span>
            </label>
            <select
              value={birthTimeIndex}
              onChange={(e) => setBirthTimeIndex(e.target.value)}
              className="w-full text-sm bg-slate-900/60 border border-slate-700 rounded px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500/60"
            >
              {TIME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="text-sm px-5 py-2 rounded-full bg-purple-500/80 text-white font-semibold disabled:opacity-50 hover:bg-purple-500 transition-colors"
          >
            {loading ? "综合解读中…" : "开始综合解读"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={loading}
            className="text-sm px-5 py-2 rounded-full border border-slate-700 text-slate-300 disabled:opacity-50 hover:border-slate-500 transition-colors"
          >
            重置
          </button>
        </div>

        {errorMsg && (
          <div className="text-sm text-rose-300 bg-rose-900/20 border border-rose-700/40 rounded p-3">
            {errorMsg}
          </div>
        )}
      </div>

      {/* —— 结果区 —— */}
      {(answer || loading) && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm uppercase tracking-widest text-purple-300/70">综合报告</h2>
            {loading && <span className="text-xs text-slate-500">生成中…</span>}
            {!loading && done && <span className="text-xs text-emerald-400">已完成</span>}
          </div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100 bg-slate-900/40 border border-purple-900/30 rounded p-4">
            {answer || (loading ? "等待 LLM 响应…" : "")}
          </pre>
        </div>
      )}
    </div>
  );
}
