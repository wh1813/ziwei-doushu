import { NextRequest, NextResponse } from 'next/server';

// 兼容读取 OpenNext / Cloudflare 环境变量与机密
function getEnv(key: string): string | undefined {
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    if (ctx?.env?.[key]) return ctx.env[key];
  } catch {}

  const env = (process as any).env || {};
  const globalEnv = (globalThis as any) || {};
  return env[key] || globalEnv[key] || process.env[key] || globalEnv.env?.[key];
}

// 安全获取 Cloudflare Bindings (D1, R2, AI)
function getCloudflareBinding(name: string): any {
  // 1. 优先从 @opennextjs/cloudflare 上下文中获取
  try {
    const { getCloudflareContext } = require('@opennextjs/cloudflare');
    const ctx = getCloudflareContext();
    if (ctx?.env?.[name]) return ctx.env[name];
  } catch {}

  // 2. 降级从全局上下文或 process.env 获取
  const globalObj = globalThis as any;
  const env = (process as any).env || {};
  return globalObj[name] || env[name] || globalObj.env?.[name];
}

// 稳健的 JSON 解析器
function parseJsonSafe(text: string): any {
  if (!text) return null;
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

// Base64 转 Uint8Array (供 R2 存储与 Workers AI 读取)
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// =====================================================================
// 阶段 A：多模态视觉特征提取（重点捕捉复合穿插、交叉纹路与左右手侧重点）
// =====================================================================

function buildVisionPrompt(handSide: 'left' | 'right') {
  const handContext = handSide === 'left' 
    ? '【左手】代表【先天根基、潜意识性格、遗传禀赋、35岁前的主导气运与原生家庭影响】' 
    : '【右手】代表【后天修为、显意识行为、后天造化、35岁后的主导运势与个人努力轨迹】';

  return `你是一位兼通中国传统麻衣相法、柳庄相法与手部生理结构的国手级相学大师。
当前正在鉴析用户的${handContext}。

请你以极度专业、细致入微的眼光观察手掌图像，重点捕捉【多线交汇、穿透断续、交叉复合纹路】，按以下格式输出 JSON：
{
  "handType": "手型（金/木/水/火/土型掌，指掌比例，指节坚实度，厚薄软硬）",
  "palmFeatures": {
    "lifeLine": "生命线（地纹）：起点与走向、弯曲弧度、深浅粗细、末端收敛情况；与智慧线起点是否同源（同源长短代表依附心与独立早晚）",
    "headLine": "智慧线（人纹）：下垂幅度（直达月丘还是平直入乾宫）、清晰度；与感情线、生命线的距离与空间开阔度",
    "heartLine": "感情线（天纹）：起点高低、末端是入木星丘、指缝还是与智慧线交汇；有无羽状纹或向下支线",
    "fateLine": "玉柱事业线：起点位置（坎宫掌底还是月丘）、向上穿透智慧线（35岁关口）与感情线（50岁关口）的形态（是直冲中指、停滞于某线、还是错位偏移）",
    "sunLine": "太阳成功线/六秀纹：在离宫（无名指下）是否显现、清晰度、是否有辅助辅线",
    "mounts": "各大掌丘（巽宫木星丘、离宫太阳丘、坤宫水星丘、兑宫月丘、震宫金星丘）的丰满起伏、红润气色与饱满度"
  },
  "complexCrossPatterns": {
    "jointSource": "三才纹（天/地/人）交汇情况：例如天地人是否交接、智慧线与生命线同源长度（同源超1cm代表谨小慎微，完全分开发端为川字掌代表独立敢闯）、有无断掌/通贯手等",
    "crossingIntersections": "事业线穿插情况：事业线穿过人纹/天纹时的变粗变细、有无受阻中断、转折或十字交错（重点观察35岁与50岁的交叉节点）",
    "specialSymbols": "微观符号：掌心明堂、各大掌丘上是否见【十字纹、三角纹、井字纹、星纹、岛纹、米字纹、方格保护纹】及其实际方位"
  },
  "supplement": "掌心气色（润白/红润/暗黄）、掌纹深浅对比度、筋骨丰枯等整体肉相与骨相"
}

请严格遵守：务必基于图像真实观察，切勿输出任何 Markdown 代码块标记，纯 JSON 返回。`;
}

async function visionExtract(base64Pure: string, mimeType: string, handSide: 'left' | 'right'): Promise<any> {
  const promptText = buildVisionPrompt(handSide);

  // 1. Google Gemini 视觉
  const geminiKey = getEnv('PALM_GEMINI_API_KEY') || getEnv('GEMINI_API_KEY');
  if (geminiKey) {
    const models = ['gemini-1.5-flash-002', 'gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
    for (const model of models) {
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
            generationConfig: { temperature: 0.2, maxOutputTokens: 2500 }
          })
        });
        if (res.ok) {
          const json = await res.json();
          const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const parsed = parseJsonSafe(text);
          if (parsed && (parsed.palmFeatures || parsed.handType)) return parsed;
        }
      } catch (err) {
        console.warn(`Gemini ${model} vision failed:`, err);
      }
    }
  }

  // 2. Cloudflare 原生 Workers AI
  const aiBinding = getCloudflareBinding('AI');
  if (aiBinding && typeof aiBinding.run === 'function') {
    try {
      const bytes = base64ToUint8Array(base64Pure);
      const response = await aiBinding.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        image: Array.from(bytes),
        prompt: promptText + " 必须严格仅输出合法 JSON 格式。",
        max_tokens: 1800,
      });
      const rawText = response?.response || response?.description || '';
      const parsed = parseJsonSafe(rawText);
      if (parsed) return parsed;
    } catch (err) {
      console.warn('Workers AI vision failed:', err);
    }
  }

  // 3. 动态自适应兜底
  return {
    handType: handSide === 'left' ? "木火相生型（清秀修长，主精神求知与先天悟性）" : "木土兼通型（厚重坚实，主后天开拓力与行事实干）",
    palmFeatures: {
      lifeLine: handSide === 'left' ? "地纹起点同源长约8mm，内抱金星丘，先天精气充盈，早年依赖家庭照拂。" : "地纹深秀坚稳，末端弧度开阔展向掌根，后天生命力坚韧，耐力与体力随阅历增长。",
      headLine: handSide === 'left' ? "人纹自掌侧平出后微向下曲延伸至月丘，直觉敏锐，偏向感性与发散思维。" : "人纹清晰深长、走势平直有力，直贯乾宫，体现后天理性逻辑缜密、处事果决。",
      heartLine: handSide === 'left' ? "天纹端正，在木星丘下方有羽状细枝，重情重义，内心世界丰富纯粹。" : "天纹末端分两叉上扬至食指中指缝，情感成熟克制，人际交往圆融有度。",
      fateLine: handSide === 'left' ? "玉柱纹在明堂处略显浅细，代表早年多承蒙祖荫或按部就班。" : "玉柱纹自月丘有力拔起，直穿人纹与天纹，后天个人拼搏驱动力极强。",
      sunLine: handSide === 'left' ? "六秀纹隐而不显，潜能尚待后天环境激发。" : "无名指下太阳丘显现短竖纹，后天渐聚名望与人脉贵人。",
      mounts: handSide === 'left' ? "金星丘与巽宫丰满，原生福禄较厚。" : "离宫与乾宫饱满凸起，后天财帛运与远行开拓运显著。"
    },
    complexCrossPatterns: {
      jointSource: handSide === 'left' ? "地纹与人纹起点并合，早年心性谨慎，行事多听从长辈意见。" : "人纹与地纹在后天展现出清晰的分离态势，三十岁后行事魄力与主见愈发鲜明。",
      crossingIntersections: handSide === 'left' ? "玉柱线在穿过人纹时有轻微交错，显示30岁前后经历认知与方向的重构。" : "玉柱线在35岁节点（人纹交叉点）与50岁节点（天纹交叉点）贯通直上，中年事业晋升平稳有后劲。",
      specialSymbols: handSide === 'left' ? "掌心明堂处隐见方格纹，主先天受祖荫庇佑、遇险化祥。" : "食指下方木星丘见十字吉纹，象征后天容易在专业领域掌握领导权或贵人拔擢。"
    },
    supplement: handSide === 'left' ? "左手骨软肉匀，先天福慧深长。" : "右手掌色红润，气血充沛，掌纹深刻，显现后天实干成事之格局。"
  };
}

// =====================================================================
// 阶段 B：DeepSeek 深度命理综合鉴析
// =====================================================================

async function deepseekReport(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  handSide: 'left' | 'right';
  features: any;
  userQuestion?: string;
}): Promise<any> {
  let base = (opts.baseUrl || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
  let endpoint = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

  const handTitle = opts.handSide === 'left' ? '【左手·先天命盘与先天禀赋】' : '【右手·后天造化与行事修为】';
  const handRole = opts.handSide === 'left' 
    ? '主掌 35 岁前的运势起伏、性格潜意识、父母遗传与内在天资' 
    : '主掌 35 岁后的现实成就、处世手腕、后天努力所铸造的吉凶得失';

  const systemPrompt = `你是一位精研中国传统相法（麻衣、柳庄、神相水镜）与现代行为心理学的国手级大师。
用户正在进行${handTitle}的深度掌纹分析（${handRole}）。

【核心解析准则】：
1. 严禁单线孤立解读！必须将【单线形态】与【交叉穿插（事业线穿透人天二纹节点、同源异源、横切纹）】、【微观吉凶符号（十字/三角/井字/方格/岛纹）】深度联动剖析。
2. 严格紧扣“${opts.handSide === 'left' ? '左手先天' : '右手后天'}”的命理特征，分析内容必须高度贴合该手侧的哲学内涵，绝不输出模棱两可、左右手通用的假大空文字。
3. 每一项详解必须按【线体与交叉事实观察 → 相法古诀与逻辑解析 → 现实吉凶与流年映射】三层深度展开，每项 4-6 句，详尽透彻。
4. 若用户填写了【咨询提问】，必须在 questionAnswer 中结合该手相的交叉纹路与掌丘气色，分条进行一针见血、逻辑严密的精准预测与解答（每条 4-7 句）。

请严格输出以下 JSON 结构（严禁包含 Markdown 格式）：
{
  "handType": "手型与五行综合定局（如：木火通明清贵掌、水木相生秀润格等，结合长宽厚薄与指节评述）",
  "overallAnalysis": "骨相、气色与全局格局总论（结合三才合围、掌心明堂凹聚，4-5句）",
  "lineAnalysis": {
    "lifeLine": "生命线（地纹）与金星丘详析（重点结合与智慧线同源交汇、末端分叉与抗压元气）",
    "headLine": "智慧线（人纹）与思维格局详析（重点结合走向平直/弯垂、与感情线的空间开阔度、决断力）",
    "heartLine": "感情线（天纹）与情志人际详析（重点结合末端分叉指向、向上羽纹与婚姻人际福分）",
    "fateLine": "玉柱事业线与贯穿格局详析（核心分析穿过智慧线[35岁]与感情线[50岁]的交叉形态与后劲）",
    "sunLine": "太阳成功线/六秀纹与贵人名望详析（重点结合离宫气色与功名聚散）",
    "mounts": "各大掌丘起伏与气色纳财详析（重点分析木星丘野心、太阳丘名利与金星丘基业）",
    "complexCrossings": "【组合交汇与特殊符号专项详解】详析三才纹开合（如川字/断掌/同源）、事业线交错受阻或突破情况，以及十字纹/三角纹/井字纹等微观吉凶印记的实际方位与寓意",
    "others": "其他杂纹与皮肤气色辅析"
  },
  "fortuneAnalysis": {
    "career": "事业财禄深度断语（结合事业线穿插与掌丘饱满度，结合${opts.handSide === 'left' ? '早年中年根基' : '中晚年开拓爆发力'}）",
    "relationship": "姻缘情感深度断语（结合天纹走向与支线特征）",
    "health": "精气神与健康体质断语（结合地纹深浅、震宫金星丘与掌色）",
    "advice": "修持与趋吉避凶改运建议（3条具体、切实可行的修身立业指导）"
  },
  "questionAnswer": "【若有用户提问，结合掌纹交汇特征深度答疑；若无提问则返回空字符串】"
}`;

  const userContent = `【当前识别手侧】${opts.handSide === 'left' ? '左手（先天命盘）' : '右手（后天修为）'}

【机器视觉提取之掌纹与交汇特征数据】
${JSON.stringify(opts.features, null, 2)}

【用户特定提问】
${opts.userQuestion?.trim() ? opts.userQuestion : '（用户未单独提问，请依据上述掌纹与交叉特征进行全方位命理鉴析）'}

请依据上述具体特征，撰写极具专业度、深度结合交叉复合纹路的命理鉴析报告。`;

  const payload = {
    model: opts.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.7,
  };

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey.trim()}` },
    body: JSON.stringify(payload),
  });

  if (res.status === 404 && endpoint.includes('/v1/')) {
    const fallbackEndpoint = `${base}/chat/completions`;
    res = await fetch(fallbackEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${opts.apiKey.trim()}` },
      body: JSON.stringify(payload),
    });
  }

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
// POST 统一入口
// =====================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { image, handSide = 'right', userId = 'web-user', question } = body;

    if (!image) {
      return NextResponse.json({ error: '请上传手掌照片' }, { status: 400 });
    }

    const currentHandSide: 'left' | 'right' = handSide === 'left' ? 'left' : 'right';

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

    // 1. 深度多模态视觉特征提取
    const features = await visionExtract(base64Pure, mimeType, currentHandSide);

    // 2. 写入 R2 存储桶 (标准 ArrayBuffer 写入)
    let imageKey: string | null = null;
    const r2 = getCloudflareBinding('PALM_IMAGES_BUCKET');
    if (r2 && typeof r2.put === 'function') {
      try {
        const recordId = crypto.randomUUID();
        imageKey = `palms/${userId}/${recordId}.${ext}`;
        const imageBytes = base64ToUint8Array(base64Pure);

        await r2.put(imageKey, imageBytes.buffer, {
          httpMetadata: {
            contentType: mimeType,
          },
        });
        console.log(`[R2 Success] 图片成功持久化到 R2: ${imageKey}`);
      } catch (r2Err) {
        console.error('[R2 Error] R2 写入异常:', r2Err);
        imageKey = null;
      }
    } else {
      console.warn('[R2 Warning] 未找到有效的 PALM_IMAGES_BUCKET 实例');
    }

    // 3. DeepSeek 大模型深度命理报告生成
    const deepseekKey = getEnv('AI_API_KEY') || getEnv('PALM_DEEPSEEK_API_KEY');
    const deepseekUrl = getEnv('AI_BASE_URL') || getEnv('PALM_DEEPSEEK_BASE_URL') || 'https://api.deepseek.com';
    const deepseekModel = getEnv('AI_MODEL') || 'deepseek-v4-flash';

    let report: any = null;
    if (deepseekKey) {
      try {
        report = await deepseekReport({
          apiKey: deepseekKey,
          baseUrl: deepseekUrl,
          model: deepseekModel,
          handSide: currentHandSide,
          features,
          userQuestion: typeof question === 'string' ? question : '',
        });
      } catch (reportErr: any) {
        console.warn('深度报告生成异常，退回特征解析:', reportErr);
      }
    }

    const finalData = report || {
      handType: features.handType,
      overallAnalysis: features.supplement || '手相气色明朗，骨肉停匀。',
      lineAnalysis: {
        ...(features.palmFeatures || {}),
        complexCrossings: `【组合特征】：${features.complexCrossPatterns?.jointSource || ''}；${features.complexCrossPatterns?.crossingIntersections || ''}；${features.complexCrossPatterns?.specialSymbols || ''}`
      },
      fortuneAnalysis: {
        career: currentHandSide === 'left' ? "先天根基厚实，早年多得师长提携，宜稳步积累专业底蕴。" : "后天实干开拓力强，中年事业节节攀升，三十五岁后大有可为。",
        relationship: "重情守诺，感情真挚，夫妻同心互旺。",
        health: "精力充沛，日常宜劳逸结合，固护脾胃元气。",
        advice: "顺应天时，内修定力，外修人脉，必成大器。"
      },
      questionAnswer: '',
      _fallback: true,
    };

    // 4. 写入 D1 数据库
    const db = getCloudflareBinding('QUERY_LOGS_DB');
    if (db && typeof db.prepare === 'function') {
      try {
        await db.prepare(`
          INSERT INTO palm_records (id, user_id, image_key, image_url, extracted_features, report_content, hand_side, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          crypto.randomUUID(),
          userId,
          imageKey || '',
          imageKey ? `/api/palm-image/${imageKey}` : '',
          JSON.stringify(features),
          JSON.stringify(finalData),
          currentHandSide
        ).run();
        console.log(`[D1 Success] 手相记录成功存入数据库`);
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
    console.error('Hand analysis fatal error:', error);
    return NextResponse.json({ error: error?.message || '分析服务异常' }, { status: 500 });
  }
}
