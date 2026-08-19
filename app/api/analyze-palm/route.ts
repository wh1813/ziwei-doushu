import { NextRequest, NextResponse } from 'next/server';

function getEnv(key: string): string | undefined {
  const env = (process as any).env || {};
  const globalEnv = (globalThis as any) || {};
  return env[key] || globalEnv[key] || process.env[key];
}

function getAiBinding(): any {
  const env = (process as any).env || {};
  return env.AI || (globalThis as any).AI;
}

function extractJsonFromText(rawText: string): any {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      return JSON.parse(jsonMatch[1]);
    }
    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      return JSON.parse(rawText.substring(firstBrace, lastBrace + 1));
    }
    throw new Error('无法解析输出结构');
  }
}

// 方案 1: Cloudflare Workers AI 原生视觉识别 (无需外部 Key)
async function analyzeWithWorkersAI(aiBinding: any, imageBase64: string, promptText: string) {
  // 将 base64 转为 byte 数组供 Workers AI 使用
  const binaryString = atob(imageBase64);
  const imageBytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    imageBytes[i] = binaryString.charCodeAt(i);
  }

  const response = await aiBinding.run('@cf/meta/llama-3.2-11b-vision-instruct', {
    image: [...imageBytes],
    prompt: promptText,
    max_tokens: 1500,
  });

  const rawText = response?.response || '';
  return extractJsonFromText(rawText);
}

// 方案 2: Gemini 备用接口
async function analyzeWithGemini(apiKey: string, base64Data: string, mimeType: string, promptText: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: promptText },
          { inline_data: { mime_type: mimeType, data: base64Data } }
        ]
      }],
      generationConfig: { temperature: 0.2 }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini 响应失败 (${response.status})`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractJsonFromText(text);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, handSide = 'right', userId = 'anonymous' } = body;

    if (!image) {
      return NextResponse.json({ error: '请上传手掌照片' }, { status: 400 });
    }

    let mimeType = 'image/jpeg';
    let rawBase64 = image;
    if (image.startsWith('data:')) {
      const parts = image.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      rawBase64 = parts[1];
    }

    const prompt = `你是一位精通相术与中国传统手相学的专家。请观察这张手掌图像（检测为${handSide === 'left' ? '左手·先天' : '右手·后天'}）。
请严格只返回一个 JSON 对象，结构如下：
{
  "handType": "手型分类（如：木型掌、金型掌等）",
  "palmFeatures": {
    "lifeLine": "生命线（地纹）特征",
    "headLine": "智慧线（人纹）特征",
    "heartLine": "感情线（天纹）特征",
    "fateLine": "事业线特征",
    "sunLine": "太阳线/成功线特征",
    "mounts": "各大掌丘饱满度"
  },
  "overallAnalysis": "掌形、骨相与整体运势格局概述",
  "fortuneAnalysis": {
    "career": "事业财运建议",
    "relationship": "情感婚姻分析",
    "health": "精力健康提示",
    "advice": "趋吉避凶建议"
  }
}`;

    let result: any = null;
    const aiBinding = getAiBinding();
    const geminiKey = getEnv('PALM_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY');

    // 优先尝试 Cloudflare Workers AI
    if (aiBinding) {
      try {
        result = await analyzeWithWorkersAI(aiBinding, rawBase64, prompt);
      } catch (cfErr) {
        console.warn('Workers AI 处理失败，尝试使用备用通道:', cfErr);
      }
    }

    // 降级使用 Gemini
    if (!result && geminiKey) {
      try {
        result = await analyzeWithGemini(geminiKey, rawBase64, mimeType, prompt);
      } catch (geminiErr: any) {
        console.error('Gemini 处理失败:', geminiErr);
      }
    }

    if (!result) {
      return NextResponse.json({ error: '视觉模型当前处理繁忙，请稍后重试' }, { status: 503 });
    }

    // 存入 D1 数据库
    const db = (process as any).env?.QUERY_LOGS_DB || (globalThis as any).QUERY_LOGS_DB;
    if (db) {
      try {
        await db.prepare(`
          INSERT INTO palm_records (id, user_id, extracted_features, report_content, hand_side, created_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          crypto.randomUUID(),
          userId,
          JSON.stringify(result.palmFeatures || {}),
          JSON.stringify(result),
          handSide
        ).run();
      } catch (e) {
        console.warn('D1 写入跳过:', e);
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '分析服务异常' }, { status: 500 });
  }
}
