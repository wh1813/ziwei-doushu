interface ExtractInput {
  apiKey: string;
  model: string;
  imageBase64: string; // 纯 base64（无前缀）
  mimeType: string;
  handSide: string; // 左手 / 右手
}

const VISION_PROMPT = `你是一位精通传统手相学的专家（同时具备现代皮肤解剖常识）。请仔细观察这张手掌照片，按以下维度提取特征，用精简、结构化的中文逐条输出（每条一句话，不编造照片中看不到的内容）：

1. 生命线：深浅、长短、弧度、是否断裂或分叉、末端特征
2. 智慧线：走向（横贯/向下）、弯曲度、是否分叉
3. 感情线：起点高低、是否分叉、有无岛纹
4. 事业线（如有）：长短、清晰度、是否断续
5. 掌形与手型：长宽比、指节、掌心厚薄
6. 其他显著纹路或特征（如有）

规则：
- 只描述照片中真实可见的特征；某条线看不清楚就明确写“看不清楚”，不要臆测。
- 只输出特征清单本体，不要输出任何占位符、解释或 Markdown 分隔线。`;

/**
 * 调用 Gemini 视觉模型提取手相特征。
 * 采用 fetch 直连 Google Generative Language REST 接口，避免引入额外 SDK 依赖，
 * 与现有项目“零冗余依赖”的风格保持一致。
 */
export async function extractPalmFeatures(input: ExtractInput): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    input.model,
  )}:generateContent?key=${encodeURIComponent(input.apiKey)}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: `${input.handSide}手掌照片特征提取：${VISION_PROMPT}` },
          { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.3, maxOutputTokens: 900 },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`视觉识别失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text.trim()) throw new Error('视觉识别未返回有效特征');
  return text.trim();
}