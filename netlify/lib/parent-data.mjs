/* ตัวช่วยของหน้า "ผู้ปกครอง" (เปิดจากแอประบบอับดียะฮ์ด้วยลิงก์ที่มีลายเซ็น)
   - ตรวจลายเซ็นลิงก์ (SAMAN_LINK_SECRET ต้องตรงกับเว็บระบบอับดียะฮ์)
   - อ่านข้อมูลด้วยบัญชี "ดูอย่างเดียว" (READER_EMAIL / READER_PASSWORD) แล้วคัดเฉพาะของนักเรียนคนนั้น */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'abdia-check';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyCblpBZgDIT-G8rKxbvbXh0ZMARICxvtt8';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

export function checkPtWhy(pt) {
  const secret = process.env.SAMAN_LINK_SECRET;
  if (!secret) return { why: 'nosecret' };
  const [p, s] = String(pt || '').split('.');
  if (!p || !s) return { why: 'nolink' };
  const want = createHmac('sha256', secret).update(p).digest(), got = Buffer.from(s, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { why: 'mismatch' };
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!o || !/^\d{1,5}$/.test(String(o.no))) return { why: 'nolink' };
    if (!(o.exp > Date.now())) return { why: 'expired' };
    return { no: String(o.no), email: String(o.e || ''), pv: !!o.pv, tu: String(o.tu || ''), adm: !!o.adm };
  } catch (e) { return { why: 'nolink' }; }
}
/* ลิงก์ "หน้าจำลอง" ให้ครูดูหน้าผู้ปกครองของนักเรียนคนหนึ่ง (อ่านอย่างเดียว) — เซ็นด้วยรหัสเดียวกับลิงก์จริง */
export function mintPt(o) {
  const secret = process.env.SAMAN_LINK_SECRET; if (!secret) return '';
  const p = Buffer.from(JSON.stringify(o)).toString('base64url');
  return p + '.' + createHmac('sha256', secret).update(p).digest('base64url');
}
export function checkPt(pt) { const r = checkPtWhy(pt); return r.no ? r : null; }
export const PT_MSG = {
  nosecret: 'ระบบเช็คงานยังไม่มีรหัส SAMAN_LINK_SECRET (รหัส E1) — แจ้งครูผู้ดูแลแอปให้ใส่รหัสแล้วขึ้นเว็บใหม่',
  mismatch: 'รหัส SAMAN_LINK_SECRET ของสองแอปไม่ตรงกัน (รหัส E2) — แจ้งแอดมินให้ตั้งรหัสให้ตรงกันทั้งสองเว็บ',
  expired: 'ลิงก์หมดอายุแล้ว (รหัส E3) — กรุณากลับไปกด "ติดตามสามัญ" ในแอประบบอับดียะฮ์อีกครั้ง',
  nolink: 'ลิงก์ไม่ถูกต้อง (รหัส E4) — กรุณากลับไปกด "ติดตามสามัญ" ในแอประบบอับดียะฮ์อีกครั้ง'
};
export function pingSig(no, t) {
  return createHmac('sha256', process.env.SAMAN_LINK_SECRET || '').update(`ping|${no}|${t}`).digest('base64url');
}

let TOK = null;
async function readerToken() {
  if (TOK && TOK.exp > Date.now()) return TOK.t;
  const email = process.env.READER_EMAIL, password = process.env.READER_PASSWORD;
  if (!email || !password) throw new Error('ยังไม่ได้ตั้งค่า READER_EMAIL / READER_PASSWORD');
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const j = await r.json();
  if (!r.ok || !j.idToken) throw new Error('บัญชีดูอย่างเดียวเข้าสู่ระบบไม่ได้: ' + ((j.error && j.error.message) || r.status));
  TOK = { t: j.idToken, exp: Date.now() + 50 * 60e3 };
  return TOK.t;
}
function val(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return obj(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return null;
}
const obj = (f) => { const o = {}; for (const k in f) o[k] = val(f[k]); return o; };
async function listCol(col, tok) {
  const out = {}; let page = '';
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${BASE}/${col}?pageSize=300${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: { Authorization: 'Bearer ' + tok } });
    if (!r.ok) throw new Error(`อ่าน ${col} ไม่ได้ (${r.status}) ตรวจว่าบัญชีดูอย่างเดียวได้รับสิทธิ์ "ดูอย่างเดียว" แล้ว`);
    const j = await r.json();
    (j.documents || []).forEach((d) => { out[d.name.split('/').pop()] = obj(d.fields || {}); });
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return out;
}
const COLS = ['cfg', 'students', 'assignments', 'items', 'asg', 'sc', 'att', 'conduct', 'members'];
/* เก็บสำเนาไว้ 1 ชั่วโมง (ใช้ร่วมกันทุกผู้ปกครอง) เพื่อไม่ให้อ่านฐานข้อมูลบ่อยเกินโควตาฟรี */
let CACHE = null;
const TTL = 60 * 60e3;
async function loadAll() {
  if (CACHE && CACHE.exp > Date.now()) return CACHE.d;
  let cs = null; try { cs = getStore('pcache'); } catch (e) { /* ไม่มีที่เก็บ ใช้ความจำอย่างเดียว */ }
  const hit = cs ? await cs.get('all', { type: 'json' }).catch(() => null) : null;
  if (hit && hit.exp > Date.now()) { CACHE = hit; return hit.d; }
  const tok = await readerToken(), d = {};
  await Promise.all(COLS.map(async (c) => { d[c] = await listCol(c, tok); }));
  CACHE = { d, exp: Date.now() + TTL };
  if (cs) await cs.setJSON('all', CACHE).catch(() => {});
  return d;
}
const normNo = (c) => { c = String(c == null ? '' : c).trim(); return /^\d+$/.test(c) ? String(Number(c)) : c; };
/* รหัสนักเรียน (ปรับรูปแล้ว) ที่ครูคนนี้สอน = ห้องที่มีวิชาที่ครูเป็นผู้สอน · ใช้กับการค้นหา/เริ่มแชทหาผู้ปกครอง */
export async function taughtNos(uid) {
  const R = await loadAll(), cfg = (R.cfg && R.cfg.main) || {}, st = cfg.subjectTeachers || {}, rooms = new Set();
  (cfg.subjects || []).forEach((x) => { if ((st[x.id] || []).indexOf(uid) >= 0) (cfg.rooms || []).forEach((r) => { if (!Array.isArray(r.subjects) || r.subjects.indexOf(x.id) >= 0) rooms.add(r.id); }); });
  const out = new Set();
  Object.values(R.students || {}).forEach((s) => { if (rooms.has(s.roomId)) { const n = normNo(s.code); if (n) out.add(n); } });
  return out;
}
export { normNo };
const sameNo = (code, no) => { const c = String(code == null ? '' : code).trim(); return c === no || (/^\d+$/.test(c) && Number(c) === Number(no)); };

/* ข้อมูลเฉพาะนักเรียนเลขที่ no (ทุกห้องที่เรียน) ในรูปแบบเดียวกับเอกสารของแอป */
export async function studentData(no) {
  const R = await loadAll();
  const all = Object.values(R.students || {});
  const first = all.find((s) => sameNo(s.code, no));
  if (!first) return null;
  const pid = first.pid || first.id;
  const recs = all.filter((s) => (s.pid || s.id) === pid);
  const ids = new Set(recs.map((s) => s.id)), rooms = new Set(recs.map((s) => s.roomId));
  const roomOf = {}; all.forEach((s) => { roomOf[s.id] = s.roomId; });
  const cfg = JSON.parse(JSON.stringify((R.cfg && R.cfg.main) || {}));
  cfg.rooms = (cfg.rooms || []).filter((r) => rooms.has(r.id));
  if (cfg.settings && Array.isArray(cfg.settings.sign)) cfg.settings.sign = cfg.settings.sign.map((z) => ({ t: (z && z.t) || '', n: (z && z.n) || '', img: '' }));
  /* นักเรียนสมมติ 1 คนต่อห้อง: แทน "มีเพื่อนได้คะแนนรายการนี้แล้ว" เพื่อให้คิดเกรดตรงกับแอปครู โดยไม่ส่งข้อมูลเพื่อนออกไป */
  const dum = (rid) => '_x_' + rid;
  const students = {}; recs.forEach((s) => { students[s.id] = s; });
  rooms.forEach((rid) => { students[dum(rid)] = { id: dum(rid), pid: dum(rid), roomId: rid, code: '', name: '-' }; });
  const pick = (col) => Object.fromEntries(Object.entries(R[col] || {}).filter(([, x]) => rooms.has(x.roomId)));
  const assignments = pick('assignments'), items = pick('items');
  const cut = (src, keep, isAsg) => {
    const out = {};
    for (const id in keep) {
      const r = (src[id] && src[id].r) || {}, o = {};
      let other = false;
      for (const sid in r) {
        if (ids.has(sid)) o[sid] = r[sid];
        else if (roomOf[sid] === keep[id].roomId) {
          const v = isAsg ? parseFloat(String(r[sid]).split('|')[1]) : r[sid];
          if (typeof v === 'number' && isFinite(v)) other = true;
        }
      }
      if (other) o[dum(keep[id].roomId)] = isAsg ? '0|0' : 0;
      out[id] = { r: o };
    }
    return out;
  };
  const att = {};
  for (const d in (R.att || {})) { const r = (R.att[d] && R.att[d].r) || {}, o = {}; ids.forEach((sid) => { if (r[sid]) o[sid] = r[sid]; }); if (Object.keys(o).length) att[d] = { r: o }; }
  const conduct = {};
  ids.forEach((sid) => { ['', 'bh_'].forEach((p) => { if (R.conduct && R.conduct[p + sid]) conduct[p + sid] = R.conduct[p + sid]; }); });
  /* ครูที่สอนนักเรียนคนนี้ (เลือกส่งข้อความได้) */
  const subs = (cfg.subjects || []).filter((x) => cfg.rooms.some((r) => !Array.isArray(r.subjects) || r.subjects.indexOf(x.id) >= 0));
  const st = cfg.subjectTeachers || {}, tmap = {};
  subs.forEach((x) => (st[x.id] || []).forEach((u) => { const m = (R.members || {})[u]; if (!m || !['admin', 'teacher'].includes(m.role)) return; (tmap[u] = tmap[u] || { id: u, name: m.name || 'ครู', av: ['girl', 'boy', 'hijab', 'kopiah'].includes(m.av) ? m.av : 'girl', subs: [] }).subs.push(x.name); }));
  const names = {};
  for (const u in (R.members || {})) names[u] = (R.members[u].name || '');
  return {
    no, name: first.name || '', pid,
    raw: { cfg: { main: cfg }, students, assignments, items, asg: cut(R.asg || {}, assignments, true), sc: cut(R.sc || {}, items, false), att, conduct },
    names, teachers: Object.values(tmap), gradesOpen: !!(cfg.settings && cfg.settings.parentGrades)
  };
}
