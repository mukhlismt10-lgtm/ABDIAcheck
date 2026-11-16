/* สายโทรในแอพ (เสียง/วิดีโอ) — ส่วนที่ใช้ร่วม
   ใช้ WebRTC ระหว่างเครื่อง · เซิร์ฟเวอร์เป็นแค่ที่ส่งต่อข้อมูลจับคู่ (signaling) เก็บใน store `calls`
   key ฝ่าย: ครู = t-<uid> · ผู้ปกครอง = p-<รหัสนักเรียน> */
import { getStore } from '@netlify/blobs';

export const callStore = () => getStore('calls');
export const RING_MS = 45000;
export const callId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const CALL_ID = /^[a-z0-9]{10,24}$/;
/* สายเรียกเข้าที่รออยู่ของฝ่าย key (ไม่มี/หมดอายุ = null) · ใช้แนบไปกับโพลล์ข้อความเดิม ไม่ต้องมีตัวจับเวลาเพิ่ม */
export async function callInbox(key) {
  try {
    const st = callStore(), c = await st.get('call/in/' + key, { type: 'json' }).catch(() => null);
    if (!c) return null;
    if (Date.now() - c.at > RING_MS) { await st.delete('call/in/' + key).catch(() => {}); return null; }
    const e = await st.get('call/' + c.id + '/e', { type: 'json' }).catch(() => null);
    if (e) { await st.delete('call/in/' + key).catch(() => {}); return null; }
    return { id: c.id, name: c.name, kind: c.kind, at: c.at };
  } catch (e) { return null; }
}
