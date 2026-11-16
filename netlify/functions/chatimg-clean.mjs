/* ลบรูป/เสียงแชทที่หมดอายุ (เกิน 24 ชม.) ทุกชั่วโมง */
import { getStore } from '@netlify/blobs';
import { IMG_ID, imgStore, audStore } from '../lib/chatimg.mjs';

export default async () => {
  const st = imgStore(), { blobs } = await st.list(), now = Date.now();
  let n = 0;
  for (const { key } of blobs) {
    if (IMG_ID.test(key) && +key.slice(0, 13) <= now) { await st.delete(key).catch(() => {}); n++; }
  }
  const as = audStore(), ab = (await as.list()).blobs;
  for (const { key } of ab) { if (IMG_ID.test(key) && +key.slice(0, 13) <= now) { await as.delete(key).catch(() => {}); n++; } }
  /* ลบข้อมูลสายโทรค้าง (เก่ากว่า 1 ชม.) */
  try {
    const cs = getStore('calls'), cb = (await cs.list({ prefix: 'call/' })).blobs;
    for (const { key } of cb) { const id = key.split('/')[1] || ''; if (id.length >= 8 && now - parseInt(id.slice(0, 8), 36) > 3600e3) await cs.delete(key).catch(() => {}); }
  } catch (e) { /* ignore */ }
  console.log('chat media cleaned', n);
};
export const config = { schedule: '@hourly' };
