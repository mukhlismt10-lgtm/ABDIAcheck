/* ตัวช่วยร่วมของห้องแชท (แก้ไข/ลบ/ตอบกลับ/รีแอคชัน) และกระดานประกาศ (รีแอคชัน/ความคิดเห็น)
   party = ฝ่ายที่กำลังกระทำ: 'p' ผู้ปกครอง / 't' ครู (ห้องผู้ปกครอง) หรือ uid ของครู (ห้องแชทระหว่างครู) */
import { clip } from './common.mjs';
import { saveImg, saveAud } from './chatimg.mjs';

export const RX_OK = ['❤️', '👍', '😊', '🤲', '🙏', '😂', '😮', '😢'];
export const BRX_OK = ['🙏', '❤️', '👍', '🥰', '🌷'];
/* รหัสกันส่งซ้ำจากแอพ (ส่งซ้ำเพราะเน็ตหลุดแล้วไม่ซ้ำในห้อง) */
/* ลายนิ้วมือของข้อมูลห้องแชท: แอพส่งมาถามว่า "เปลี่ยนไหม" ถ้าเหมือนเดิมตอบสั้นๆ (ประหยัดเน็ต ทำให้ดึงถี่ๆ แบบเรียลไทม์ได้) */
export const sigOf = (x) => { const s = typeof x === 'string' ? x : JSON.stringify(x); let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + s.length.toString(36); };
export const okCid = (c) => (/^[a-z0-9]{6,24}$/.test(String(c || '')) ? String(c) : '');
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* ข้อความเก่าที่ยังไม่มี id ใช้ id สังเคราะห์จากผู้ส่ง+เวลา (คงที่ทุกครั้ง) */
export const mid = (m) => m.id || (m.f + '_' + m.at);

/* media = { im?, st?, au? } (รับ {id,exp} เดี่ยวๆ แบบเดิมได้ = รูป) */
export function newMsg(f, x, re, media) {
  const m = { id: newId(), f, x, at: Date.now() };
  if (re) m.re = re;
  if (media && media.id && media.exp) media = { im: media };
  if (media) { if (media.im) m.im = media.im; if (media.st) m.st = media.st; if (media.au) m.au = media.au; }
  return m;
}
/* สติ๊กเกอร์: รหัส <รูปการ์ตูน>.<คำ>.<สไตล์> เช่น hijab.3.1 (วาดฝั่งแอพ ไม่ต้องอัปโหลดรูป) */
export const STK = /^(girl|boy|hijab|kopiah)\.\d{1,2}\.\d{1,2}$/;
/* รับสื่อที่แนบมากับข้อความที่ส่ง (รูป/สติ๊กเกอร์/เสียง) คืน { im?, st?, au? } หรือ { error, status } */
export async function mediaIn(b, th, f, now = Date.now()) {
  const out = {};
  if (b.st) { if (!STK.test(String(b.st))) return { error: 'สติ๊กเกอร์ไม่ถูกต้อง', status: 400 }; out.st = String(b.st); }
  if (b.img || b.au) {
    if ((th.msgs || []).filter((m) => m.f === f && (m.im || m.au) && now - m.at < 3600e3).length >= 20) return { error: 'ส่งรูปหรือเสียงถี่เกินไป ลองใหม่ภายหลัง', status: 429 };
  }
  if (b.img) { const r = await saveImg(b.img); if (r.error) return { error: r.error, status: 400 }; out.im = { id: r.id, exp: r.exp }; }
  if (b.au) {
    const r = await saveAud(b.au && b.au.data); if (r.error) return { error: r.error, status: 400 };
    out.au = { id: r.id, exp: r.exp, d: Math.min(300, Math.max(0, Math.round(+(b.au && b.au.d) || 0))) };
  }
  return out;
}
export const hasMedia = (md) => !!(md && (md.im || md.st || md.au));
/* ไฟล์แนบของข้อความ (เรียกก่อน applyAct เพื่อลบไฟล์เมื่อยกเลิกส่ง) */
export const mediaOf = (th, id) => { const m = (th.msgs || []).find((z) => mid(z) === String(id || '')); return m && (m.im || m.au) ? { im: m.im && m.im.id, au: m.au && m.au.id } : null; };
const mediaTxt = (o) => (o.x ? clip(o.x, 80) : o.im ? '📷 รูปภาพ' : o.st ? '🌸 สติ๊กเกอร์' : o.au ? '🎤 ข้อความเสียง' : '');
/* อ้างอิงข้อความที่ตอบกลับ เก็บเฉพาะตัวอย่างสั้นๆ */
export function replyRef(th, reId) {
  if (!reId) return undefined;
  const o = (th.msgs || []).find((z) => mid(z) === String(reId));
  if (!o) return undefined;
  return { id: mid(o), f: o.f, x: o.del ? '' : mediaTxt(o) };
}
/* ข้อความที่ฝ่าย party เห็น (ตัดข้อความที่ "ลบเฉพาะฝั่งฉัน" ออก, ข้อความที่ยกเลิกส่งไม่เปิดเผยเนื้อหา) */
export function viewMsgs(th, party, own = true) {
  const hide = own && th.hide && th.hide[party] ? new Set(th.hide[party]) : null;
  return (th.msgs || []).filter((m) => !(hide && hide.has(mid(m)))).map((m) => {
    const o = { id: mid(m), f: m.f, x: m.del ? '' : m.x, at: m.at };
    if (m.del) o.del = 1;
    if (m.ed) o.ed = m.ed;
    if (m.cid) o.cid = m.cid;
    if (m.im && !m.del) o.im = m.im.exp > Date.now() ? { id: m.im.id, exp: m.im.exp } : { gone: 1 };
    if (m.st && !m.del) o.st = m.st;
    if (m.au && !m.del) o.au = m.au.exp > Date.now() ? { id: m.au.id, exp: m.au.exp, d: m.au.d || 0 } : { gone: 1 };
    if (m.re) o.re = m.re;
    if (m.rx && Object.keys(m.rx).length) o.rx = m.rx;
    return o;
  });
}
/* id รูปของข้อความ (เรียกก่อน applyAct เพื่อลบไฟล์รูปเมื่อยกเลิกส่ง) */
export const imgOf = (th, id) => { const m = (th.msgs || []).find((z) => mid(z) === String(id || '')); return m && m.im ? m.im.id : null; };
export function lastView(th, party, own = true) {
  const v = viewMsgs(th, party, own), l = v[v.length - 1];
  return l ? { x: l.del ? 'ลบข้อความแล้ว' : (l.x || (l.im ? '📷 รูปภาพ' : l.st ? '🌸 สติ๊กเกอร์' : l.au ? '🎤 ข้อความเสียง' : '')), f: l.f, at: l.at } : null;
}
/* แก้ไข / ยกเลิกส่ง / ลบฝั่งตัวเอง / รีแอคชัน — คืนข้อความผิดพลาด หรือ null ถ้าสำเร็จ */
export function applyAct(th, party, b) {
  const id = String(b.id || ''), m = (th.msgs || []).find((z) => mid(z) === id);
  if (!m) return 'ไม่พบข้อความนี้';
  const kind = b.act;
  if (kind === 'hide') {
    th.hide = th.hide || {};
    const a = th.hide[party] || []; if (!a.includes(id)) a.push(id);
    th.hide[party] = a.slice(-400); return null;
  }
  if (m.del) return 'ข้อความนี้ถูกลบแล้ว';
  if (kind === 'react') {
    const e = b.emoji ? String(b.emoji) : '';
    if (e && !RX_OK.includes(e)) return 'อีโมจิไม่ถูกต้อง';
    m.rx = m.rx || {};
    if (!e || m.rx[party] === e) delete m.rx[party]; else m.rx[party] = e;
    if (!Object.keys(m.rx).length) delete m.rx;
    return null;
  }
  if (m.f !== party) return 'ทำได้เฉพาะข้อความของตัวเอง';
  if (kind === 'edit') {
    if (m.im || m.st || m.au) return 'แก้ไขข้อความที่มีรูป สติ๊กเกอร์ หรือเสียงไม่ได้';
    const x = clip(String(b.text || '').trim(), 500); if (!x) return 'ยังไม่ได้พิมพ์ข้อความ';
    if (x !== m.x) { m.x = x; m.ed = Date.now(); }
    if (!m.id) m.id = id; return null;
  }
  if (kind === 'unsend') { m.del = true; m.x = ''; delete m.rx; delete m.im; delete m.st; delete m.au; if (!m.id) m.id = id; return null; }
  return 'unknown act';
}

/* ---------------- กระดาน: รีแอคชัน + ความคิดเห็น ---------------- */
/* viewer = { kind:'p'|'t', key, admin, uid }  key = 'p:<เลขที่>' หรือ 't:<uid>'
   ครูเห็นชื่อทุกคน / ผู้ปกครองเห็นชื่อครู ส่วนผู้ปกครองท่านอื่นแสดงแบบไม่ระบุชื่อ (กันข้อมูลนักเรียนรั่ว) */
export function postView(p, v) {
  const rx = p.rx || {}, counts = {}, who = [];
  for (const k in rx) {
    const r = rx[k], me = k === v.key;
    counts[r.e] = counts[r.e] || { n: 0, mine: false }; counts[r.e].n++; if (me) counts[r.e].mine = true;
    who.push({ e: r.e, r: r.r, me, at: r.at, n: me ? 'คุณ' : (r.r === 't' || v.kind === 't' ? r.n : 'ผู้ปกครองท่านอื่น') });
  }
  who.sort((a, b) => (a.at || 0) - (b.at || 0));
  return {
    id: p.id, title: p.title, x: p.x, at: p.at, by: p.by, byName: p.byName, color: p.color, emoji: p.emoji, pin: !!p.pin, ed: p.ed || undefined,
    rx: counts, who,
    cm: (p.cm || []).map((c) => ({
      id: c.id, r: c.r, x: c.x, at: c.at, mine: c.k === v.key,
      n: c.k === v.key ? 'คุณ' : (c.r === 't' || v.kind === 't' ? c.n : 'ผู้ปกครอง'),
      can: c.k === v.key || (v.kind === 't' && (!!v.admin || p.by === v.uid))
    }))
  };
}
export const postsView = (posts, v) => posts.map((p) => postView(p, v));

/* ทำ op ของกระดานที่เกี่ยวกับรีแอคชัน/ความคิดเห็น คืน { post } หรือ { error, status } */
export function boardSocial(op, p, b, v, who) {
  if (op === 'brx') {
    const e = String(b.emoji || '');
    if (!BRX_OK.includes(e)) return { error: 'อีโมจิไม่ถูกต้อง', status: 400 };
    p.rx = p.rx || {};
    if (p.rx[v.key] && p.rx[v.key].e === e) delete p.rx[v.key];
    else p.rx[v.key] = { e, r: v.kind, n: clip(who, 60), at: Date.now() };
  } else if (op === 'bcm') {
    const x = clip(String(b.text || '').trim(), 300); if (!x) return { error: 'ยังไม่ได้พิมพ์ความคิดเห็น', status: 400 };
    p.cm = p.cm || [];
    const mine = p.cm.filter((c) => c.k === v.key && Date.now() - c.at < 600e3).length;
    if (mine >= 15) return { error: 'ส่งถี่เกินไป ลองใหม่ภายหลัง', status: 429 };
    p.cm.push({ id: newId(), k: v.key, r: v.kind, n: clip(who, 60), x, at: Date.now() });
    p.cm = p.cm.slice(-100);
  } else if (op === 'bcdel') {
    const i = (p.cm || []).findIndex((c) => c.id === String(b.cid || ''));
    if (i < 0) return { error: 'ไม่พบความคิดเห็น', status: 404 };
    const c = p.cm[i];
    if (!(c.k === v.key || (v.kind === 't' && (v.admin || p.by === v.uid)))) return { error: 'ลบได้เฉพาะความคิดเห็นของตัวเอง', status: 403 };
    p.cm.splice(i, 1);
  }
  return { post: p };
}
