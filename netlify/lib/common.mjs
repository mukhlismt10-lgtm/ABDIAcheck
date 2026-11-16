/* ตัวช่วยร่วมของฟังก์ชันแจ้งเตือน (ไม่ใช่ฟังก์ชันเอง จึงเก็บไว้นอกโฟลเดอร์ functions) */
import webpush from 'web-push';

export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'abdia-check';

function uidFromToken(t) {
  try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); return p.user_id || p.sub || null; } catch (e) { return null; }
}
/* ตรวจตัวตนและสิทธิ์จริงจาก Firestore (ใช้ ID token ของผู้ใช้เอง ตามกฎความปลอดภัยของโปรเจกต์) */
const VC = new Map(); /* แคชผลตรวจตัวตน 60 วินาที (ลดเวลาตอบทุกครั้งที่กดส่ง/ไลค์) */
export async function verify(idToken) {
  const uid = uidFromToken(idToken || ''); if (!uid) return null;
  const hit = VC.get(idToken); if (hit && hit.t > Date.now()) return hit.v;
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/members/${uid}`, { headers: { Authorization: 'Bearer ' + idToken } });
    if (!r.ok) return null;
    const f = ((await r.json()).fields) || {};
    const v = { uid, role: (f.role && f.role.stringValue) || '', name: (f.name && f.name.stringValue) || '' };
    if (VC.size > 300) VC.clear();
    VC.set(idToken, { v, t: Date.now() + 60000 });
    return v;
  } catch (e) { return null; }
}
export function initPush() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.log('missing VAPID keys'); return false; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
  return true;
}
export async function send(store, key, rec, payload) {
  try { await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 86400, urgency: 'high' }); return true; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.delete(key); else console.log('push fail', e.statusCode); return false; }
}
export async function allSubs(store) {
  const { blobs } = await store.list();
  const recs = await Promise.all(blobs.map(async ({ key }) => ({ key, rec: await store.get(key, { type: 'json' }).catch(() => null) })));
  return recs.filter((x) => x.rec && x.rec.sub);
}
/* ทำงานเบื้องหลังต่อหลังตอบผู้ใช้แล้ว (ถ้าแพลตฟอร์มรองรับ waitUntil) ไม่งั้นรอให้เสร็จ */
export async function after(ctx, p) {
  const q = Promise.resolve(p).catch((e) => console.log('bg fail', String(e)));
  if (ctx && typeof ctx.waitUntil === 'function') { ctx.waitUntil(q); return; }
  await q;
}
export const cfgOf = (rec) => Object.assign({ attOn: true, wcOn: true, wcMin: 5, mwOn: true, mwN: 3, slOn: true, slOkOn: true, regOn: true, dmOn: true }, rec.cfg || {});
export const clip = (v, n = 160) => String(v == null ? '' : v).slice(0, n);
export function bangkokNow() {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  return { today: p.year + '-' + p.month + '-' + p.day, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], hour, nowM: hour * 60 + +p.minute };
}
