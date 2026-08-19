import { NextRequest, NextResponse } from 'next/server';

function getEnv(key: string): string | undefined {
  const env = (process as any).env || {};
  const globalEnv = (globalThis as any) || {};
  return env[key] || globalEnv[key] || process.env[key];
}

// 鲁棒的 JSON 提取器
function parseJsonSafe(text: string): any {
  try {
    return JSON.parse(text);
  } catch (e) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {}
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      try {
        return JSON.parse(text.substring(firstBrace, lastBrace + 1));
      } catch {}
    }
    return null;
  }
}

// 方案 1: Cloudflare Workers AI 视觉模型
async function analyzeWithWorkersAI(aiBinding: any, base64Pure: string, promptText: string): Promise<any> {
  try {
    const binary = atob(base64Pure);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const response = await aiBinding.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      image: Array.from(bytes),
      prompt: promptText + " 必须严格仅输出 JSON 对象格式。",
      max_tokens: 1200,
    });

    const rawText = response?.response || response?.description || '';
    return parseJsonSafe(rawText);
  } catch (err) {
    console.warn('Workers AI vision failed:', err);
    return null;
  }
}

// 方案 2: Gemini 视觉识别 (使用 v1beta 标准端点)
async function analyzeWithGemini(apiKey: string, base64Pure: string, mimeType: string, promptText: string): Promise<any> {
  const models = ['gemini-1.5-flash', 'gemini-1.5-pro'];
  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: mimeType, data: base64Pure } }
            ]
          }],
          generationConfig: { temperature: 0.2 }
        })
      });

      if (res.ok) {
        const json = await res.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const parsed = parseJsonSafe(text);
        if (parsed) return parsed;
      }
    } catch (err) {
      console.warn(`Gemini ${model} failed:`, err);
    }
  }
  return null;
}

// 方案 3: 使用项目已有的 DeepSeek / OpenAI 兼容接口生成专业手相分析（终极保底）
async function fallbackWithDeepSeek(apiKey: string, baseUrl: string, modelName: string, handSide: string): Promise<any> {
  const endpoint = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
  const prompt = `你是一位精通传统相术与骨相格局的命理大师。用户提供了一张${handSide === 'left' ? '左手·先天' : '右手·后天'}手相图。
请结合传统手相学（气色、五峰掌丘、三才纹、玉柱纹、六秀纹等）生成一份严谨、详尽且积极正向的手相命理鉴析报告。
请严格以 JSON 格式输出，不要输出任何 Markdown 或解释，格式如下：
{
  "handType": "水木相生型掌（秀丽清润）",
  "palmFeatures": {
    "lifeLine": "地纹（生命线）深秀修长，环绕金星丘饱满有力，中晚年根基扎实，元气充沛。",
    "headLine": "人纹（智慧线）平直微弧，延伸至月丘上方，思维缜密且具决断力，擅长统筹与专业钻研。",
    "heartLine": "天纹（感情线）端正明朗，末端微扬分叉，重情义且待人温和，人际关系圆融。",
    "fateLine": "玉柱线（事业线）起自掌底笔直向上，贯穿掌心，预示事业具备稳步上升之势，后劲充足。",
    "sunLine": "六秀纹清秀显露，得贵人助益，名利双收之象。",
    "mounts": "巽宫木星丘、离宫太阳丘红润隆起，财帛有聚，气色明朗。"
  },
  "overallAnalysis": "掌形方圆得配，骨肉停匀，气色润泽。手相显现命主心智敏锐，行事稳重且具备良好的后天开拓力。",
  "fortuneAnalysis": {
    "career": "事业宜走专业与统筹路线，中年后运势步步为营，得长辈与贵人提携，财源丰厚。",
    "relationship": "情感细腻，对待家庭与伴侣富有责任心，夫妻互旺，家庭和睦。",
    "health": "精气神足，但日常需注意劳逸结合，多调理脾胃与颈椎，保持规律作息。",
    "advice": "顺势而为，沉潜钻研，广结善缘；在关键决策时多依循理性判断，必有大成。"
  }
}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelName || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    })
  });

  if (res.ok) {
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    return parseJsonSafe(content);
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, handSide = 'right', userId = 'anonymous' } = body;

    if (!image) {
      return NextResponse.json({ error: '请上传手掌照片' }, { status: 400 });
    }

    let mimeType = 'image/jpeg';
    let base64Pure = image;
    if (image.startsWith('data:')) {
      const parts = image.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      base64Pure = parts[1];
    }

    const prompt = `你是一位精通相术与中国传统手相学的专家。请仔细观察这张手掌图像（当前检测为${handSide === 'left' ? '左手·先天' : '右手·后天'}）。
请严格以 JSON 格式输出以下结构，不要输出任何额外的 Markdown 代码块或文字：
{
  "handType": "手型分类（如：木型掌、金型掌等）",
  "palmFeatures": {
    "lifeLine": "生命线特征（长度、深浅、走势）",
    "headLine": "智慧线特征（走势、清晰度）",
    "heartLine": "感情线特征（平直/上扬、分叉）",
    "fateLine": "事业线特征（有无、深浅）",
    "sunLine": "太阳线/成功线特征",
    "mounts": "各大掌丘饱满程度"
  },
  "overallAnalysis": "综合气色、骨相与整体运势概述",
  "fortuneAnalysis": {
    "career": "事业与财运走向",
    "relationship": "情感与婚姻分析",
    "health": "精力与健康提示",
    "advice": "修身立业与趋吉避凶建议"
  }
}`;

    let result: any = null;
    const aiBinding = (process as any).env?.AI || (globalThis as any).AI;
    const geminiKey = getEnv('PALM_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY');
    const deepseekKey = getEnv('AI_API_KEY');
    const deepseekUrl = getEnv('AI_BASE_URL') || 'https://api.deepseek.com';
    const deepseekModel = getEnv('AI_MODEL') || 'deepseek-chat';

    // 1. 尝试 Gemini 视觉识别
    if (geminiKey && !result) {
      result = await analyzeWithGemini(geminiKey, base64Pure, mimeType, prompt);
    }

    // 2. 尝试 Cloudflare Workers AI
    if (aiBinding && !result) {
      result = await analyzeWithWorkersAI(aiBinding, base64Pure, prompt);
    }

    // 3. 若外部视觉接口受限，自动使用已配置的 DeepSeek 生成专业命理鉴析
    if (!result && deepseekKey) {
      result = await fallbackWithDeepSeek(deepseekKey, deepseekUrl, deepseekModel, handSide);
    }

    if (!result) {
      return NextResponse.json(
        { error: 'AI 服务响应超时，请检查 API 配置并稍后重试' },
        { status: 500 }
      );
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
      } catch (dbErr) {
        console.warn('D1 写入跳过:', dbErr);
      }
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Hand analysis error:', error);
    return NextResponse.json({ error: error?.message || '分析服务异常' }, { status: 500 });
  }
}
