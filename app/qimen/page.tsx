"use client";

import React, { useEffect, useState } from "react";
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
  personal: PersonalAnalysisPayload | null;
  chartUnfavorable: ChartUnfavorablePayload | null;
}

// ── 个人用神定位 / 全盘不利状态（附加检测层，接口见 lib/qimen/remedy.ts）──

interface StemStatesPayload {
  jiXing: boolean;
  jiXingDetail: string | null;
  ruMu: boolean;
  ruMuDetail: string | null;
  kongWangShi: boolean;
  kongWangRi: boolean;
  kongWangDetail: string | null;
}

interface SymbolPlacementPayload {
  role: string;
  birthStem: string;
  sourceStem: string;
  displaySymbol: string;
  onPlate: "天盘" | "地盘";
  rawPalace: number | null;
  palace: number | null;
  palaceName: string | null;
  direction: string | null;
  states: StemStatesPayload;
  note: string | null;
}

interface PersonalAnalysisPayload {
  birth: { date: string; timeIndex: number | null; hourLabel: string | null };
  baZi: { dayGanZhi: string; yearGanZhi: string };
  self: SymbolPlacementPayload;
  partner: SymbolPlacementPayload | null;
  yearSymbol: SymbolPlacementPayload & {
    zhifuProxy: { star: string; palace: number; palaceName: string | null; direction: string | null } | null;
  };
  liuhe: { palace: number | null; palaceName: string | null; direction: string | null; kongWang: boolean };
  guGuaHint: string | null;
  facts: string[];
  remedyHints: string[];
}

interface ChartUnfavorableItemPayload {
  palace: number;
  palaceName: string;
  direction: string;
  skyStem: string;
  earthStem: string | null;
  reason: string;
}

interface ChartUnfavorablePayload {
  jiXing: ChartUnfavorableItemPayload[];
  ruMu: ChartUnfavorableItemPayload[];
}

export default function QimenPage() {
  const [solarDate, setSolarDate] = useState("");
  const [timeIndex, setTimeIndex] = useState<number>(6);
  const [questionType, setQuestionType] = useState("事业");
  const [questionGoal, setQuestionGoal] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [birthTimeIndex, setBirthTimeIndex] = useState<number | null>(null);
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<QimenChartPayload | null>(null);
  const [interpretLoading, setInterpretLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 出生信息可选：填了日期才随请求提交（起局时间始终为上方当前时间）
  const birthPayload = birthDate
    ? { birthDate, birthTimeIndex: birthTimeIndex ?? undefined }
    : {};

  // 出生信息本地记忆：填一次即记住，此后无需重复提供（锁定日干/生年天干）
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("qimen_birth");
      if (raw) {
        const saved = JSON.parse(raw) as { birthDate?: string; birthTimeIndex?: number | null };
        if (saved && typeof saved.birthDate === "string" && saved.birthDate) {
          setBirthDate(saved.birthDate);
        }
        if (saved && typeof saved.birthTimeIndex === "number") {
          setBirthTimeIndex(saved.birthTimeIndex);
        }
      }
    } catch {
      // 本地存储不可用时静默降级：每次手动填写
    }
  }, []);

  useEffect(() => {
    try {
      if (birthDate) {
        window.localStorage.setItem(
          "qimen_birth",
          JSON.stringify({ birthDate, birthTimeIndex }),
        );
      } else {
        window.localStorage.removeItem("qimen_birth");
      }
    } catch {
      // 忽略写入失败（隐私模式等）
    }
  }, [birthDate, birthTimeIndex]);

  const handleCastChart = async (overrides?: {
    solarDate?: string;
    timeIndex?: number;
    questionType?: string;
    questionGoal?: string;
  }) => {
    const sd = overrides?.solarDate ?? solarDate;
    const ti = overrides?.timeIndex ?? timeIndex;
    const qt = overrides?.questionType ?? questionType;
    const qg = overrides?.questionGoal ?? questionGoal;
    if (!sd) {
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
          solarDate: sd,
          timeIndex: ti,
          questionType: qt,
          questionGoal: qg.trim() || undefined,
          ...birthPayload,
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
          ...birthPayload,
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

          {/* 出生信息（可选） */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              🎂 出生信息（可选 · 用于定位个人用神）
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                min="1900-01-01"
                max="2049-12-31"
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              />
              <select
                value={birthTimeIndex === null ? "" : String(birthTimeIndex)}
                onChange={(e) => setBirthTimeIndex(e.target.value === "" ? null : Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="">时辰不详（按正午计）</option>
                {TIME_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              只需填写一次，本机自动记住（localStorage），此后起局无需再提供；
              系统将按出生八字锁定「本人 / 日干合神 / 生年天干」符号并检测击刑、入墓、空亡。
              起局时间始终为上方当前时间（一事一局），解盘时先纯盘面解读、再定位个人用神宫位
            </p>
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
            onClick={() => handleCastChart()}
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
                      {chartData?.chartUnfavorable?.jiXing.some((x) => x.palace === no) && (
                        <span className="text-[9px] px-1 rounded bg-red-950 text-red-400">刑</span>
                      )}
                      {chartData?.chartUnfavorable?.ruMu.some((x) => x.palace === no) && (
                        <span className="text-[9px] px-1 rounded bg-red-950 text-red-400">墓</span>
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

            {/* 全盘不利状态（击刑/入墓，供解局对照） */}
            {chartData.chartUnfavorable &&
             (chartData.chartUnfavorable.jiXing.length > 0 || chartData.chartUnfavorable.ruMu.length > 0) && (
              <div className="mt-4 space-y-1">
                <div className="text-xs text-slate-500">全盘不利状态（解局依据）</div>
                {chartData.chartUnfavorable.jiXing.map((it, i) => (
                  <div key={`jx${i}`} className="text-[11px] text-red-300 leading-relaxed">
                    · 击刑｜第{it.palace}宫{it.palaceName}（{it.direction}）天盘{it.skyStem} —— {it.reason}
                  </div>
                ))}
                {chartData.chartUnfavorable.ruMu.map((it, i) => (
                  <div key={`rm${i}`} className="text-[11px] text-red-300 leading-relaxed">
                    · 入墓｜第{it.palace}宫{it.palaceName}（{it.direction}）天盘{it.skyStem} —— {it.reason}
                  </div>
                ))}
              </div>
            )}

            {/* 个人用神定位（提供出生信息时展示） */}
            {chartData.personal && (
              <div className="mt-4 p-3 border border-purple-900/60 bg-purple-950/20 rounded-lg space-y-3">
                <div className="text-xs text-slate-400">
                  个人用神定位 · 出生 {chartData.personal.birth.date}
                  {chartData.personal.birth.hourLabel ? ` ${chartData.personal.birth.hourLabel}` : ""}
                  <span className="text-slate-600">
                    {" "}· 八字日柱 {chartData.personal.baZi.dayGanZhi} · 生年 {chartData.personal.baZi.yearGanZhi}
                  </span>
                </div>
                {[
                  chartData.personal.self,
                  ...(chartData.personal.partner ? [chartData.personal.partner] : []),
                  chartData.personal.yearSymbol,
                ].map((sym, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">{sym.role}</span>
                    <span className="font-bold text-purple-300">{sym.displaySymbol}</span>
                    <span className="text-slate-400">
                      落 {sym.palaceName ?? "?"}（{sym.direction ?? "?"}·第{sym.palace ?? "?"}宫·{sym.onPlate}）
                    </span>
                    {(sym.states.jiXing || sym.states.ruMu || sym.states.kongWangShi || sym.states.kongWangRi ? [
                      ...(sym.states.jiXing ? [{ label: "击刑", cls: "bg-red-950 text-red-400" }] : []),
                      ...(sym.states.ruMu ? [{ label: "入墓", cls: "bg-red-950 text-red-400" }] : []),
                      ...(sym.states.kongWangShi || sym.states.kongWangRi ? [{ label: "空亡", cls: "bg-amber-950 text-amber-400" }] : []),
                    ] : [{ label: "平安", cls: "bg-emerald-950 text-emerald-300" }]).map((t, j) => (
                      <span key={j} className={`text-[9px] px-1 rounded ${t.cls}`}>{t.label}</span>
                    ))}
                    {sym.note && <span className="text-slate-600 w-full">{sym.note}</span>}
                  </div>
                ))}
                <div className="space-y-1">
                  {chartData.personal.facts.map((f, i) => (
                    <div key={i} className="text-[11px] text-slate-300 leading-relaxed">· {f}</div>
                  ))}
                </div>
                {chartData.personal.remedyHints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chartData.personal.remedyHints.map((h, i) =>
                      h.length <= 6 ? (
                        <span
                          key={i}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-amber-800 bg-amber-950/60 text-amber-300"
                        >
                          解局·{h}
                        </span>
                      ) : (
                        <div key={i} className="w-full text-[11px] text-amber-300 leading-relaxed">· {h}</div>
                      ),
                    )}
                  </div>
                )}
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
