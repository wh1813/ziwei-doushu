"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";

export default function PalmPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [handSide, setHandSide] = useState<"left" | "right">("right");
  const [question, setQuestion] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setErrorMsg("请先点击上方区域上传一张清晰的手掌照片！");
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze-palm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64Image,
          handSide: handSide,
          userId: "web-user",
          question: question.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "分析失败，请稍后重试");
      }

      setResult(data);
    } catch (err: any) {
      setErrorMsg(err.message || "请求服务器失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

  // 渲染单条线详解（三段式）
  const renderLine = (title: string, color: string, content?: string) => {
    if (!content) return null;
    return (
      <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
        <div className={`text-xs font-bold ${color} mb-2`}>{title}</div>
        <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">{content}</p>
      </div>
    );
  };

  // 渲染四维运势
  const renderFortune = (key: string, icon: string, title: string) => {
    const content = result?.data?.fortuneAnalysis?.[key];
    if (!content) return null;
    return (
      <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
        <div className="text-xs font-semibold text-slate-400 mb-1">{icon} {title}</div>
        <div className="text-xs text-slate-200 leading-relaxed">{content}</div>
      </div>
    );
  };

  const report = result?.data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        {/* 顶部导航 */}
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
          <Link href="/" className="text-slate-400 hover:text-white text-sm flex items-center gap-1">
            ← 返回首页
          </Link>
          <h1 className="text-xl font-bold tracking-wider text-amber-400">AI 智能相术 · 手相分析</h1>
          <div className="w-12"></div>
        </div>

        {/* 主输入区域 */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl mb-8">
          {/* 上传区域 */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-700 hover:border-amber-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-slate-950/50 relative overflow-hidden group min-h-[220px] flex flex-col items-center justify-center"
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
                  alt="手掌预览"
                  className="max-h-72 object-contain rounded-lg shadow-md"
                />
                <p className="text-xs text-amber-400 mt-2">✓ 照片已加载（点击可重新上传更换）</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-14 h-14 mx-auto rounded-full bg-slate-800 flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                  ✋
                </div>
                <div className="text-sm font-medium text-slate-300">
                  点击拍照或上传手掌照片
                </div>
                <p className="text-xs text-slate-500 max-w-xs mx-auto">
                  请掌心朝上、五指自然伸展、光线均匀，避免反光或模糊
                </p>
              </div>
            )}
          </div>

          {/* 惯用手选择 */}
          <div className="mt-6 flex items-center justify-between bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <span className="text-sm font-medium text-slate-300">当前检测手掌：</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setHandSide("left")}
                className={`px-4 py-2 text-sm rounded-lg border transition-all ${
                  handSide === "left"
                    ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
                    : "border-slate-700 hover:bg-slate-800 text-slate-400"
                }`}
              >
                左手 (先天根基)
              </button>
              <button
                type="button"
                onClick={() => setHandSide("right")}
                className={`px-4 py-2 text-sm rounded-lg border transition-all ${
                  handSide === "right"
                    ? "bg-amber-500/20 border-amber-500 text-amber-300 font-bold"
                    : "border-slate-700 hover:bg-slate-800 text-slate-400"
                }`}
              >
                右手 (后天修为)
              </button>
            </div>
          </div>

          {/* 提问输入框（新增） */}
          <div className="mt-5 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              💬 你想深入咨询什么？（可选）
            </label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="例如：我的事业会在什么时候迎来转机？感情上适合怎样的伴侣？今年财运如何？"
              rows={3}
              maxLength={500}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              AI 将结合你的掌纹特征，对提问做逐条深度解答与预测
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
            className={`w-full mt-6 py-3.5 rounded-xl font-bold text-base transition-all ${
              loading
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : !base64Image
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20"
            }`}
          >
            {loading ? "正在深度识别掌纹并生成详解报告，请稍候..." : "开始相术分析"}
          </button>
        </div>

        {/* 报告展示区域 */}
        {result && report && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-amber-400 flex items-center gap-2">
                <span>📜</span> 手相深度鉴析报告
              </h2>
              {report.handType && (
                <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold rounded-full">
                  {report.handType}
                </span>
              )}
            </div>

            {/* 总体格局 */}
            {report.overallAnalysis && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 font-semibold mb-1">【气色与骨相格局】</div>
                <p className="text-sm text-slate-200 leading-relaxed">{report.overallAnalysis}</p>
              </div>
            )}

            {/* 分维度详解（新增：三段式） */}
            {report.lineAnalysis && (
              <div className="space-y-2">
                <div className="text-sm font-bold text-amber-300 mb-1">【掌纹分维度详解】</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderLine("生命线（地纹）", "text-emerald-400", report.lineAnalysis.lifeLine)}
                  {renderLine("智慧线（人纹）", "text-blue-400", report.lineAnalysis.headLine)}
                  {renderLine("感情线（天纹）", "text-rose-400", report.lineAnalysis.heartLine)}
                  {renderLine("事业线 / 运势线", "text-purple-400", report.lineAnalysis.fateLine)}
                  {renderLine("太阳线 / 成功线", "text-amber-400", report.lineAnalysis.sunLine)}
                  {renderLine("掌丘与气色", "text-cyan-400", report.lineAnalysis.mounts)}
                  {renderLine("其他特征", "text-slate-300", report.lineAnalysis.others)}
                </div>
              </div>
            )}

            {/* 四维运势精解 */}
            {report.fortuneAnalysis && (
              <div className="space-y-3">
                <div className="text-sm font-bold text-amber-300">【四维运势精解】</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderFortune("career", "💼", "事业财禄")}
                  {renderFortune("relationship", "❤️", "婚姻情感")}
                  {renderFortune("health", "🩺", "气血健康")}
                  {renderFortune("advice", "💡", "趋吉避凶建议")}
                </div>
              </div>
            )}

            {/* 深度问答（新增） */}
            {report.questionAnswer && (
              <div className="bg-slate-950 border border-amber-500/30 rounded-xl p-4">
                <div className="text-sm font-bold text-amber-300 mb-2">💬 你的专属深度问答</div>
                <div className="whitespace-pre-line text-sm text-slate-200 leading-relaxed">
                  {report.questionAnswer}
                </div>
              </div>
            )}

            {report._fallback && (
              <p className="text-xs text-slate-500 text-center">
                （本次因深度报告生成失败，以上为视觉初步分析；请稍后重试以获得完整深度鉴析）
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}