import { getCloudflareContext } from '@opennextjs/cloudflare';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 从 R2 读取手相照片并返回。
 * 路径形如：/api/palm-image/palms/{userId}/{recordId}.jpg
 * 开启一年边缘缓存；不行使签名，仅在公开场景下可直接访问（若需私有可加鉴权）。
 */
export async function GET(request: Request): Promise<Response> {
  // /api/palm-image/palms/user/uuid.jpg  ->  palms/user/uuid.jpg
  const path = new URL(request.url).pathname;
  const imageKey = path.replace(/^\/api\/palm-image\//, '');

  if (!imageKey.startsWith('palms/') || /\.\./.test(imageKey) || imageKey.length > 512) {
    return new Response('图片不存在', { status: 404 });
  }

  const { env } = getCloudflareContext();
  const object = await env.PALM_IMAGES_BUCKET.get(imageKey);
  if (!object) return new Response('图片不存在', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
}