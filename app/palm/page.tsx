"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/TopNav";
import { useTheme } from "@/components/ThemeProvider";
import { getSkin } from "@/lib/ui/theme";

type Mode = "palm" | "face";

const AGE_BANDS = [
  { value: "", label: "未填写" },
  { value: "10-18", label: "10-18 岁（少年）" },
  { value: "18-25", label: "18-25 岁（青年）" },
  { value: "25-35", label: "25-35 岁（壮年初）" },
  { value: "35-50", label: "35-50 岁（壮年中）" },
  { value: "50-65", label: "50-65 岁（中年初）" },
  { value: "65+", label: "65 岁以上（晚年）" },
];

export default function PalmPage() {
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

  const [mode, setMode] = useState<Mode>("palm");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [handSide, setHandSide] = useState<"left" | "right">("right");
  const [userGender, setUserGender] = useState<"male" | "female" | "unspecified">("unspecified");
  const [userAgeBand, setUserAgeBand] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 切换模式时清空图像与结果，避免脏数据
  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setImagePreview(null);
    setBase64Image(null);
    setResult(null);
    setErrorMsg(null);
    setQuestion("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // 压缩图片并转为 Base64，避免大图导致传输卡死
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setErrorMsg("请上传有效的图片文件 (JPG/PNG/WEBP)");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        const MAX_SIZE = 1200;
        if (width > height && width > MAX_SIZE) {
          height = Math.round((height * MAX_SIZE) / width);
          width = MAX_SIZE;
        } else if (height > MAX_SIZE) {
          width = Math.round((width * MAX_SIZE) / height);
          height = MAX_SIZE;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setImagePreview(compressedDataUrl);
        setBase64Image(compressedDataUrl);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleStartAnalyze = async () => {
    if (!base64Image) {
      setErrorMsg(
        mode === "face"
          ? "请先点击上方区域上传一张清晰的面部正面照！"
          : "请先点击上方区域上传一张清晰的手掌照片！",
      );
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const payload: any = {
        mode,
        image: base64Image,
        userId: "web-user",
        question: question.trim(),
      };
      if (mode === "palm") {
        payload.handSide = handSide;
      } else {
        payload.userGender = userGender;
        payload.userAgeBand = userAgeBand;
      }

      const res = await fetch("/api/analyze-palm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();

      if (!res.ok || !resData.success) {
        throw new Error(resData.error || "分析失败，请稍后重试");
      }

      setResult(resData);
    } catch (err: any) {
      setErrorMsg(err.message || "请求服务器失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  // 渲染单条线详解（三段式/卡片）
  const renderLine = (title: string, color: string, content?: string, fullWidth = false) => {
    if (!content) return null;
    return (
      <div className={`bg-slate-950/70 p-4 rounded-xl border border-slate-800 ${fullWidth ? "md:col-span-2" : ""}`}>
        <div className={`text-xs font-bold ${color} mb-2 flex items-center gap-1.5`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
          {title}
        </div>
        <p className="text-xs leading-relaxed whitespace-pre-line" style={{ color: skin.textPrimary }}>{content}</p>
      </div>
    );
  };

  // 渲染四维运势
  const renderFortune = (key: string, icon: string, title: string) => {
    const content = report?.fortuneAnalysis?.[key];
    if (!content) return null;
    return (
      <div className="p-3.5 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
        <div className="text-xs font-semibold mb-1.5 flex items-center gap-1" style={{ color: skin.textMuted }}>
          <span>{icon}</span> {title}
        </div>
        <div className="text-xs leading-relaxed" style={{ color: skin.textPrimary }}>{content}</div>
      </div>
    );
  };

  const report = result?.data;
  const isFace = mode === "face";
  const isPalm = mode === "palm";

  return (
    <div className="min-h-screen text-slate-100 py-10 px-4" style={{ background: skin.bgInput }}>
      <div className="max-w-3xl mx-auto pt-14">
        <TopNav />
        {/* 页面标题 */}
        <div className="flex items-center justify-between mt-4 mb-6 pb-4 border-b" style={{ borderColor: skin.borderSubtle }}>
          <h1 className="text-xl font-bold tracking-wider" style={{ color: skin.gold }}>
            {isFace ? "AI 智能相术 · 面相深度鉴析" : "AI 智能相术 · 手相深度鉴析"}
          </h1>
          <div className="w-12"></div>
        </div>

        {/* 模式切换 Tab */}
        <div className="flex gap-2 mb-6 border rounded-2xl p-1.5 shadow-lg" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
          <button
            type="button"
            onClick={() => switchMode("palm")}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all"
            style={isPalm
              ? { background: skin.gold, color: skin.textOnGold, boxShadow: "0 4px 6px -1px rgba(212,175,55,0.3)" }
              : { color: skin.textMuted }}
          >
            <span className="mr-2">✋</span>手相
          </button>
          <button
            type="button"
            onClick={() => switchMode("face")}
            className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
              isFace
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            }`}
          >
            <span className="mr-2">👤</span>面相
          </button>
        </div>

        {/* 主输入区域 */}
        <div className="border rounded-2xl p-6 shadow-xl mb-8" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
          {/* 上传区域 */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-950/50 relative overflow-hidden group min-h-[220px] flex flex-col items-center justify-center ${
              isFace ? "border-slate-700 hover:border-emerald-500" : "border-slate-700 hover:border-slate-500"
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />

            {imagePreview ? (
              <div className="relative w-full max-h-80 flex flex-col items-center justify-center">
                <img
                  src={imagePreview}
                  alt={isFace ? "面部预览" : "手掌预览"}
                  className="max-h-72 object-contain rounded-lg shadow-md"
                />
                <p className={`text-xs mt-2 ${isFace ? "text-emerald-400" : "text-amber-400"}`}>
                  ✓ 照片已加载（点击可重新上传更换）
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                  {isFace ? "👤" : "✋"}
                </div>
                <div className="text-sm font-medium" style={{ color: skin.textSecond }}>
                  点击拍照或上传{isFace ? "面部正面" : "手掌"}照片
                </div>
                <p className="text-xs max-w-xs mx-auto" style={{ color: skin.textDim }}>
                  {isFace
                    ? "请正面免冠、五官清晰、光线均匀，避免戴墨镜或口罩"
                    : "请掌心朝上、五指自然伸展、光线均匀，避免反光或模糊"}
                </p>
              </div>
            )}
          </div>

          {/* 模式相关表单字段 */}
          {isPalm && (
            <div className="mt-6 flex items-center justify-between p-4 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
              <div className="flex flex-col">
                <span className="text-sm font-medium" style={{ color: skin.textPrimary }}>检测手掌：</span>
                <span className="text-xs" style={{ color: skin.textDim }}>
                  {handSide === "left" ? "左手主先天禀赋与早年根基" : "右手主后天修为与中晚年成就"}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHandSide("left")}
                  className="px-4 py-2 text-sm rounded-lg border transition-all"
                  style={handSide === "left"
                    ? { background: "rgba(212,175,55,0.12)", borderColor: skin.gold, color: skin.goldLight, fontWeight: 700 }
                    : { borderColor: skin.border, color: skin.textMuted }}
                >
                  左手 (先天根基)
                </button>
                <button
                  type="button"
                  onClick={() => setHandSide("right")}
                  className="px-4 py-2 text-sm rounded-lg border transition-all"
                  style={handSide === "right"
                    ? { background: "rgba(212,175,55,0.12)", borderColor: skin.gold, color: skin.goldLight, fontWeight: 700 }
                    : { borderColor: skin.border, color: skin.textMuted }}
                >
                  右手 (后天修为)
                </button>
              </div>
            </div>
          )}

          {isFace && (
            <>
              <div className="mt-6 flex items-center justify-between p-4 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
                <div className="flex flex-col">
                  <span className="text-sm font-medium" style={{ color: skin.textPrimary }}>性别（辅助参考）：</span>
                  <span className="text-xs" style={{ color: skin.textDim }}>影响五官神韵与骨相气色的判断权重</span>
                </div>
                <div className="flex gap-2">
                  {[
                    { v: "unspecified" as const, l: "不指定" },
                    { v: "male" as const, l: "男" },
                    { v: "female" as const, l: "女" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setUserGender(opt.v)}
                      className={`px-4 py-2 text-sm rounded-lg border transition-all ${
                        userGender === opt.v
                          ? "bg-emerald-500/20 border-emerald-500 text-emerald-300 font-bold shadow-sm"
                          : "border-slate-700 hover:bg-slate-800 text-slate-400"
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between /60 p-4 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
                <div className="flex flex-col">
                  <span className="text-sm font-medium" style={{ color: skin.textPrimary }}>年龄段：</span>
                  <span className="text-xs" style={{ color: skin.textDim }}>用于动态纹与气色成熟度判断</span>
                </div>
                <select
                  value={userAgeBand}
                  onChange={(e) => setUserAgeBand(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors" style={{ background: skin.bgSurface, borderColor: skin.border, color: skin.textPrimary }}
                >
                  {AGE_BANDS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* 提问输入框 */}
          <div className="mt-5 /60 p-4 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
            <label className="block text-sm font-medium mb-2" style={{ color: skin.textSecond }}>
              💬 想特别咨询的问题（选填）：
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                isFace
                  ? "例如：未来三年事业运势如何？何时结婚？健康要注意什么？"
                  : "例如：今年适合换工作吗？感情运势如何？什么时候会有事业转机？"
              }
              rows={3}
              maxLength={500}
              className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none resize-none transition-colors ${
                isFace ? "focus:border-emerald-500" : "focus:border-slate-500"
              }`}
            />
            <p className="text-xs mt-1" style={{ color: skin.textDim }}>
              {isFace
                ? "AI 将结合所选【面相三庭五眼 + 十二宫】特征进行针对性解答"
                : `AI 将结合所选【${handSide === "left" ? "左手·先天" : "右手·后天"}】掌纹与交叉特征进行针对性解答`}
            </p>
          </div>

          {/* 错误提示 */}
          {errorMsg && (
            <div className="mt-4 p-3 bg-red-950/50 border border-red-800 text-red-300 text-sm rounded-xl text-center">
              ⚠️ {errorMsg}
            </div>
          )}

          {/* 提交分析按钮 */}
          <button
            type="button"
            onClick={handleStartAnalyze}
            disabled={loading || !base64Image}
            className="w-full mt-6 py-3.5 rounded-xl font-bold text-base transition-all"
            style={loading || !base64Image
              ? { background: skin.bgElevated, color: skin.textDim, cursor: "not-allowed" }
              : isFace
                ? { background: "#10b981", color: "#052e16", boxShadow: "0 10px 15px -3px rgba(16,185,129,0.25)" }
                : { background: skin.gold, color: skin.textOnGold, boxShadow: "0 10px 15px -3px rgba(212,175,55,0.25)" }}
          >
            {loading
              ? `正在${isFace ? "深度提取三庭五眼与十二宫特征" : "深度提取交汇纹路"}并生成报告，请稍候...`
              : `开始${isFace ? "面相" : handSide === "left" ? "左手(先天)" : "右手(后天)"}相术分析`}
          </button>
        </div>

        {/* 报告展示区域 */}
        {result && report && (
          <div className="border rounded-2xl p-6 shadow-2xl space-y-6" style={{ background: skin.bgSurface, borderColor: skin.borderSubtle }}>
            <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: skin.borderSubtle }}>
              <div>
                <h2 className={`text-lg font-bold flex items-center gap-2 ${isFace ? "text-emerald-400" : "text-amber-400"}`}>
                  <span>📜</span> {isFace ? "面相深度鉴析报告" : "手相深度鉴析报告"}
                </h2>
                <span className="text-xs mt-0.5 inline-block" style={{ color: skin.textMuted }}>
                  {isFace
                    ? "分析对象：面部三庭五眼与十二宫"
                    : `分析手侧：${handSide === "left" ? "左手（先天根基 · 35岁前潜能）" : "右手（后天修为 · 35岁后造化）"}`}
                </span>
              </div>
              {(report.handType || report.faceShape) && (
                <span
                  className={`px-3 py-1 border text-xs font-semibold rounded-full ${
                    isFace
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  }`}
                >
                  {report.handType || report.faceShape}
                </span>
              )}
            </div>

            {/* 总体格局 */}
            {report.overallAnalysis && (
              <div className="p-4 rounded-xl border" style={{ background: skin.bgInput, borderColor: skin.borderSubtle }}>
                <div className={`text-xs font-semibold mb-1 ${isFace ? "text-emerald-400" : "text-amber-400"}`}>
                  【{isFace ? "五岳四渎与全局气色" : "气色与骨相格局"}】
                </div>
                <p className="text-sm leading-relaxed" style={{ color: skin.textPrimary }}>{report.overallAnalysis}</p>
              </div>
            )}

            {/* 专属深度问答 */}
            {report.questionAnswer && (
              <div
                className={`border rounded-xl p-4 ${
                  isFace
                    ? "bg-emerald-950/20 border-emerald-800/40"
                    : "bg-amber-950/20 border-amber-800/40"
                }`}
              >
                <div
                  className={`text-sm font-bold mb-2 ${isFace ? "text-emerald-300" : "text-amber-300"}`}
                >
                  💬 你的专属深度问答
                </div>
                <div className="whitespace-pre-line text-sm leading-relaxed" style={{ color: skin.textPrimary }}>
                  {report.questionAnswer}
                </div>
              </div>
            )}

            {/* 分维度详解：手相 vs 面相 字段映射不同 */}
            {isPalm && (
              <div className="space-y-2">
                <div className="text-sm font-bold text-amber-300 mb-1">【主线与复合交汇格局详析】</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderLine("组合与交叉纹路（三才合围/穿透/特殊符号）", "text-amber-300", lineAnalysisRef(report).complexCrossings, true)}
                  {renderLine("生命线（地纹与金星丘）", "text-emerald-400", lineAnalysisRef(report).lifeLine)}
                  {renderLine("智慧线（人纹与思维格局）", "text-blue-400", lineAnalysisRef(report).headLine)}
                  {renderLine("感情线（天纹与情志人际）", "text-rose-400", lineAnalysisRef(report).heartLine)}
                  {renderLine("事业线（玉柱纹与贯穿力）", "text-purple-400", lineAnalysisRef(report).fateLine)}
                  {renderLine("太阳线（六秀纹与贵人运）", "text-amber-400", lineAnalysisRef(report).sunLine)}
                  {renderLine("掌丘起伏与纳财气色", "text-cyan-400", lineAnalysisRef(report).mounts)}
                  {renderLine("其他杂纹与皮肤气色", "text-slate-300", lineAnalysisRef(report).others || lineAnalysisRef(report).supplement)}
                </div>
              </div>
            )}

            {isFace && (
              <div className="space-y-2">
                <div className="text-sm font-bold text-emerald-300 mb-1">【三庭五眼与十二宫详析】</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderLine("上庭（额相 · 印堂 · 先天根基）", "text-emerald-400", lineAnalysisRef(report).upperCourt, true)}
                  {renderLine("中庭（眉眼 · 山根 · 35-50岁格局）", "text-blue-400", lineAnalysisRef(report).middleCourt, true)}
                  {renderLine("下庭（人中 · 口形 · 地阁晚景）", "text-purple-400", lineAnalysisRef(report).lowerCourt, true)}
                  {renderLine(
                    "组合纹痕与气色（动态纹 · 痣斑 · 神韵）",
                    "text-emerald-300",
                    lineAnalysisRef(report).complexMarks,
                    true,
                  )}
                </div>
              </div>
            )}

            {/* 四维运势精解 */}
            {report.fortuneAnalysis && (
              <div className="space-y-3">
                <div className={`text-sm font-bold ${isFace ? "text-emerald-300" : "text-amber-300"}`}>
                  【四维运势指引】
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderFortune("career", "💼", "事业与财运")}
                  {renderFortune("relationship", "❤️", "情感与婚姻")}
                  {renderFortune("health", "🩺", "气血与健康")}
                  {renderFortune("advice", "💡", "趋吉修持建议")}
                </div>
              </div>
            )}

            {report._fallback && (
              <p className="text-xs text-center" style={{ color: skin.textDim }}>
                （本次已为您生成命理鉴析报告；照片已安全归档）
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 取 lineAnalysis 的统一入口（palm 走 lineAnalysis；face 走 lineAnalysis）
// 兼容后端兜底数据结构（palmFeatures / palm 字段 vs threeCourtFiveEyes / face 字段）
function lineAnalysisRef(report: any): any {
  return report?.lineAnalysis || report?.palmFeatures || report?.threeCourtFiveEyes || {};
}