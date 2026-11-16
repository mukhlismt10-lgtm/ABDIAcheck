/* สถานะออนไลน์: แอพส่ง heartbeat ทุก 1 นาทีตอนเปิดหน้าจอ (ครู: key = uid · ผู้ปกครอง: key = p-<รหัสนักเรียน>)
   ออกจากแอพ (bye) จะจดเวลาจริงไว้พร้อมธง off ฝั่งอ่านจะรู้ว่า "ใช้งานล่าสุดเมื่อกี่นาทีที่แล้ว" (แอพแสดงถึง 24 ชม. เกินกว่านั้นขึ้นว่าออฟไลน์) */
import { getStore } from '@netlify/blobs';

export const PRES_OK = /^[A-Za-z0-9_-]{2,128}$/;
const store = () => getStore('presence');
export async function presBeat(id, off = false) { if (PRES_OK.test(String(id))) await store().setJSON(String(id), off ? { at: Date.now(), off: 1 } : { at: Date.now() }); }
/* คืน { on: { id: อายุ(ms) นับจากครั้งล่าสุด }, left: { id: 1 } (ออกจากแอพแล้ว) } เฉพาะคนที่เคยมี heartbeat */
export async function presOf(ids) {
  const st = store(), now = Date.now(), on = {}, left = {};
  const a = (Array.isArray(ids) ? ids : []).map(String).filter((x) => PRES_OK.test(x)).slice(0, 60);
  await Promise.all(a.map(async (id) => { const r = await st.get(id, { type: 'json' }).catch(() => null); if (r && r.at) { on[id] = Math.max(0, now - r.at); if (r.off) left[id] = 1; } }));
  return { on, left };
}
