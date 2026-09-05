"use client";

import React, { useState } from "react";
import Link from "next/link";

const TIME_OPTIONS = [
  { value: 0, label: "早子时 00:00-01:00" },
  { value: 1, label: "丑时 01:00-03:00" },
  { value: 2, label: "寅时 03:00-05:00" },
  { value: 3, label: "卯时 05:00-07:00" },
  { value: 4, label: "辰时 07:00-09:00" },
  { value: 5, label: "巳时 09:00-11:00" },
  { value: 6, label: "午时 11:00-13:00" },
  { value: 7, label: "未时 13:00-15:00" },
  { value: 8, label: "申时 15:00-17:00" },
  { value: 9, label: "酉时 17:00-19:00" },
  { value: 10, label: "戌时 19:00-21:00" },
  { value: 11, label: "亥时 21:00-23:00" },
];

const QUESTION_TYPES = ["求财", "事业", "感情", "考试", "健康", "出行", "诉讼", "寻物", "其他"];
const GENDERS = [
  { value: "不指定", label: "不指定" },
  { value: "男", label: "男" },
  { value: "女", label: "女" },
];

type LiuShen = "大安" | "留连" | "速喜" | "赤口" | "小吉" | "空亡";

interface XiaoliurenResultPayload {
  input: {
    solarDate: string;
    timeIndex: number;
    questionType: string;
    questionGoal: string;
    gender?: string;
  };
  lunar: {
    yearZodiac: string;
    month: number;
    day: number;
    yearGanZhi: string;
    monthGanZhi: string;
    dayGanZhi: string;
    timeGanZhi: string;
  };
  timeOrdinal: number;
  steps: {
    monthGong: LiuShen;
    dayGong: LiuShen;
    timeGong: LiuShen;
  };
  result: {
    liuShen: LiuShen;
    jiXiong: "大吉" | "中吉" | "小吉" | "小凶" | "中凶" | "大凶";
    wuxing: string;
    fangwei: string;
    tiXiang: string;
    shu: string;
    season: string;
    brief: string;
  };
  warnings: string[];
  recordId?: string | null;
}

const JI_XIONG_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  "大吉": { bg: "bg-emerald-950/40", border: "border-emerald-700", text: "text-emerald-300" },
  "中吉": { bg: "bg-teal-950/40", border: "border-teal-700", text: "text-teal-300" },
  "小吉": { bg: "bg-cyan-950/40", border: "border-cyan-700", text: "text-cyan-300" },
  "小凶": { bg: "bg-amber-950/40", border: "border-amber-700", text: "text-amber-300" },
  "中凶": { bg: "bg-orange-950/40", border: "border-orange-700", text: "text-orange-300" },
  "大凶": { bg: "bg-red-950/40", border: "border-red-700", text: "text-red-300" },
};

export default function XiaoliurenPage() {
  const [solarDate, setSolarDate] = useState("");
  const [timeIndex, setTimeIndex] = useState<number>(8);
  const [questionType, setQuestionType] = useState("求财");
  const [questionGoal, setQuestionGoal] = useState("");
  const [gender, setGender] = useState<"男" | "女" | "不指定">("不指定");
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<XiaoliurenResultPayload | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCastChart = async () => {
    if (!solarDate) {
      setErrorMsg("请先选择起课日期");
      return;
    }
    setLoadingChart(true);
    setErrorMsg(null);
    setChartData(null);
    setAnswer("");

    try {
      const res = await fetch("/api/xiaoliuren-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType,
          questionGoal: questionGoal.trim() || undefined,
          gender,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "起课失败，请稍后重试");
      }
      setChartData((await res.json()) as XiaoliurenResultPayload);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "请求服务器失败，请检查网络连接");
    } finally {
      setLoadingChart(false);
    }
  };

  const handleInterpret = async () => {
    if (!chartData) return;
    setInterpretLoading(true);
    setErrorMsg(null);
    setAnswer("");

    try {
      const res = await fetch("/api/xiaoliuren-interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType,
          questionGoal: questionGoal.trim() || undefined,
          gender,
          recordId: chartData.recordId || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "解课失败，请稍后重试");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("浏览器不支持流式读取");
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const text = j?.delta?.text;
            if (text) setAnswer((prev) => prev + text);
          } catch {
            /* 忽略非 JSON 行 */
          }
        }
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "请求服务器失败，请检查网络连接");
    } finally {
      setInterpretLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-800">
          <Link href="/" className="text-slate-400 hover:text-white text-sm flex items-center gap-1">
            ← 返回首页
          </Link>
          <h1 className="text-xl font-bold tracking-wider text-cyan-400">小六壬 · 诸葛马前课</h1>
          <div className="w-12"></div>
        </div>

        {/* ── 小六壬专属 Hero Banner：掌诀六神圆环 ── */}
        <div data-banner="xiaoliuren" className="relative overflow-hidden rounded-2xl mb-6 p-5 border border-cyan-900/50 bg-gradient-to-br from-cyan-950/30 via-slate-900 to-amber-950/30 shadow-lg">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <svg viewBox="0 0 120 120" className="w-20 h-20 flex-shrink-0" aria-hidden="true">
              {/* 掌诀六神圆环 */}
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(34,211,238,0.4)" strokeWidth="1.5" />
              {/* 六等分 */}
              <g fill="rgba(240,208,112,0.95)" fontSize="10" fontWeight="bold" textAnchor="middle">
                <text x="60" y="18">大安</text>
                <text x="98" y="44">留连</text>
                <text x="98" y="80">速喜</text>
                <text x="60" y="106">赤口</text>
                <text x="22" y="80">小吉</text>
                <text x="22" y="44">空亡</text>
              </g>
              {/* 中央圆 */}
              <circle cx="60" cy="60" r="14" fill="rgba(34,211,238,0.15)" stroke="rgba(34,211,238,0.7)" strokeWidth="1" />
              <text x="60" y="64" fontSize="11" fontWeight="bold" textAnchor="middle" fill="rgba(255,255,255,0.95)">掌诀</text>
              {/* 三步轨迹箭头：月→日→时 */}
              <g fill="none" stroke="rgba(244,114,182,0.85)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M 60 18 A 50 50 0 0 1 60 110" strokeDasharray="3 2" />
                <polygon points="58,107 62,107 60,113" fill="rgba(244,114,182,0.85)" stroke="none" />
              </g>
            </svg>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-base font-bold text-cyan-300">诸葛马前 · 掐指一算</span>
                <span className="text-[10px] text-amber-300/80 font-mono tracking-widest">XIǍO LIÙ RÉN</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                诸葛亮行军途中创制，<span className="text-amber-300 font-semibold">只需月日时三步</span>：
                大安起月、月上起日、日上起时——
                <span className="text-cyan-300 font-semibold">大安 / 速喜 / 小吉</span>
                为吉，<span className="text-rose-300 font-semibold">留连 / 赤口 / 空亡</span>
                为凶。轻巧迅捷，<span className="font-semibold">掐指即得</span>。本局程序严判掌诀六神与吉凶等级。
              </p>
            </div>
          </div>
        </div>

        {/* 输入表单 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8 space-y-5">
          <p className="text-xs text-slate-500 leading-relaxed">
            本功能由程序先用 <span className="text-cyan-400">确定性掌诀法严格起课</span>
            （大安→月宫→日宫→时宫，三步顺数结果为程序严格计算，非 AI 猜测），
            起课确认后再交由 AI 依课解断 —— <span className="text-cyan-400">先起课，再解课</span>。
          </p>

          {/* 起课日期 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">📅 起课日期（阳历，必填）</label>
            <input
              type="date"
              value={solarDate}
              onChange={(e) => setSolarDate(e.target.value)}
              min="1900-01-01"
              max="2049-12-31"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            />
            <p className="text-xs text-slate-500 mt-1">按北京时间起课；问事一般以当下时间起课</p>
          </div>

          {/* 时辰 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">⏰ 起课时辰（必选）</label>
            <select
              value={timeIndex}
              onChange={(e) => setTimeIndex(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              {TIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 性别 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">👤 性别（影响婚恋用神）</label>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGender(g.value as "男" | "女" | "不指定")}
                  className={`px-3.5 py-1.5 text-sm rounded-lg border transition-all ${
                    gender === g.value
                      ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold"
                      : "border-slate-700 hover:bg-slate-800 text-slate-400"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* 所问事项类型 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">🗂️ 所问事项类型</label>
            <div className="flex flex-wrap gap-2">
              {QUESTION_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setQuestionType(t)}
                  className={`px-3.5 py-1.5 text-sm rounded-lg border transition-all ${
                    questionType === t
                      ? "bg-cyan-500/20 border-cyan-500 text-cyan-300 font-bold"
                      : "border-slate-700 hover:bg-slate-800 text-slate-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 具体问题 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">💬 具体想问的事（可选）</label>
            <textarea
              value={questionGoal}
              onChange={(e) => setQuestionGoal(e.target.value)}
              placeholder="例如：今天面试能否通过？这笔钱能不能借？"
              rows={3}
              maxLength={500}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
            />
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-xl text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleCastChart}
            disabled={loadingChart || !solarDate}
            className={`w-full py-3.5 rounded-xl font-bold text-base transition-all ${
              loadingChart || !solarDate
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
            }`}
          >
            {loadingChart ? "正在掐指起课…" : "第一步 · 掐指起课"}
          </button>
        </div>

        {/* 起课结果 */}
        {chartData && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
            {/* 起课信息 */}
            <div className="space-y-1.5 mb-5">
              <div className="text-xs text-slate-400">
                公历 {chartData.input.solarDate} · 农历 {chartData.lunar.yearGanZhi}年 {chartData.lunar.monthGanZhi}月 {chartData.lunar.dayGanZhi}日 {chartData.lunar.timeGanZhi}时
              </div>
              <div className="text-xs text-slate-400">
                生肖 {chartData.lunar.yearZodiac} · 农历 {chartData.lunar.month}月{chartData.lunar.day}日 · 时辰序号 {chartData.timeOrdinal}
              </div>
            </div>

            {/* 三步掌诀 */}
            <div className="mb-5">
              <div className="text-xs text-slate-500 mb-2">掌诀三步（从大安起）</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-slate-950 border border-slate-800">
                  <span className="w-14 text-slate-500 text-xs">① 月宫</span>
                  <span className="text-slate-400 text-xs">大安起 {chartData.lunar.month} 月</span>
                  <span className="text-slate-500 text-xs">→</span>
                  <span className="text-base font-bold text-cyan-300">{chartData.steps.monthGong}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-slate-950 border border-slate-800">
                  <span className="w-14 text-slate-500 text-xs">② 日宫</span>
                  <span className="text-slate-400 text-xs">{chartData.steps.monthGong}起 {chartData.lunar.day} 日</span>
                  <span className="text-slate-500 text-xs">→</span>
                  <span className="text-base font-bold text-cyan-300">{chartData.steps.dayGong}</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-slate-950 border border-slate-800">
                  <span className="w-14 text-slate-500 text-xs">③ 时宫</span>
                  <span className="text-slate-400 text-xs">{chartData.steps.dayGong}起 {chartData.timeOrdinal} 时辰</span>
                  <span className="text-slate-500 text-xs">→</span>
                  <span className="text-base font-bold text-cyan-300">{chartData.steps.timeGong}</span>
                </div>
              </div>
            </div>

            {/* 最终结果 */}
            {(() => {
              const colors = JI_XIONG_COLORS[chartData.result.jiXiong] || JI_XIONG_COLORS["中凶"];
              return (
                <div className={`p-4 rounded-xl border ${colors.bg} ${colors.border} mb-5`}>
                  <div className="flex items-baseline gap-3 mb-2">
                    <span className={`text-3xl font-bold ${colors.text}`}>{chartData.result.liuShen}</span>
                    <span className={`text-sm font-bold ${colors.text}`}>{chartData.result.jiXiong}</span>
                  </div>
                  <div className="text-xs text-slate-400 leading-relaxed">
                    五行 <span className={colors.text}>{chartData.result.wuxing}</span>
                    <span className="text-slate-600"> · </span>
                    方位 <span className={colors.text}>{chartData.result.fangwei}</span>
                    <span className="text-slate-600"> · </span>
                    体象 <span className={colors.text}>{chartData.result.tiXiang}</span>
                    <span className="text-slate-600"> · </span>
                    主数 <span className={colors.text}>{chartData.result.shu}</span>
                    <span className="text-slate-600"> · </span>
                    季 <span className={colors.text}>{chartData.result.season}</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-200 leading-relaxed">
                    {chartData.result.brief}
                  </div>
                </div>
              );
            })()}

            {/* 边界提醒 */}
            {chartData.warnings.length > 0 && (
              <div className="mt-4 p-2.5 bg-amber-950/40 border border-amber-900 rounded-lg text-[11px] text-amber-300 leading-relaxed">
                {chartData.warnings.join(" ")}
              </div>
            )}

            {/* 第二步：解课 */}
            <button
              type="button"
              onClick={handleInterpret}
              disabled={interpretLoading}
              className={`mt-5 w-full py-3.5 rounded-xl font-bold text-base transition-all ${
                interpretLoading
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-lg shadow-cyan-500/20"
              }`}
            >
              {interpretLoading ? "正在依课解断，请稍候…" : "第二步 · AI 依课解断"}
            </button>
          </div>
        )}

        {/* 解课结果 */}
        {answer && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-cyan-400 mb-4 flex items-center gap-2">
              <span>📖</span> 小六壬鉴断
            </h2>
            <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
              {answer}
              {interpretLoading && <span className="inline-block w-2 h-4 ml-1 bg-cyan-400 animate-pulse align-middle" />}
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-600 text-center mt-8">
          掌诀仅呈现特定时空的趋势信息，事在人为 · 仅供娱乐参考，不做医疗、投资等决策依据
        </p>
      </div>
    </div>
  );
}