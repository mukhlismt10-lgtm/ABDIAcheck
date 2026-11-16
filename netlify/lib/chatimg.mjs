/* รูปในห้องแชท: เก็บชั่วคราว 24 ชม. แล้วลบอัตโนมัติ
   - id = <เวลาหมดอายุ(ms 13 หลัก)>-<สุ่ม 32 hex> จึงรู้เวลาหมดอายุจากชื่อ และเดาลิงก์ไม่ได้
   - ฝั่งไคลเอนต์ย่อ/บีบอัดเป็น JPEG มาก่อนแล้ว (ไม่เกินราว 280 KB) */
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

export const IMG_TTL = 24 * 3600e3;
export const IMG_ID = /^\d{13}-[a-f0-9]{32}$/;
const MAX_B64 = 420000;
export const imgStore = () => getStore('chatimg');

export function parseImg(data) {
  const s = String(data || '');
  if (s.length > MAX_B64) return { error: 'รูปใหญ่เกินไป ลองรูปอื่นน้า' };
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(s);
  if (!m) return { error: 'รูปไม่ถูกต้อง' };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { error: 'รูปไม่ถูกต้อง' };
  return { buf };
}
export async function saveImg(data) {
  const p = parseImg(data); if (p.error) return p;
  const exp = Date.now() + IMG_TTL, id = exp + '-' + randomBytes(16).toString('hex');
  const ab = p.buf.buffer.slice(p.buf.byteOffset, p.buf.byteOffset + p.buf.byteLength);
  await imgStore().set(id, ab);
  return { id, exp };
}
/* ข้อความเสียง: เก็บ 24 ชม. เหมือนรูป (store `chataud`) · ไคลเอนต์อัดแล้วส่งเป็น data URL (ไม่เกินราว 60 วินาที) */
export const audStore = () => getStore('chataud');
export const AUD_MIME = { 'audio/webm': 1, 'audio/mp4': 1, 'audio/ogg': 1, 'audio/mpeg': 1, 'audio/aac': 1, 'audio/x-m4a': 1 };
const MAX_AUD_B64 = 900000;
export async function saveAud(data) {
  const s = String(data || '');
  if (s.length > MAX_AUD_B64) return { error: 'เสียงยาวเกินไป อัดสั้นลงหน่อยน้า' };
  const m = /^data:(audio\/[a-z0-9.+-]+)((?:;[^;,]+)*);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(s);
  if (!m || !AUD_MIME[m[1].toLowerCase()]) return { error: 'ไฟล์เสียงไม่ถูกต้อง' };
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length < 200) return { error: 'เสียงสั้นเกินไป' };
  const exp = Date.now() + IMG_TTL, id = exp + '-' + randomBytes(16).toString('hex'), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  await audStore().set(id, ab, { metadata: { type: m[1].toLowerCase() } });
  return { id, exp };
}
export async function delAud(id) { if (IMG_ID.test(String(id || ''))) await audStore().delete(id).catch(() => {}); }
/* ลบไฟล์แนบของข้อความ (รูป/เสียง) เมื่อยกเลิกส่ง */
export async function dropFiles(f) { if (!f) return; if (f.im) await delImg(f.im); if (f.au) await delAud(f.au); }
export async function delImg(id) { if (IMG_ID.test(String(id || ''))) await imgStore().delete(id).catch(() => {}); }
