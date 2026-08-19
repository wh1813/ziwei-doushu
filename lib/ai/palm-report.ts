export interface ReportInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  features: string;
  ragContext: string;
  userQuery: string;
  maxOutputTokens?: number;
}

const REPORT_SYSTEM_PROMPT = `你是一位深谙传统相术与现代心理学的解读师。请基于“视觉识别出的手掌特征”与“手相典籍知识”为用户生成一份正向、有趣、结构清晰的掌纹运势报告。

写作要求：
- 下面是用户【手相视觉特征】与【典籍知识】；以特征为事实基础，典籍知识用于佐证延伸。
- 报告中不要出现“我是一个AI”“我不能”等表述。
- 分小节输出：整体印象、性格特质、事业倾向、感情关系、本年度运势提示、给用户的建议。
- 语气温和、正向、有激励性，不制造焦虑，不预测具体灾祸。
- 若【典籍知识】为空，仅凭视觉特征正常输出，不显式提及知识缺失。
- 总长控制在 600 字以内，条理清晰，使用小标题与短段落。`;

/** 生成报告：OpenAI-compatible 非流式一次性输出（DeepSeek / 兼容网关均可）。 */
export async function generatePalmReport(input: ReportInput): Promise<string> {
  const baseUrl = input.baseUrl.replace(/\/+$/, '');
  const endpoint = `${baseUrl}/v1/chat/completions`;

  const messages = [
    { role: 'system', content: REPORT_SYSTEM_PROMPT },
    {
      role: 'user',
      content: `【手相视觉特征】\n${input.features}\n\n【手相典籍知识】\n${
        input.ragContext || '（无）'
      }\n\n【用户提问】\n${input.userQuery}\n\n请基于以上输出完整报告。`,
    },
  ];

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages,
      max_tokens: input.maxOutputTokens ?? 1800,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`报告生成失败 (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new Error('报告生成未返回内容');
  return content.trim();
}