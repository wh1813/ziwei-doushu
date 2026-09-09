"use client";

import React, { useLayoutEffect, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { useTheme } from "@/components/ThemeProvider";
import { getSkin } from "@/lib/ui/theme";

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

interface DaliurenSiKe {
  first:   { xia: string; shang: string };
  second:  { xia: string; shang: string };
  third:   { xia: string; shang: string };
  fourth:  { xia: string; shang: string };
}

interface DaliurenSanChuanRaw {
  chu:    { zhi: string; gan: string };
  zhong:  { zhi: string; gan: string };
  mo:     { zhi: string; gan: string };
  keti: '贼克' | '比用' | '涉害' | '无课' | string;
}

interface DaliurenPan {
  diban: { index: number; zhi: string; gan: string }[];
  tianban: { zhi: string; gan: string }[];
  yueJiang: string;
  yueJiangSuoCheng: string;
}

interface DaliurenGuiRen {
  yang: { zhi: string; cheng: '顺治' | '逆治' };
  yin:  { zhi: string; cheng: '顺治' | '逆治' };
  used: { zhi: string; cheng: '顺治' | '逆治' };
  isDay: boolean;
}

interface DaliurenFullPayload {
  input: {
    solarDate: string;
    timeIndex: number;
    questionType: string;
    questionGoal: string;
    gender?: string;
  };
  ganzhi: { year: string; month: string; day: string; time: string; monthZhi: string; dayGan: string; dayZhi: string };
  pan: DaliurenPan;
  guiren: DaliurenGuiRen;
  siKe: DaliurenSiKe;
  sanChuan: DaliurenSanChuanRaw;
  sanChuanLiuqin: { chu: string; zhong: string; mo: string };
  detected: string[];
  warnings: string[];
  recordId?: string | null;
}

export default function DaliurenPage() {
  const { theme } = useTheme();
  const skin = getSkin(theme);

  useLayoutEffect(() => {
    document.documentElement.style.background = skin.bgBase;
    document.body.style.background = skin.bgBase;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = '';
    };
  }, [skin.bgBase]);

  const [solarDate, setSolarDate] = useState("");
  const [timeIndex, setTimeIndex] = useState<number>(8);
  const [questionType, setQuestionType] = useState("求财");
  const [questionGoal, setQuestionGoal] = useState("");
  const [gender, setGender] = useState<"男" | "女" | "不指定">("不指定");
  const [loadingChart, setLoadingChart] = useState(false);
  const [chartData, setChartData] = useState<DaliurenFullPayload | null>(null);
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
      const res = await fetch("/api/daliuren-chart", {
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
      setChartData((await res.json()) as DaliurenFullPayload);
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
      const res = await fetch("/api/daliuren-interpret", {
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
    <div className="min-h-screen py-10 px-4" style={{ background: skin.bgBase, color: skin.textPrimary, transition: 'background 0.35s ease' }}>
      <div className="max-w-3xl mx-auto pt-14">
        <TopNav />
        {/* 页面标题 */}
        <div className="flex items-center justify-between mt-4 mb-6 pb-4 border-b" style={{ borderColor: skin.borderSubtle }}>
          <h1 className="text-xl font-bold tracking-wider" style={{ color: skin.gold }}>大六壬 · 起课解课</h1>
          <div className="w-12"></div>
        </div>

        {/* ── 大六壬专属 Hero Banner：天地盘叠加意象 ── */}
        <div data-banner="daliuren" className="relative overflow-hidden rounded-2xl mb-6 p-5 border border-indigo-900/50 bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 shadow-lg">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <svg viewBox="0 0 120 120" className="w-20 h-20 flex-shrink-0" aria-hidden="true">
              {/* 地盘（外圈） */}
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(99,102,241,0.45)" strokeWidth="1.5" />
              <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(99,102,241,0.25)" strokeWidth="0.5" strokeDasharray="2 3" />
              {/* 天盘（内圈，旋转 15°） */}
              <g transform="rotate(15 60 60)">
                <circle cx="60" cy="60" r="32" fill="none" stroke="rgba(165,180,252,0.75)" strokeWidth="1.5" />
                <circle cx="60" cy="60" r="32" fill="none" stroke="rgba(165,180,252,0.3)" strokeDasharray="2 3" strokeWidth="0.5" />
              </g>
              {/* 月将点 */}
              <circle cx="60" cy="10" r="2.5" fill="rgba(240,208,112,0.95)" />
              {/* 天乙贵人点 */}
              <circle cx="105" cy="60" r="2.5" fill="rgba(244,114,182,0.95)" />
              {/* 中宫五 */}
              <text x="60" y="63" fontSize="9" fontWeight="bold" textAnchor="middle" fill="rgba(255,255,255,0.85)">五</text>
              {/* 旋转箭头 */}
              <path d="M 60 14 A 50 50 0 0 1 86 30" fill="none" stroke="rgba(165,180,252,0.6)" strokeWidth="1.2" />
              <polygon points="86,30 89,26 92,30" fill="rgba(165,180,252,0.6)" />
            </svg>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-1.5">
                <span className="text-base font-bold" style={{ color: skin.goldLight }}>袖中一诀 · 天地盘叠</span>
                <span className="text-[10px] text-sky-300/80 font-mono tracking-widest">DÀ LIÙ RÉN</span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: skin.textSecond }}>
                大六壬，<span className="text-amber-300 font-semibold">月将加时</span>，地盘不动、天盘旋转叠合；
                取<span className="text-rose-300 font-semibold">天乙贵人</span>
                （阳贵阴贵分顺逆），
                <span className="font-semibold" style={{ color: skin.goldLight }}>贼克/比用/涉害</span>
                推四课三传——初传发用、中传进退、末传归结。本局程序严判十二天神、天地盘、四课三传、贼克三法。
              </p>
            </div>
          </div>
        </div>

        {/* 输入表单 */}
        <div className="border rounded-2xl p-6 shadow-xl mb-8 space-y-5" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
          <p className="text-xs leading-relaxed" style={{ color: skin.textDim }}>
            本功能由程序先用 <span style={{ color: skin.gold }}>确定性大六壬算法起课</span>
            （月将、天地盘、天乙贵人、四课、三传、贼克/比用/涉害推算均为程序严格计算，非 AI 猜测），
            起课确认后再交由 AI 依课解断 —— <span style={{ color: skin.gold }}>先起课，再解课</span>。
          </p>

          {/* 起课日期 */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>📅 起课日期（阳历，必填）</label>
            <input
              type="date"
              value={solarDate}
              onChange={(e) => setSolarDate(e.target.value)}
              min="1900-01-01"
              max="2049-12-31"
              className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-slate-500" style={{ background: skin.bgInput, borderColor: skin.border, color: skin.textPrimary }}
            />
            <p className="text-xs mt-1" style={{ color: skin.textDim }}>按北京时间起课；问事一般以当下时间起课</p>
          </div>

          {/* 时辰 */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>⏰ 起课时辰（必选）</label>
            <select
              value={timeIndex}
              onChange={(e) => setTimeIndex(Number(e.target.value))}
              className="w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-slate-500" style={{ background: skin.bgInput, borderColor: skin.border, color: skin.textPrimary }}
            >
              {TIME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* 性别 */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>👤 性别（影响婚恋用神）</label>
            <div className="flex flex-wrap gap-2">
              {GENDERS.map((g) => (
                <button
                  key={g.value}
                  type="button"
                  onClick={() => setGender(g.value as "男" | "女" | "不指定")}
                  className="px-3.5 py-1.5 text-sm rounded-lg border transition-all"
                  style={gender === g.value
                    ? { background: "rgba(212,175,55,0.12)", borderColor: skin.gold, color: skin.goldLight, fontWeight: 700 }
                    : { borderColor: skin.border, color: skin.textMuted }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          {/* 所问事项类型 */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>🗂️ 所问事项类型</label>
            <div className="flex flex-wrap gap-2">
              {QUESTION_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setQuestionType(t)}
                  className="px-3.5 py-1.5 text-sm rounded-lg border transition-all"
                  style={questionType === t
                    ? { background: "rgba(212,175,55,0.12)", borderColor: skin.gold, color: skin.goldLight, fontWeight: 700 }
                    : { borderColor: skin.border, color: skin.textMuted }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 具体问题 */}
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>💬 具体想问的事（可选）</label>
            <textarea
              value={questionGoal}
              onChange={(e) => setQuestionGoal(e.target.value)}
              placeholder="例如：这笔投资该不该进？对方是不是对的人？"
              rows={3}
              maxLength={500}
              className="w-full border rounded-lg p-3 text-sm placeholder-slate-500 focus:outline-none focus:border-slate-500 resize-none" style={{ background: skin.bgInput, borderColor: skin.border, color: skin.textPrimary }}
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
            className="w-full py-3.5 rounded-xl font-bold text-base transition-all"
            style={loadingChart || !solarDate
              ? { background: skin.bgElevated, color: skin.textDim, cursor: "not-allowed" }
              : { background: skin.gold, color: skin.textOnGold, boxShadow: "0 10px 15px -3px rgba(212,175,55,0.25)" }}
          >
            {loadingChart ? "正在起课排盘…" : "第一步 · 起课排盘"}
          </button>
        </div>

        {/* 排课结果：天盘/地盘 + 四课 + 三传 */}
        {chartData && (
          <div className="border rounded-2xl p-6 shadow-xl mb-8" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
            {/* 起课信息 */}
            <div className="space-y-1.5 mb-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold" style={{ color: skin.goldLight }}>{chartData.sanChuan.keti}课</span>
                <span className="text-xs" style={{ color: skin.textDim }}>·</span>
                <span className="text-xs" style={{ color: skin.textMuted }}>{chartData.detected.join(" / ")}</span>
              </div>
              <div className="text-xs" style={{ color: skin.textMuted }}>
                公历 {chartData.input.solarDate} · 干支 {chartData.ganzhi.year}年 {chartData.ganzhi.month}月 {chartData.ganzhi.day}日 {chartData.ganzhi.time}时
              </div>
              <div className="text-xs" style={{ color: skin.textMuted }}>
                月将 <span className="text-emerald-300">{chartData.pan.yueJiang}</span>（乘 {chartData.pan.yueJiangSuoCheng}）
                <span style={{ color: skin.textDim }}> · </span>
                天乙贵人 <span className="text-amber-300">{chartData.guiren.used.zhi}</span>（{chartData.guiren.used.cheng}）
                <span style={{ color: skin.textDim }}> · </span>
                日干 <span className="text-emerald-300">{chartData.ganzhi.dayGan}</span>
              </div>
            </div>

            {/* 四课 */}
            <div className="mb-5">
              <div className="text-xs mb-2" style={{ color: skin.textDim }}>四课</div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "第一课", data: chartData.siKe.first },
                  { label: "第二课", data: chartData.siKe.second },
                  { label: "第三课", data: chartData.siKe.third },
                  { label: "第四课", data: chartData.siKe.fourth },
                ].map((k, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}
                  >
                    <span className="w-14 text-xs" style={{ color: skin.textDim }}>{k.label}</span>
                    <span className="text-[10px]" style={{ color: skin.textDim }}>上</span>
                    <span className="w-14 text-amber-300 font-bold">{k.data.shang}</span>
                    <span className="text-[10px]" style={{ color: skin.textDim }}>下</span>
                    <span className="w-14 text-emerald-300 font-bold">{k.data.xia}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 三传 */}
            <div className="mb-5">
              <div className="text-xs mb-2" style={{ color: skin.textDim }}>三传</div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "初传", data: chartData.sanChuan.chu, liuqin: chartData.sanChuanLiuqin.chu },
                  { label: "中传", data: chartData.sanChuan.zhong, liuqin: chartData.sanChuanLiuqin.zhong },
                  { label: "末传", data: chartData.sanChuan.mo, liuqin: chartData.sanChuanLiuqin.mo },
                ].map((c, i) => (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-lg text-sm border ${
                      c.label === "初传"
                        ? "bg-indigo-950/40 border-indigo-800"
                        : c.label === "中传"
                        ? "bg-purple-950/40 border-purple-800"
                        : "bg-slate-950 border-slate-800"
                    }`}
                  >
                    <div className="text-xs mb-1" style={{ color: skin.textDim }}>{c.label}</div>
                    <div className="text-base font-bold" style={{ color: skin.goldLight }}>{c.data.zhi}{c.data.gan}</div>
                    <div className="text-xs mt-0.5" style={{ color: skin.textMuted }}>{c.liuqin}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 天盘/地盘对照 */}
            <details className="mb-4">
              <summary className="text-xs cursor-pointer" style={{ color: skin.textDim }}>查看天地盘</summary>
              <div className="mt-2 space-y-1 text-[11px]">
                {chartData.pan.diban.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-0.5 rounded" style={{ background: skin.bgInput }}>
                    <span className="w-10 text-emerald-300">{d.zhi}</span>
                    <span style={{ color: skin.textDim }}>→</span>
                    <span className="w-10 text-amber-300">{chartData.pan.tianban[i]?.zhi}</span>
                  </div>
                ))}
              </div>
            </details>

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
              className="mt-5 w-full py-3.5 rounded-xl font-bold text-base transition-all"
              style={interpretLoading
                ? { background: skin.bgElevated, color: skin.textDim, cursor: "not-allowed" }
                : { background: skin.gold, color: skin.textOnGold, boxShadow: "0 10px 15px -3px rgba(212,175,55,0.25)" }}
            >
              {interpretLoading ? "正在依课解断，请稍候…" : "第二步 · AI 依课解断"}
            </button>
          </div>
        )}

        {/* 解课结果 */}
        {answer && (
          <div className="border rounded-2xl p-6 shadow-2xl" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2" style={{ color: skin.gold }}>
              <span>📖</span> 大六壬鉴析
            </h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: skin.textPrimary }}>
              {answer}
              {interpretLoading && <span className="inline-block w-2 h-4 ml-1 animate-pulse align-middle" style={{ background: skin.gold }} />}
            </div>
          </div>
        )}

        <p className="text-[11px] text-center mt-8" style={{ color: skin.textDim }}>
          课体仅呈现特定时空的趋势信息，事在人为 · 仅供娱乐参考，不做医疗、投资等决策依据
        </p>
      </div>
    </div>
  );
}