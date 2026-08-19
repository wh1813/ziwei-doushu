import { getCloudflareContext } from '@opennextjs/cloudflare';
import { extractPalmFeatures } from '@/lib/ai/palm-vision';
import { generatePalmReport, type ReportInput } from '@/lib/ai/palm-report';
import { getPalmAiConfig } from '@/lib/ai/palm-config';
import { insertPalmRecord } from '@/lib/db/palm-records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 手相照片上传 + R2 存储 + 视觉特征提取 + Vectorize RAG + 报告生成 + D1 落库
 *
 * 架构对齐现有 /api/interpret：
 *  - 通过 getCloudflareContext() 读取 R2 / D1 / Vectorize / AI 绑定
 *  - API Key、模型、Base URL 全部服务端配置，前端不暴露任何供应商与凭据
 *  - 请求体大小、Base64 长度、单条提问长度做白名单式硬限制
 *
 * 请求体：
 *   { imageBase64, userQuery?, userId?, handSide? }
 *   imageBase64  必填，data:image/...;base64, 或纯净 base64
 *   userQuery    选填，用户提问 / 关注维度
 *   userId       选填，默认 anonymous，用于历史记录关联
 *   handSide     选填，'left' | 'right'，默认 'right'
 */
export async function POST(request: Request): Promise<Response> {
  const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5MB，含 base64 膨胀后的图片
  const MAX_BASE64_CHARS = 4 * 1024 * 1024; // 单张图 base64 上限
  const MAX_QUERY_CHARS = 1000;

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > MAX_BODY_BYTES) return errorResponse('请求内容过大', 413);
  if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    return errorResponse('仅支持 JSON 请求', 415);
  }

  if (await isRateLimited(request)) return errorResponse('请求过于频繁，请稍后再试', 429);

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return errorResponse('请求内容过大', 413);
    body = JSON.parse(raw);
  } catch {
    return errorResponse('请求格式无效', 400);
  }

  if (!body || typeof body !== 'object') return errorResponse('请求格式无效', 400);
  const { imageBase64, userQuery, userId, handSide } = body as {
    imageBase64?: unknown;
    userQuery?: unknown;
    userId?: unknown;
    handSide?: unknown;
  };

  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    return errorResponse('请上传手掌照片', 400);
  }
  if (imageBase64.length > MAX_BASE64_CHARS) return errorResponse('图片过大', 413);

  const normalizedQuery =
    typeof userQuery === 'string' && userQuery.trim().length > 0 && userQuery.trim().length <= MAX_QUERY_CHARS
      ? userQuery.trim()
      : '综合运势';
  const normalizedUserId =
    typeof userId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(userId) ? userId : 'anonymous';

  const { env } = getCloudflareContext();
  const cfg = getPalmAiConfig(env as unknown as Record<string, unknown>);
  if (!cfg.geminiApiKey || !cfg.deepseekApiKey) {
    return errorResponse('AI 服务尚未配置完成，请稍后再试', 503);
  }

  try {
    // ---------- 阶段 1：解码并写入 R2 ----------
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBytes = base64ToBytes(cleanBase64);
    const recordId = crypto.randomUUID();
    const mime = detectMime(imageBase64);
    const imageKey = `palms/${normalizedUserId}/${recordId}.${mime === 'image/png' ? 'png' : 'jpg'}`;

    await env.PALM_IMAGES_BUCKET.put(
      imageKey,
      new Uint8Array(imageBytes),
      { httpMetadata: { contentType: mime } },
    );

    // ---------- 阶段 2：视觉特征提取（Gemini） ----------
    const extractedFeatures = await extractPalmFeatures({
      apiKey: cfg.geminiApiKey,
      model: cfg.geminiModel,
      imageBase64: cleanBase64,
      mimeType: mime,
      handSide: handSide === 'left' ? '左手' : '右手',
    });

    // ---------- 阶段 3：RAG 知识增强 ----------
    const ragContext = await queryPalmKnowledge(env, extractedFeatures);

    // ---------- 阶段 4：报告生成（DeepSeek，OpenAI-compatible 流式） ----------
    const reportInput: ReportInput = {
      baseUrl: cfg.deepseekBaseUrl,
      apiKey: cfg.deepseekApiKey,
      model: cfg.deepseekModel,
      features: extractedFeatures,
      ragContext,
      userQuery: normalizedQuery,
    };
    const reportContent = await generatePalmReport(reportInput);

    // ---------- 阶段 5：写入 D1 ----------
    await insertPalmRecord(env, {
      id: recordId,
      userId: normalizedUserId,
      imageKey,
      imageUrl: `/api/palm-image/${imageKey}`,
      extractedFeatures,
      reportContent,
    });

    return Response.json(
      {
        success: true,
        recordId,
        imageUrl: `/api/palm-image/${imageKey}`,
        features: extractedFeatures,
        report: reportContent,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务器处理失败';
    return errorResponse(message, 500);
  }
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function detectMime(base64: string): string {
  const match = /^data:(image\/[\w.+-]+);base64,/.exec(base64);
  return match ? match[1] : 'image/jpeg';
}

function base64ToBytes(b64: string): Uint8Array {
  // 兼容 Node/Bun 运行时
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function isRateLimited(request: Request): Promise<boolean> {
  try {
    const { env } = getCloudflareContext();
    const limiter = (env as unknown as { AI_RATE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> } })
      .AI_RATE_LIMITER;
    if (!limiter) return false;
    const key = request.headers.get('cf-connecting-ip') || 'unknown';
    return !(await limiter.limit({ key })).success;
  } catch {
    return false;
  }
}

async function queryPalmKnowledge(
  env: unknown,
  text: string,
): Promise<string> {
  try {
    const e = env as {
      AI?: { run(model: string, input: { text: string }): Promise<{ data: number[][] }> };
      HAND_KNOWLEDGE_INDEX?: {
        query(vector: number[], opts: { topK: number }): Promise<{ matches: { metadata?: { text?: string } }[] }>;
      };
    };
    if (!e.AI || !e.HAND_KNOWLEDGE_INDEX) return '';
    const { data } = await e.AI.run('@cf/baai/bge-base-zh', { text });
    const vector = data[0];
    const { matches } = await e.HAND_KNOWLEDGE_INDEX.query(vector, { topK: 3 });
    return matches
      .map((m) => m.metadata?.text)
      .filter(Boolean)
      .map((t) => `- ${t}`)
      .join('\n');
  } catch {
    // RAG 失败不应阻断主流程，退化为仅以视觉特征生成报告
    return '';
  }
}