'use client';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import StarField from '@/components/StarField';
import { useTheme } from '@/components/ThemeProvider';

// 与 app/page.tsx 一致的配色工具
function useColors(theme: string) {
  const d = theme === 'dark';
  return {
    bgBase: d ? '#020810' : '#f5efe0',
    cardBg: d ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.88)',
    cardBorder: d ? 'rgba(255,255,255,0.10)' : 'rgba(200,160,60,0.25)',
    goldLine: d ? 'rgba(212,168,67,0.4)' : 'rgba(140,100,20,0.4)',
    goldSolid: d ? '#d4a843' : '#8b6410',
    textPrimary: d ? '#e8eef6' : '#1a1d24',
    textSecond: d ? '#b8c6df' : '#3a3f4a',
    textMuted: d ? '#9db0d0' : '#5a6275',
    ctaBg: d
      ? 'linear-gradient(135deg,#b8892a,#f0d070,#b8892a)'
      : 'linear-gradient(135deg,#6a4206,#9a6810,#6a4206)',
    ctaText: d ? '#08080a' : '#f8f3e8',
    navBorder: d ? 'rgba(255,255,255,0.05)' : 'rgba(160,120,30,0.15)',
    footerText: d ? 'rgba(255,255,255,0.08)' : '#c0a870',
  };
}

interface AnalyzeResult {
  success: boolean;
  recordId?: string;
  imageUrl?: string;
  features?: string;
  report?: string;
  error?: string;
}

interface HistoryItem {
  id: string;
  image_url: string;
  extracted_features: string;
  report_content: string;
  created_at: string;
}

export default function PalmPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const c = useColors(theme);

  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hand, setHand] = useState('right');
  const [query, setQuery] = useState('综合运势');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 客户端压缩图片为 base64
  const readFileAndResize = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 900;
          let { width, height } = img;
          const scale = Math.min(1, max / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = reject;
        img.src = String(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setResult(null);
    setHistory([]);
    try {
      const b64 = await readFileAndResize(file);
      localStorage.setItem('palm_last_image', b64);
    } catch (err) {
      setError(String(err));
    }
  }, [readFileAndResize]);

  const handleAnalyze = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const imageBase64 = await readFileAndResize(file);
      const res = await fetch('/api/analyze-palm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, userQuery: query, userId: 'demo-user', handSide: hand }),
      });
      const data = (await res.json()) as AnalyzeResult;
      if (data.success) {
        setResult(data);
      } else {
        setError(data.error || '分析失败');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [query, hand, readFileAndResize]);

  const loadHistory = useCallback(async () => {
    const res = await fetch('/api/palm-history/demo-user');
    const data = (await res.json()) as { success: boolean; history: HistoryItem[] };
    if (data.success) setHistory(data.history);
  }, []);

  return (
    <div style={{ background: c.bgBase, transition: 'background 0.35s ease' }} className="min-h-screen overflow-x-hidden">
      <StarField />
      {/* 顶部导航 */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 sm:px-8 py-3 sm:py-4 gap-2"
        style={{ background: c.bgBase }}>
        <button onClick={() => router.push('/')}
          className="text-[11px] sm:text-xs tracking-[0.3em] font-medium"
          style={{ color: c.goldSolid, background: 'none', border: 'none', cursor: 'pointer' }}>
          ← 返回
        </button>
        <div className="text-[11px] sm:text-xs tracking-[0.3em] font-medium" style={{ color: c.goldSolid }}>
          手相分析
        </div>
        <div className="w-14" />
      </nav>

      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-24 pb-16">
        {/* 标题 */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px w-10" style={{ background: `linear-gradient(to right, transparent, ${c.goldLine})` }} />
            <span className="text-[10px] tracking-[0.4em]" style={{ color: c.goldSolid, opacity: 0.7 }}>Palmistry</span>
            <div className="h-px w-10" style={{ background: `linear-gradient(to left, transparent, ${c.goldLine})` }} />
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-wide mb-3" style={{ color: c.textPrimary }}>
            手相分析
          </h1>
          <p className="text-sm" style={{ color: c.textMuted }}>
            上传手掌照片，AI 识别掌纹并解读性格、事业与感情
          </p>
        </div>

        {/* 上传区 */}
        <div className="rounded-2xl p-6 md:p-8 mb-6"
          style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
          <div
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 cursor-pointer transition-colors"
            style={{ borderColor: c.goldLine }}>
            {preview ? (
              <img src={preview} alt="手相预览" className="w-44 h-auto rounded-lg" />
            ) : (
              <>
                <div className="text-4xl mb-3">✋</div>
                <div className="text-sm mb-1" style={{ color: c.textSecond }}>点击上传手掌照片</div>
                <div className="text-[11px]" style={{ color: c.textMuted }}>支持 JPG / PNG</div>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {/* 惯用手 & 提问 */}
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: c.textMuted }}>分析：</span>
              {['right', 'left'].map((h) => (
                <button key={h}
                  onClick={() => setHand(h)}
                  className="text-xs px-3 py-1.5 rounded-full"
                  style={{
                    border: `1px solid ${hand === h ? c.goldSolid : c.cardBorder}`,
                    color: hand === h ? c.goldSolid : c.textMuted,
                    background: hand === h ? 'rgba(212,168,67,0.1)' : 'transparent',
                  }}>
                  {h === 'right' ? '右手' : '左手'}
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="想关注的事业、感情、财运…（可留空）"
              className="w-full rounded-lg border px-4 py-2.5 text-sm outline-none"
              style={{ borderColor: c.cardBorder, background: 'transparent', color: c.textPrimary }}
            />
            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full py-3 rounded-full font-medium text-sm tracking-widest disabled:opacity-50"
              style={{ background: c.ctaBg, color: c.ctaText }}>
              {loading ? '分析中…' : '开始分析'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* 结果区 */}
        {result?.report && (
          <div className="rounded-2xl p-6 mb-6"
            style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
            <h2 className="text-lg font-semibold mb-3" style={{ color: c.textPrimary }}>分析报告</h2>
            <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: c.textSecond }}>
              {result.report}
            </div>
          </div>
        )}

        {/* 历史入口 */}
        <button onClick={loadHistory}
          className="w-full py-2.5 rounded-full border text-sm tracking-widest"
          style={{ borderColor: c.cardBorder, color: c.textMuted }}>
          查看历史记录
        </button>

        {history.length > 0 && (
          <div className="mt-4 space-y-3">
            {history.map((h) => (
              <div key={h.id} className="rounded-lg p-4"
                style={{ background: c.cardBg, border: `1px solid ${c.cardBorder}` }}>
                <div className="text-[11px]" style={{ color: c.textMuted }}>{h.created_at}</div>
                <div className="mt-1 text-sm" style={{ color: c.textSecond }}>
                  {h.report_content?.slice(0, 120)}…
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部说明 */}
      <footer className="relative z-10 py-6 px-6 text-center" style={{ borderTop: `1px solid ${c.navBorder}` }}>
        <p className="text-[10px] tracking-wider" style={{ color: c.footerText }}>
          手相分析仅供娱乐参考 · 不构成任何专业建议
        </p>
      </footer>
    </div>
  );
}