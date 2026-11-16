/* รูปผลงานในกระดานประกวด (ลิงก์เดาไม่ได้) · GET /api/contestimg?id=<id> */
import { getStore } from '@netlify/blobs';

export const CIMG_ID = /^\d{13}-[a-f0-9]{32}$/;
export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!CIMG_ID.test(id)) return new Response('bad id', { status: 400 });
  const buf = await getStore('contestimg').get(id, { type: 'arrayBuffer' }).catch(() => null);
  if (!buf) return new Response('gone', { status: 410 });
  return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' } });
};
export const config = { path: '/api/contestimg' };
