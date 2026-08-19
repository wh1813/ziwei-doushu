"use client";

import React, { useState, useRef } from "react";
import Link from "next/link";

export default function PalmPage() {
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [handSide, setHandSide] = useState<"left" | "right">("right");
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

        // 限制最大宽度/高度为 1200px，既清晰又极度轻量
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
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "分析失败，请稍后重试");
      }

      setResult(data.data);
    } catch (err: any) {
      setErrorMsg(err.message || "请求服务器失败，请检查网络连接");
    } finally {
      setLoading(false);
    }
  };

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
            {loading ? "正在深度识别掌纹与气色特征，请稍候..." : "开始相术分析"}
          </button>
        </div>

        {/* 报告展示区域 */}
        {result && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h2 className="text-lg font-bold text-amber-400 flex items-center gap-2">
                <span>📜</span> 手相综合鉴析报告
              </h2>
              {result.handType && (
                <span className="px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold rounded-full">
                  {result.handType}
                </span>
              )}
            </div>

            {/* 总体格局 */}
            {result.overallAnalysis && (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                <div className="text-xs text-slate-400 font-semibold mb-1">【气色与骨相格局】</div>
                <p className="text-sm text-slate-200 leading-relaxed">{result.overallAnalysis}</p>
              </div>
            )}

            {/* 核心掌纹特征 */}
            {result.palmFeatures && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {result.palmFeatures.lifeLine && (
                  <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                    <div className="text-xs font-bold text-emerald-400 mb-1">生命线 (地纹)</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{result.palmFeatures.lifeLine}</p>
                  </div>
                )}
                {result.palmFeatures.headLine && (
                  <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                    <div className="text-xs font-bold text-blue-400 mb-1">智慧线 (人纹)</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{result.palmFeatures.headLine}</p>
                  </div>
                )}
                {result.palmFeatures.heartLine && (
                  <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                    <div className="text-xs font-bold text-rose-400 mb-1">感情线 (天纹)</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{result.palmFeatures.heartLine}</p>
                  </div>
                )}
                {result.palmFeatures.fateLine && (
                  <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                    <div className="text-xs font-bold text-purple-400 mb-1">事业线 / 运势线</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{result.palmFeatures.fateLine}</p>
                  </div>
                )}
              </div>
            )}

            {/* 四维流年运势分析 */}
            {result.fortuneAnalysis && (
              <div className="space-y-3">
                <div className="text-sm font-bold text-amber-300">【四维运势精解】</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {result.fortuneAnalysis.career && (
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs font-semibold text-slate-400 mb-1">💼 事业财禄</div>
                      <div className="text-xs text-slate-200 leading-relaxed">{result.fortuneAnalysis.career}</div>
                    </div>
                  )}
                  {result.fortuneAnalysis.relationship && (
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs font-semibold text-slate-400 mb-1">❤️ 婚姻情感</div>
                      <div className="text-xs text-slate-200 leading-relaxed">{result.fortuneAnalysis.relationship}</div>
                    </div>
                  )}
                  {result.fortuneAnalysis.health && (
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs font-semibold text-slate-400 mb-1">🩺 气血健康</div>
                      <div className="text-xs text-slate-200 leading-relaxed">{result.fortuneAnalysis.health}</div>
                    </div>
                  )}
                  {result.fortuneAnalysis.advice && (
                    <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800">
                      <div className="text-xs font-semibold text-amber-400 mb-1">💡 趋吉避凶建议</div>
                      <div className="text-xs text-slate-200 leading-relaxed">{result.fortuneAnalysis.advice}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
