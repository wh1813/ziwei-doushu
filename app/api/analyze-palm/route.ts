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

function getBinding(name: string): any {
  return (process as any).env?.[name] || (globalThis as any)[name];
}

// =====================================================================
// 阶段 A：视觉特征提取 —— 只负责“看”，输出每个维度的详细观察
// =====================================================================

const VISION_PROMPT = `你是一位精通传统手相学与手掌解剖的资深相学师。请仔细观察这张手掌照片（掌心朝上），对以下每一个维度都给出【尽可能详尽、具体】的观察描述，每项 2-4 句，不要只写一句话。

请严格按以下 JSON 结构输出（不要输出 Markdown 代码块或文字）：
{
  "handType": "手型分类及理由，2-3句描述掌形的长宽比、指节、掌心厚薄、整体观感",
  "palmFeatures": {
    "lifeLine": "生命线（地纹）：起点位置、长度距离、深浅粗细、弧度、是否断裂/分叉/链状/岛纹，末端走势",
    "headLine": "智慧线（人纹）：起点与生命线的关联、走向（横贯/向下/分叉）、平直或弯曲、清晰度、是否有岛纹",
    "heartLine": "感情线（天纹）：起点高低、平直或上扬、是否分叉、有无岛纹/链状、末端指向",
    "fateLine": "事业线/玉柱线：有无、起点（掌底/掌心）、长度、深浅、断续情况、是否穿过天纹",
    "sunLine": "太阳线/成功线：有无、是否清晰、是否被横纹切断",
    "mounts": "掌丘：金星丘、木星丘、太阳丘、水星丘、月丘的厚薄饱满程度与气色"
  },
  "supplement": "其他显著特征：如断掌横纹、健康线、子女线、通贯手、M字纹等特殊纹路，以及皮肤气色、弹性等观感"
}

规则：只描述照片里真实可见的内容；某条线看不清楚就明确写“此线在照片中不明显/看不清楚”，绝不臆造。输出必须严格为合法 JSON。`;

// 视觉识别：优先 Gemini，其次 Workers AI（都能看图）
async function visionExtract(base64Pure: string, mimeType: string, handSide: string): Promise<any> {
  const promptText = `当前检测为${handSide === 'left' ? '左手·先天' : '右手·后天'}。\n${VISION_PROMPT}`;

  // 1) Gemini
  const geminiKey = getEnv('PALM_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY');
  if (geminiKey) {
    for (const model of ['gemini-1.5-flash', 'gemini-1.5-pro']) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
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
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
          })
        });
        if (res.ok) {
          const json = await res.json();
          const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const parsed = parseJsonSafe(text);
          if (parsed && (parsed.palmFeatures || parsed.handType)) return parsed;
        }
      } catch (err) { console.warn(`Gemini ${model} vision failed:`, err); }
    }
  }

  // 2) Cloudflare Workers AI 视觉
  const aiBinding = getBinding('AI');
  if (aiBinding) {
    try {
      const binary = atob(base64Pure);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const response = await aiBinding.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        image: Array.from(bytes),
        prompt: promptText + " 必须严格仅输出 JSON 对象格式。",
        max_tokens: 1600,
      });
      const rawText = response?.response || response?.description || '';
      const parsed = parseJsonSafe(rawText);
      if (parsed) return parsed;
    } catch (err) { console.warn('Workers AI vision failed:', err); }
  }

  return null;
}

// =====================================================================
// 阶段 B：DeepSeek 深度报告 —— 基于详细特征 + 用户提问，生成分维度详解
// =====================================================================

async function deepseekReport(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  handSide: string;
  features: any;        // 视觉提取出的 features 对象
  userQuestion?: string; // 用户可选提问
}): Promise<any> {
  const baseUrl = (opts.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/chat/completions`;

  const systemPrompt = `你是一位深谙传统相术与现代心理学的资深命理师。用户上传了${opts.handSide === 'left' ? '左手（先天）' : '右手（后天）'}手相图，机器视觉已提取出详细掌纹特征。请你基于这些【真实可见的掌纹事实】，撰写一份严谨、详尽、正向、有洞见的掌纹命理鉴析报告。

硬性写作要求：
1. 分维度详解：对“生命线/智慧线/感情线/事业线/太阳线/掌丘/其他特征”每一个维度，都用【线体观察 → 相学释义 → 现实映射】三段式展开，每维度至少 3-5 句，务必具体、专业、言之有物，杜绝一句带过。
2. 若某视觉特征明确标注“看不清楚/不明显”，则如实说明该维度信息有限，转而从整体格局与心理学角度给出温和提示，绝不臆造不存在的内容。
3. 运势分析：事业、财运、情感、健康四个维度分别展开，每项 3-4 句，结合掌纹佐证。
4. 若用户填写了【用户提问】，必须单设一节【深度问答】专门、逐条、深入地解答该提问（每条答案 3-6 句）。
5. 语气温和正向、有激励性，不制造焦虑，不预测具体灾祸，不出现“我是AI”“我不能”等表述。
6. 结尾给 2-3 条修身养性的建议。

请以如下 JSON 结构输出（不要输出 Markdown 代码块）：
{
  "handType": "手型总评",
  "overallAnalysis": "整体气色与骨相格局总述，3-4句",
  "lineAnalysis": {
    "lifeLine": "生命线详解（三段式）",
    "headLine": "智慧线详解（三段式）",
    "heartLine": "感情线详解（三段式）",
    "fateLine": "事业线详解（三段式）",
    "sunLine": "太阳线详解（三段式）",
    "mounts": "掌丘详解（三段式）",
    "others": "其他特征详解"
  },
  "fortuneAnalysis": {
    "career": "事业与财运，3-4句",
    "relationship": "情感与婚姻，3-4句",
    "health": "气血与健康，3-4句",
    "advice": "趋吉避凶建议"
  },
  "questionAnswer": "【若有用户提问】这里是逐条深度问答；没有提问则返回空字符串"
}`;

  const userContent = `【掌纹视觉特征】
${JSON.stringify(opts.features, null, 2)}

【用户提问】
${opts.userQuestion?.trim() ? opts.userQuestion : '（用户未提问，请基于掌纹给出全面深度鉴析）'}

请依据以上真实掌纹特征，撰写完整深度报告。`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey}` },
    body: JSON.stringify({
      model: opts.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 4096,
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`深度报告生成失败 (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = parseJsonSafe(content);
  if (!parsed) throw new Error('深度报告解析失败');
  return parsed;
}

// =====================================================================
// POST 主入口
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { image, handSide = 'right', userId = 'anonymous', question } = body;

    if (!image) {
      return NextResponse.json({ error: '请上传手掌照片' }, { status: 400 });
    }

    let mimeType = 'image/jpeg';
    let ext = 'jpg';
    let base64Pure = image;
    if (image.startsWith('data:')) {
      const parts = image.split(',');
      const match = parts[0].match(/:(.*?);/);
      if (match) mimeType = match[1];
      ext = mimeType.includes('png') ? 'png' : 'jpg';
      base64Pure = parts[1];
    }

    // ---------- 阶段 1：视觉详细特征提取 ----------
    const features = await visionExtract(base64Pure, mimeType, handSide);
    if (!features) {
      return NextResponse.json({ error: 'AI 视觉识别失败，请检查 API 配置后重试' }, { status: 500 });
    }

    // ---------- 阶段 2：写入 R2 持久化图片 ----------
    let imageKey: string | null = null;
    const r2 = getBinding('PALM_IMAGES_BUCKET');
    if (r2) {
      try {
        const recordId = crypto.randomUUID();
        imageKey = `palms/${userId}/${recordId}.${ext}`;
        const binary = atob(base64Pure);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await r2.put(imageKey, bytes, { httpMetadata: { contentType: mimeType } });
      } catch (r2Err) {
        console.warn('R2 写入跳过:', r2Err);
        imageKey = null;
      }
    }

    // ---------- 阶段 3：DeepSeek 深度报告 ----------
    const deepseekKey = getEnv('AI_API_KEY') || getEnv('PALM_DEEPSEEK_API_KEY');
    const deepseekUrl = getEnv('AI_BASE_URL') || getEnv('PALM_DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
    const deepseekModel = getEnv('AI_MODEL') || 'deepseek-chat';

    let report: any = null;
    if (deepseekKey) {
      try {
        report = await deepseekReport({
          apiKey: deepseekKey,
          baseUrl: deepseekUrl,
          model: deepseekModel,
          handSide,
          features,
          userQuestion: typeof question === 'string' ? question : '',
        });
      } catch (reportErr) {
        console.warn('深度报告失败，退回视觉特征直出:', reportErr);
      }
    }

    // 深度报告失败时的降级：直接返回视觉特征本体
    const finalData = report || {
      handType: features.handType || '（识别中）',
      overallAnalysis: '（深度报告生成失败，以下为视觉初步分析）',
      lineAnalysis: features.palmFeatures || {},
      fortuneAnalysis: {} as any,
      questionAnswer: '',
      _fallback: true,
    };

    // ---------- 阶段 4：写入 D1（记录元数据 + 关联 R2 图） ----------
    const db = getBinding('QUERY_LOGS_DB');
    if (db) {
      try {
        await db.prepare(`
          INSERT INTO palm_records (id, user_id, image_key, image_url, extracted_features, report_content, hand_side, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          crypto.randomUUID(),
          userId,
          imageKey || '',
          imageKey ? `/api/palm-image/${imageKey}` : '',
          JSON.stringify(features.palmFeatures || features),
          JSON.stringify(finalData),
          handSide
        ).run();
      } catch (dbErr) {
        console.warn('D1 写入跳过:', dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      data: finalData,
      imageUrl: imageKey ? `/api/palm-image/${imageKey}` : null,
    });
  } catch (error: any) {
    console.error('Hand analysis error:', error);
    return NextResponse.json({ error: error?.message || '分析服务异常' }, { status: 500 });
  }
}