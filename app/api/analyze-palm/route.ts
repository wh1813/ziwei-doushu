import { NextRequest, NextResponse } from 'next/server';

// 优先采用免费层最新主力模型，遇到高负载自动降级
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash-latest'
];

// 获取环境变量与资源绑定
function getEnv(key: string): string | undefined {
  const env = (process as any).env || {};
  const globalEnv = (globalThis as any) || {};
  return env[key] || globalEnv[key] || process.env[key];
}

// 避让重试请求
async function fetchGeminiWithRetry(url: string, body: any, maxRetries = 2): Promise<Response> {
  let lastResponse: Response | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    // 若非 503 / 429 错误，直接返回
    if (res.status !== 503 && res.status !== 429) {
      return res;
    }

    lastResponse = res;
    // 遇到限流或高负载，避让 1.2s ~ 2.4s 后重试
    if (i < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
    }
  }
  return lastResponse!;
}

// 调用 Gemini 进行手相视觉识别
async function analyzeImageWithGemini(apiKey: string, base64Data: string, mimeType: string, promptText: string) {
  let lastError = '';

  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json"
      }
    };

    try {
      const response = await fetchGeminiWithRetry(url, payload);
      if (response.ok) {
        const json = await response.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return JSON.parse(text);
        }
      } else {
        const errorText = await response.text();
        lastError = `[${model}] 状态码 ${response.status}: ${errorText}`;
      }
    } catch (err: any) {
      lastError = `[${model}] 请求异常: ${err?.message}`;
    }
  }

  throw new Error(`所有 Gemini 免费模型调用均繁忙，最后错误: ${lastError}`);
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = getEnv('PALM_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY');

    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI 服务尚未配置完成（缺少 Gemini API Key），请稍后再试' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { image, handSide = 'right', userId = 'anonymous' } = body;

    if (!image) {
      return NextResponse.json(
        { error: '请上传手掌照片' },
        { status: 400 }
      );
    }

    // 提取 Base64 编码与 MIME 类型
    let mimeType = 'image/jpeg';
    let base64Data = image;

    if (image.startsWith('data:')) {
      const parts = image.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Data = parts[1];
    }

    const prompt = `你是一位精通相术与中国传统手相学的专家。请仔细观察这张手掌图像（当前检测为${handSide === 'left' ? '左手' : '右手'}）。
请严格以 JSON 格式输出以下结构，不要输出任何额外的 Markdown 代码块或文字：
{
  "handType": "手型分类（金/木/水/火/土型掌）",
  "palmFeatures": {
    "lifeLine": "生命线特征（长度、深浅、起点、有无岛纹/分叉）",
    "headLine": "智慧线特征（走势、弯度、清晰度）",
    "heartLine": "感情线特征（平直/上扬、起点、分叉）",
    "fateLine": "事业线特征（有无、深浅、起点）",
    "sunLine": "太阳线/成功线特征",
    "mounts": "各大掌丘饱满程度简析（如木星丘、金星丘等）"
  },
  "overallAnalysis": "综合气色、骨相与整体运势特征概述",
  "fortuneAnalysis": {
    "career": "事业与财运走向",
    "relationship": "情感与婚姻分析",
    "health": "精力与健康提示",
    "advice": "修身立业与趋吉避凶建议"
  }
}`;

    // 执行视觉识别
    const analysisResult = await analyzeImageWithGemini(apiKey, base64Data, mimeType, prompt);

    // 尝试持久化到 Cloudflare D1 数据库（若绑定存在）
    const db = (process as any).env?.QUERY_LOGS_DB || (globalThis as any).QUERY_LOGS_DB;
    if (db) {
      try {
        const recordId = crypto.randomUUID();
        await db.prepare(`
          INSERT INTO palm_records (id, user_id, extracted_features, report_content, hand_side, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          recordId,
          userId,
          JSON.stringify(analysisResult.palmFeatures),
          JSON.stringify(analysisResult),
          handSide
        ).run();
      } catch (dbErr) {
        console.warn('D1 写入手相记录失败 (跳过):', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: analysisResult
    });

  } catch (error: any) {
    console.error('手相分析错误:', error);
    return NextResponse.json(
      { error: error?.message || '视觉识别服务繁忙，请稍后重试' },
      { status: 500 }
    );
  }
}
