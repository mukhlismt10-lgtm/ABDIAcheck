/* ตัวช่วยร่วมของฟังก์ชันแจ้งเตือน (ไม่ใช่ฟังก์ชันเอง จึงเก็บไว้นอกโฟลเดอร์ functions) */
import webpush from 'web-push';

export const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'abdia-check';

function uidFromToken(t) {
  try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); return p.user_id || p.sub || null; } catch (e) { return null; }
}
/* ตรวจตัวตนและสิทธิ์จริงจาก Firestore (ใช้ ID token ของผู้ใช้เอง ตามกฎความปลอดภัยของโปรเจกต์) */
export async function verify(idToken) {
  const uid = uidFromToken(idToken || ''); if (!uid) return null;
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/members/${uid}`, { headers: { Authorization: 'Bearer ' + idToken } });
    if (!r.ok) return null;
    const f = ((await r.json()).fields) || {};
    return { uid, role: (f.role && f.role.stringValue) || '', name: (f.name && f.name.stringValue) || '' };
  } catch (e) { return null; }
}
export function initPush() {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.log('missing VAPID keys'); return false; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', pub, priv);
  return true;
}
export async function send(store, key, rec, payload) {
  try { await webpush.sendNotification(rec.sub, JSON.stringify(payload), { TTL: 3600, urgency: 'high' }); return true; }
  catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await store.delete(key); else console.log('push fail', e.statusCode); return false; }
}
export async function allSubs(store) {
  const { blobs } = await store.list(), out = [];
  for (const { key } of blobs) { const rec = await store.get(key, { type: 'json' }).catch(() => null); if (rec && rec.sub) out.push({ key, rec }); }
  return out;
}
export const cfgOf = (rec) => Object.assign({ attOn: true, wcOn: true, wcMin: 5, mwOn: true, mwN: 3, slOn: true, slOkOn: true, regOn: true }, rec.cfg || {});
export const clip = (v, n = 160) => String(v == null ? '' : v).slice(0, n);
export function bangkokNow() {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  return { today: p.year + '-' + p.month + '-' + p.day, wd: { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday], hour, nowM: hour * 60 + +p.minute };
}
