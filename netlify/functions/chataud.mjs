/* ส่งข้อความเสียงในห้องแชทให้ผู้ที่มีลิงก์ (เดาไม่ได้) · หมดอายุ 24 ชม. แล้วตอบ 410
   GET /api/chataud?id=<id> */
import { IMG_ID, AUD_MIME, audStore } from '../lib/chatimg.mjs';

export default async (req) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!IMG_ID.test(id)) return new Response('bad id', { status: 400 });
  const left = +id.slice(0, 13) - Date.now(), st = audStore();
  if (left <= 0) { await st.delete(id).catch(() => {}); return new Response('expired', { status: 410 }); }
  const r = await st.getWithMetadata(id, { type: 'arrayBuffer' }).catch(() => null);
  if (!r || !r.data) return new Response('gone', { status: 410 });
  const type = r.metadata && AUD_MIME[r.metadata.type] ? r.metadata.type : 'audio/webm';
  return new Response(r.data, { headers: { 'content-type': type, 'cache-control': 'private, max-age=' + Math.floor(left / 1000), 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'accept-ranges': 'none' } });
};
export const config = { path: '/api/chataud' };
