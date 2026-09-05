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
const METHODS = [
  { value: "time", label: "时间起卦（按当前时辰自动）" },
  { value: "number", label: "数字起卦（两个 1-999 的数字）" },
];

interface LiuyaoYao {
  position: number;
  yinYang: "阳" | "阴";
  gan: string;
  zhi: string;
  zhiWuxing: string;
  liuqin: string;
  liushou: string;
  isShi: boolean;
  isYing: boolean;
  isDong: boolean;
  bianYinYang?: "阳" | "阴";
  bianGan?: string;
  bianZhi?: string;
}

interface LiuyaoChart {
  benGua: string;
  benUpperTrigram: string;
  benLowerTrigram: string;
  bianGua: string;
  bianUpperTrigram: string;
  bianLowerTrigram: string;
  dongYaoIndices: number[];
  shiYaoIndex: number;
  yingYaoIndex: number;
  guaGong: string;
  guaGongWuxing: string;
  liuqinOfSelf: string;
  yaoList: LiuyaoYao[];
}

interface LiuyaoFullPayload {
  input: {
    solarDate: string;
    timeIndex: number;
    questionType: string;
    questionGoal: string;
    method: string;
    gender?: string;
  };
  ganzhi: { year: string; month: string; day: string; time: string };
  chart: LiuyaoChart;
  yongShen: { name: string; reason: string; position: number | null };
  detectedPatterns: Array<{ name: string; nature: "吉" | "凶" | "中性"; note: string }>;
  warnings: string[];
  recordId?: string | null;
}

export default function LiuyaoPage() {
  const [solarDate, setSolarDate] = useState("");
  const [timeIndex, setTimeIndex] = useState<number>(6);
  const [method, setMethod] = useState<"time" | "number">("time");
  const [numberA, setNumberA] = useState<string>("");
  const [numberB, setNumberB] = useState<string>("");
  const [questionType, setQuestionType] = useState("求财");
  const [questionGoal, setQuestionGoal] = useState("");
  const [gender, setGender] = useState<"男" | "女" | "不指定">("不指定");
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<LiuyaoFullPayload | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleCastChart = async () => {
    if (!solarDate) {
      setErrorMsg("请先选择起卦日期");
      return;
    }
    if (method === "number") {
      const a = Number(numberA);
      const b = Number(numberB);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || a > 999 || b < 1 || b > 999) {
        setErrorMsg("数字起卦需提供两个 1-999 范围内的整数");
        return;
      }
    }
    setLoadingChart(true);
    setErrorMsg(null);
    setChartData(null);
    setAnswer("");

    try {
      const res = await fetch("/api/liuyao-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType,
          questionGoal: questionGoal.trim() || undefined,
          method,
          numberA: method === "number" ? Number(numberA) : undefined,
          numberB: method === "number" ? Number(numberB) : undefined,
          gender,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "起卦失败，请稍后重试");
      }
      setChartData((await res.json()) as LiuyaoFullPayload);
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
      const res = await fetch("/api/liuyao-interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          solarDate,
          timeIndex,
          questionType,
          questionGoal: questionGoal.trim() || undefined,
          method,
          numberA: method === "number" ? Number(numberA) : undefined,
          numberB: method === "number" ? Number(numberB) : undefined,
          gender,
          recordId: chartData.recordId || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "解卦失败，请稍后重试");
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
          <h1 className="text-xl font-bold tracking-wider text-amber-400">六爻 · 起卦解卦</h1>
          <div className="w-12"></div>
        </div>

        {/* ── 六爻专属 Hero Banner：卦象六爻线 ── */}
        <div data-banner="liuyao" className="relative overflow-hidden rounded-2xl mb-6 p-5 border border-amber-900/50 bg-gradient-to-br from-amber-950/30 via-slate-900 to-rose-950/30 shadow-lg">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <svg viewBox="0 0 120 120" className="w-20 h-20 flex-shrink-0" aria-hidden="true">
              {/* 水火既济卦象：阴阳爻组合 */}
              <g stroke="rgba(245,158,11,0.85)" strokeWidth="3.5" strokeLinecap="round">
                <line x1="20" y1="20" x2="50" y2="20" />
                <line x1="70" y1="20" x2="100" y2="20" />
                <line x1="20" y1="36" x2="100" y2="36" />
                <line x1="20" y1="52" x2="48" y2="52" />
                <line x1="72" y1="52" x2="100" y2="52" />
                <line x1="20" y1="68" x2="100" y2="68" />
                <line x1="20" y1="84" x2="48" y2="84" />
                <line x1="72" y1="84" x2="100" y2="84" />
                <line x1="20" y1="100" x2="100" y2="100" />
              </g>
              {/* 动爻标记（第三爻） */}
              <text x="110" y="56" fontSize="9" fill="rgba(244,63,94,0.95)" fontWeight="bold">动</text>
            </svg>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-base font-bold text-amber-300">周易古占 · 铜钱摇卦</span>
                <span className="text-[10px] text-rose-300/80 font-mono tracking-widest">LIÙ YÁO</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                京房纳甲法，秦汉以来最盛之占。一卦六爻，初爻为始、上爻为终；
                <span className="text-amber-300 font-semibold">纳甲</span>
                排干支于爻中、<span className="text-emerald-300 font-semibold">六亲</span>
                据卦宫定之、<span className="text-rose-300 font-semibold">六兽</span>
                按时起之，世应定位、用神居中。本局程序严判卦象、纳甲、世应、动爻、用神、格局。
              </p>
            </div>
          </div>
        </div>

        {/* 输入表单 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8 space-y-5">
          <p className="text-xs text-slate-500 leading-relaxed">
            本功能由程序先用 <span className="text-amber-400">确定性京房纳甲算法严格起卦</span>
            （前后卦、纳甲、六亲、六兽、世应、动爻、用神、命中格局均为计算，非 AI 猜测），
            起卦确认后再交由 AI 依盘解卦 —— <span className="text-amber-400">先起卦，再解卦</span>。
          </p>

          {/* 起卦日期 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">📅 起卦日期（阳历，必填）</label>
            <input
              type="date"
              value={solarDate}
              onChange={(e) => setSolarDate(e.target.value)}
              min="1900-01-01"
              max="2049-12-31"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
            />
            <p className="text-xs text-slate-500 mt-1">按北京时间起卦；问事一般以当下时间起卦</p>
          </div>

          {/* 时辰 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">⏰ 起卦时辰（必选）</label>
            <select
              value={timeIndex}
              onChange={(e) => setTimeIndex(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
            >
              {TIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 起卦方式 */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">🔮 起卦方式</label>
            <div className="flex flex-wrap gap-2">
              {METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMethod(m.value as "time" | "number")}
                  className={`px-3.5 py-1.5 text-sm rounded-lg border transition-all ${
                    method === m.value
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
                      : "border-slate-700 hover:bg-slate-800 text-slate-400"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* 数字输入（仅 number 方式） */}
          {method === "number" && (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                🔢 两个数字（1-999；上下卦数 = a+b，动爻 = a % 6）
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={numberA}
                  onChange={(e) => setNumberA(e.target.value)}
                  placeholder="数字 A（如 1）"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                />
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={numberB}
                  onChange={(e) => setNumberB(e.target.value)}
                  placeholder="数字 B（如 23）"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          )}

          {/* 性别（影响婚恋用神） */}
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
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
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
                      ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
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
              placeholder="例如：这笔投资该不该进？对方是不是对的人？"
              rows={3}
              maxLength={500}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
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
                : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"
            }`}
          >
            {loadingChart ? "正在起卦排盘…" : "第一步 · 起卦排卦"}
          </button>
        </div>

        {/* 排卦结果：卦象 + 六爻列表 */}
        {chartData && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
            {/* 起卦信息 */}
            <div className="space-y-1.5 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold text-amber-300">{chartData.chart.benGua}</span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-slate-400">
                  变 <span className="text-purple-300">{chartData.chart.bianGua}</span>
                </span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-slate-400">{chartData.chart.guaGong}（{chartData.chart.guaGongWuxing}）</span>
              </div>
              <div className="text-xs text-slate-400">
                公历 {chartData.input.solarDate} · 干支 {chartData.ganzhi.year}年 {chartData.ganzhi.month}月 {chartData.ganzhi.day}日 {chartData.ganzhi.time}时
              </div>
              <div className="text-xs text-slate-400">
                上卦 <span className="text-emerald-300">{chartData.chart.benUpperTrigram}</span>
                <span className="text-slate-600"> / </span>
                下卦 <span className="text-emerald-300">{chartData.chart.benLowerTrigram}</span>
                <span className="text-slate-600"> · </span>
                世爻 <span className="text-amber-300">{chartData.chart.shiYaoIndex}爻</span>
                <span className="text-slate-600"> · </span>
                应爻 <span className="text-amber-300">{chartData.chart.yingYaoIndex}爻</span>
                <span className="text-slate-600"> · </span>
                动爻 <span className="text-purple-300">{chartData.chart.dongYaoIndices.join("/")}爻</span>
                <span className="text-slate-600"> · </span>
                卦主 <span className="text-emerald-300">{chartData.chart.liuqinOfSelf}</span>
              </div>
              <div className="text-xs text-slate-300">
                用神：<span className="text-amber-300 font-bold">{chartData.yongShen.name}</span>
                {chartData.yongShen.position === null && (
                  <span className="text-slate-500">（伏藏）</span>
                )}
              </div>
            </div>

            {/* 六爻列表（自下而上 1→6） */}
            <div className="space-y-1">
              {chartData.chart.yaoList
                .slice()
                .sort((a, b) => b.position - a.position)
                .map((y) => (
                  <div
                    key={y.position}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${
                      y.isShi
                        ? "bg-amber-950/40 border border-amber-800"
                        : y.isYing
                        ? "bg-sky-950/40 border border-sky-800"
                        : "bg-slate-950 border border-slate-800"
                    }`}
                  >
                    <span className="w-8 text-slate-500">{["初", "二", "三", "四", "五", "上"][y.position - 1]}爻</span>
                    <span className="w-6 text-center font-bold text-slate-200">{y.yinYang === "阳" ? "—" : "- -"}</span>
                    <span className="w-14 text-amber-300 font-bold">{y.gan}{y.zhi}</span>
                    <span className="w-8 text-[11px] text-slate-500">{y.zhiWuxing}</span>
                    <span className="w-12 text-emerald-300">{y.liuqin}</span>
                    <span className="w-12 text-purple-300">{y.liushou}</span>
                    <span className="flex-1 flex items-center gap-1.5">
                      {y.isShi && <span className="text-[10px] px-1.5 py-0.5 bg-amber-700 text-amber-100 rounded">世</span>}
                      {y.isYing && <span className="text-[10px] px-1.5 py-0.5 bg-sky-700 text-sky-100 rounded">应</span>}
                      {y.isDong && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-purple-800 text-purple-100 rounded">
                          动 → {y.bianYinYang} {y.bianGan}{y.bianZhi}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
            </div>

            {/* 命中格局 */}
            {chartData.detectedPatterns.length > 0 && (
              <div className="mt-4">
                <div className="text-xs text-slate-500 mb-1.5">命中格局</div>
                <div className="flex flex-wrap gap-2">
                  {chartData.detectedPatterns.map((p, i) => (
                    <span
                      key={i}
                      title={p.note}
                      className={`text-[11px] px-2 py-1 rounded-lg border ${
                        p.nature === "吉"
                          ? "border-emerald-800 bg-emerald-950/60 text-emerald-300"
                          : p.nature === "凶"
                          ? "border-red-900 bg-red-950/60 text-red-300"
                          : "border-slate-700 bg-slate-950 text-slate-300"
                      }`}
                    >
                      {p.nature === "吉" ? "吉" : p.nature === "凶" ? "凶" : "中性"}·{p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 边界提醒 */}
            {chartData.warnings.length > 0 && (
              <div className="mt-4 p-2.5 bg-amber-950/40 border border-amber-900 rounded-lg text-[11px] text-amber-300 leading-relaxed">
                {chartData.warnings.join(" ")}
              </div>
            )}

            {/* 第二步：解卦 */}
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
              {interpretLoading ? "正在依卦解卦，请稍候…" : "第二步 · AI 依卦解卦"}
            </button>
          </div>
        )}

        {/* 解卦结果 */}
        {answer && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <span>📖</span> 六爻鉴析
            </h2>
            <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed">
              {answer}
              {interpretLoading && <span className="inline-block w-2 h-4 ml-1 bg-amber-400 animate-pulse align-middle" />}
            </div>
          </div>
        )}

        <p className="text-[11px] text-slate-600 text-center mt-8">
          卦象仅呈现特定时空的趋势信息，事在人为 · 仅供娱乐参考，不做医疗、投资等决策依据
        </p>
      </div>
    </div>
  );
}