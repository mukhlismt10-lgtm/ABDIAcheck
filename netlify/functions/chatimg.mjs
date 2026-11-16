/* ส่งรูปในห้องแชทให้ผู้ที่มีลิงก์ (ลิงก์เดาไม่ได้) ถ้าเกิน 24 ชม. จะลบทิ้งและตอบ 410
   GET /api/chatimg?id=<id> */
import { IMG_ID, imgStore } from '../lib/chatimg.mjs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!IMG_ID.test(id)) return new Response('bad id', { status: 400 });
  const exp = +id.slice(0, 13), left = exp - Date.now(), st = imgStore();
  if (left <= 0) { await st.delete(id).catch(() => {}); return new Response('expired', { status: 410 }); }
  const buf = await st.get(id, { type: 'arrayBuffer' }).catch(() => null);
  if (!buf) return new Response('gone', { status: 410 });
  return new Response(buf, { headers: {
    'content-type': 'image/jpeg', 'cache-control': 'private, max-age=' + Math.floor(left / 1000),
    'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer'
  } });
};
export const config = { path: '/api/chatimg' };
