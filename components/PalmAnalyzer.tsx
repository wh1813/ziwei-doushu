/**
 * 手相分析前端调用示例（客户端组件）。
 *
 * 说明：
 *  - 只做两件事：全局选择图片并压缩为 JPEG base64、调到 /api/analyze-palm。
 *  - 图片在客户端压缩到约 1MB 内，降低上行体积与 R2 存储占用。
 *  - 不暴露任何模型/供应商/Key 信息；历史接口按 userId 拉取。
 *
 * 用法：
 *  <PalmAnalyzer userId="demo-user" />
 */
'use client';

import { useCallback, useRef, useState } from 'react';

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

export default function PalmAnalyzer({ userId = 'anonymous' }: { userId?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('综合运势');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const resizeImageToBase64 = useCallback((file: File): Promise<string> => {
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

  const handleAnalyze = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const imageBase64 = await resizeImageToBase64(file);
      const res = await fetch('/api/analyze-palm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, userQuery: query, userId }),
      });
      setResult((await res.json()) as AnalyzeResult);
    } catch (err) {
      setResult({ success: false, error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [query, userId, resizeImageToBase64]);

  const loadHistory = useCallback(async () => {
    const res = await fetch(`/api/palm-history/${encodeURIComponent(userId)}`);
    const data = (await res.json()) as { success: boolean; history: HistoryItem[] };
    if (data.success) setHistory(data.history);
  }, [userId]);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      <h2 className="text-xl font-bold">手相分析</h2>
      <div className="space-y-3 rounded border p-4">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png" className="w-full" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="想关注的事业、感情、财运…（可留空）"
          className="w-full rounded border p-2"
        />
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? '分析中…' : '开始分析'}
        </button>
        <button onClick={loadHistory} className="ml-2 rounded border px-4 py-2">
          查看历史
        </button>
      </div>

      {result?.imageUrl && <img src={result.imageUrl} alt="手相" className="w-48 rounded" />}
      {result?.report && (
        <div className="whitespace-pre-wrap rounded border p-4">{result.report}</div>
      )}
      {result?.error && <div className="rounded border border-red-300 p-3 text-red-700">{result.error}</div>}

      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold">历史记录</h3>
          {history.map((h) => (
            <div key={h.id} className="rounded border p-3">
              <div className="text-xs text-gray-500">{h.created_at}</div>
              <div className="mt-1 line-clamp-3 text-sm">{h.report_content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}