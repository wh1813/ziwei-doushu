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
  { value: 12, label: "晚子时 23:00-24:00" },
];

const QUESTION_TYPES = ["事业", "求财", "感情", "考试", "健康", "出行", "诉讼", "寻物", "其他"];

// 洛书九宫展示顺序（左上4起，按行读：4-9-2 / 3-5-7 / 8-1-6）
const GRID_ORDER = [4, 9, 2, 3, 5, 7, 8, 1, 6];

interface QimenPalace {
  palace: number;
  name: string;
  direction: string;
  trigram: string;
  element: string;
  earthStem: string | null;
  skyStem: string | null;
  stemRelation: string | null;
  star: string | null;
  starElement: string | null;
  starPalaceRelation: string | null;
  door: string | null;
  doorElement: string | null;
  doorPalaceRelation: string | null;
  god: string | null;
  isCenter: boolean;
  hostsCenter: boolean;
  hostingNote: string | null;
}

interface QimenChartPayload {
  input: { solarDate: string; timeIndex: number; hour: number; minute: number };
  ganzhi: {
    year: string; month: string; day: string; time: string;
    dayXun: string; dayXunKong: string; timeXun: string; timeXunKong: string;
  };
  lunar: { year: number; month: number; day: number; monthText: string; dayText: string; isLeapMonth: boolean };
  jieqi: { activeJie: string; activeJieAt: string; nextJie: string | null; nextJieAt: string | null };
  chart: {
    dunType: string;
    yuan: string;
    juNumber: number;
    xunshou: string;
    hiddenYi: string;
    kongwang: string[];
    kongwangPalaces: number[];
    dayKongwang: string[];
    dayKongwangPalaces: number[];
    timeStemVisible: string;
    timePalace: number;
    xunshouPalace: number;
    dayStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
    yearStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
    monthStem: { stem: string; rawPalace: number | null; palace: number | null; note: string | null };
    yima: { branch: string | null; palace: number | null };
    zhifu: { star: string; palace: number };
    zhishi: { door: string; palace: number };
    detectedPatterns: { name: string; palace: number; detail: string; nature: string }[];
    activeJie: string;
    warnings: string[];
    palaces: QimenPalace[];
  };
}

export default function QimenPage() {
  const [solarDate, setSolarDate] = useState("");
  const [timeIndex, setTimeIndex] = useState<number>(6);
  const [questionType, setQuestionType] = useState("事业");
  const [questionGoal, setQuestionGoal] = useState("");
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<QimenChartPayload | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCastChart = async () => {
    if (!solarDate) {
      setErrorMsg("请先选择起局日期");
      return;
    }
    setLoadingChart(true);
    setErrorMsg(null);
    setChartData(null);
    setAnswer("");

    try {
      const res = await fetch("/api/qimen-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType: questionType,
          questionGoal: questionGoal.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "排盘失败，请稍后重试");
      }
      setChartData((await res.json()) as QimenChartPayload);
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
      const res = await fetch("/api/qimen-interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType: questionType,
          questionGoal: questionGoal.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "解盘失败，请稍后重试");
      }

      // SSE 流式读取
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

  const chart = chartData?.chart;
  const palaceMap = new Map<number, QimenPalace>((chart?.palaces ?? []).map((p) => [p.palace, p]));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
          <Link href="/" className="text-slate-400 hover:text-white text-sm flex items-center gap-1">
            ← 返回首页
          </Link>
          <h1 className="text-xl font-bold tracking-wider text-emerald-400">奇门遁甲 · 起局解盘</h1>
          <div className="w-12"></div>
        </div>

        {/* 输入表单 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8 space-y-5">
          <p className="text-xs text-slate-500 leading-relaxed">
            本功能由程序先用 <span className="text-emerald-400">确定性算法严格起局</span>
            （阴阳遁、定局、天地盘干、九星、八门、八神、旬空、值符值使均为代码计算，非 AI 猜测），
            排盘确认后再交由 AI 依用神与格局解盘 —— <span className="text-emerald-400">先排盘，再解盘</span>。
          </p>

          {/* 起局日期 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">📅 起局日期（阳历，必填）</label>
            <input
              type="date"
              value={solarDate}
              onChange={(e) => setSolarDate(e.target.value)}
              min="1900-01-01"
              max="2049-12-31"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-1">按北京时间起局；问事一般以当下时间起局</p>
          </div>

          {/* 时辰 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">⏰ 起局时辰（必选）</label>
            <select
              value={timeIndex}
              onChange={(e) => setTimeIndex(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              {TIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
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
                      ? "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold"
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
              placeholder="例如：这份工作要不要跳？这笔投资能不能进？官司能不能赢？"
              rows={3}
              maxLength={500}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 resize-none"
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
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-500/20"
            }`}
          >
            {loadingChart ? "正在起局排盘…" : "第一步 · 起局排盘"}
          </button>
        </div>

        {/* 排盘结果：信息栏 + 九宫格 */}
        {chartData && chart && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <span className="text-lg font-bold text-emerald-400">
                {chart.dunType}{chart.juNumber}局
              </span>
              <span className="text-xs text-slate-400">{chart.yuan}</span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-400">节令 {chart.activeJie}</span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-400">旬首 {chart.xunshou}（遁{chart.hiddenYi}）</span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-400">
                值符 {chart.zhifu.star}·{chart.zhifu.palace}宫
              </span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-400">
                值使 {chart.zhishi.door}·{chart.zhishi.palace}宫
              </span>
            </div>

            <div className="text-xs text-slate-400 mb-1">
              公历 {chartData.input.solarDate} · 干支 {chartData.ganzhi.year}年 {chartData.ganzhi.month}月 {chartData.ganzhi.day}日 {chartData.ganzhi.time}时
              <span className="text-slate-600"> （农历{chartData.lunar.isLeapMonth ? "闰" : ""}{chartData.lunar.monthText}月{chartData.lunar.dayText}）</span>
            </div>
            <div className="text-xs text-slate-400 mb-1">
              时空亡 <span className="text-amber-400">{chart.kongwang.join("")}</span>（{chart.kongwangPalaces.join("、") || "无"}宫）
              <span className="text-slate-600"> · </span>
              日空亡 <span className="text-amber-400">{chart.dayKongwang.join("")}</span>（{chart.dayKongwangPalaces.join("、") || "无"}宫）
              <span className="text-slate-600"> · </span>
              驿马 <span className="text-sky-400">{chart.yima.branch ?? "无"}</span>（{chart.yima.palace ?? "-"}宫）
            </div>
            <div className="text-xs text-slate-400 mb-4">
              日干（求测人）<span className="text-emerald-300">{chart.dayStem.stem}</span> 落 {chart.dayStem.palace ?? "-"} 宫
              <span className="text-slate-600"> · </span>
              时干（所问之事）<span className="text-emerald-300">{chart.timeStemVisible}</span> 落 {chart.timePalace} 宫
            </div>

            {/* 九宫格 */}
            <div className="grid grid-cols-3 gap-2">
              {GRID_ORDER.map((no) => {
                const p = palaceMap.get(no);
                if (!p) return null;
                const isKong = chart.kongwangPalaces.includes(no) || chart.dayKongwangPalaces.includes(no);
                const isYima = chart.yima.palace === no;
                return (
                  <div
                    key={no}
                    className={`rounded-lg border p-2.5 text-center ${
                      p.isCenter
                        ? "border-slate-800 bg-slate-950/60"
                        : "border-slate-700 bg-slate-950"
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                      <span>{p.name}·{p.direction}</span>
                      <span>{no}</span>
                    </div>

                    {p.isCenter ? (
                      <div className="py-2">
                        <div className="text-sm text-slate-400">天禽（寄坤）</div>
                        <div className="text-[10px] text-slate-600 mt-0.5">{p.earthStem}</div>
                      </div>
                    ) : (
                      <>
                        <div className="text-xl font-bold text-emerald-300 leading-tight">{p.skyStem}</div>
                        <div className="text-sm text-slate-500 leading-tight">{p.earthStem}</div>
                        <div className="text-xs text-slate-300 mt-1.5">{p.star}</div>
                        <div className="text-xs text-amber-300">{p.door}</div>
                        <div className="text-[11px] text-purple-300">{p.god}</div>
                      </>
                    )}

                    <div className="flex flex-wrap justify-center gap-1 mt-1.5">
                      {p.hostingNote && (
                        <span className="text-[9px] px-1 rounded bg-slate-800 text-slate-400">寄坤</span>
                      )}
                      {isKong && (
                        <span className="text-[9px] px-1 rounded bg-amber-950 text-amber-400">空亡</span>
                      )}
                      {isYima && (
                        <span className="text-[9px] px-1 rounded bg-sky-950 text-sky-400">马星</span>
                      )}
                      {chart.zhifu.palace === no && (
                        <span className="text-[9px] px-1 rounded bg-purple-950 text-purple-300">值符</span>
                      )}
                      {chart.zhishi.palace === no && (
                        <span className="text-[9px] px-1 rounded bg-emerald-950 text-emerald-300">值使</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 格局 */}
            {chart.detectedPatterns.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-slate-500 mb-1.5">命中格局</div>
                <div className="flex flex-wrap gap-2">
                  {chart.detectedPatterns.map((pat, i) => (
                    <span
                      key={i}
                      className={`text-[11px] px-2 py-1 rounded-lg border ${
                        pat.nature === "吉"
                          ? "border-emerald-800 bg-emerald-950/60 text-emerald-300"
                          : "border-red-900 bg-red-950/60 text-red-300"
                      }`}
                      title={pat.detail}
                    >
                      {pat.nature === "吉" ? "吉" : "凶"}·{pat.name}（{pat.palace}宫）
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 提醒 */}
            {chart.warnings.length > 0 && (
              <div className="mt-4 p-2.5 bg-amber-950/40 border border-amber-900 rounded-lg text-[11px] text-amber-300 leading-relaxed">
                {chart.warnings.join(" ")}
              </div>
            )}

            {/* 第二步：解盘 */}
            <button
              type="button"
              onClick={handleInterpret}
              disabled={interpretLoading}
              className={`mt-5 w-full py-3.5 rounded-xl font-bold text-base transition-all ${
                interpretLoading
                  ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                  : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"
              }`}
            >
              {interpretLoading ? "正在依盘解盘，请稍候…" : "第二步 · AI 依盘解盘"}
            </button>
          </div>
        )}

        {/* 解盘结果 */}
        {answer && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <span>📖</span> 奇门鉴析
            </h2>
            <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
              {answer}
              {interpretLoading && <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse align-middle" />}
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-600 text-center mt-8">
          盘面仅呈现特定时空的趋势信息，事在人为 · 仅供娱乐参考，不做医疗、投资等决策依据
        </p>
      </div>
    </div>
  );
}
