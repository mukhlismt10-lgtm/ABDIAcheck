/* จับคู่สายโทร WebRTC (เสียง/วิดีโอ 1 ต่อ 1) ทั้งครูและผู้ปกครอง
   POST /api/rtc { idToken | pt, op }
     op 'ice'                            รายการเซิร์ฟเวอร์ STUN/TURN (ตั้ง TURN ได้ด้วย env TURN_URL/TURN_USER/TURN_PASS)
     op 'start' { to:{k:'t',uid}|{k:'p',no}, kind:'a'|'v', offer }   โทรออก → { id }
     op 'inbox'                          มีสายเรียกเข้าไหม
     op 'get' { id }                     (ผู้รับ) ดึง offer
     op 'answer' { id, answer }          (ผู้รับ) รับสาย
     op 'decline' { id }                 (ผู้รับ) ปฏิเสธ
     op 'ice_add' { id, c:[…] }          ส่ง ICE candidate ของฝั่งตัวเอง
     op 'poll' { id, ni }                (ในสาย) สถานะ + answer + ICE ใหม่ของอีกฝั่ง
     op 'end' { id }                     วางสาย */
import { json, verify, clip, initPush, send, subsOf, after } from '../lib/common.mjs';
import { newId } from '../lib/chat.mjs';
import { checkPtWhy, PT_MSG } from '../lib/parent-data.mjs';
import { getStore } from '@netlify/blobs';
import { callStore, callId, CALL_ID, RING_MS } from '../lib/call.mjs';

/* บันทึกประวัติการโทรลงห้องแชทของคู่สนทนา (ครั้งเดียวต่อสาย) · s: done = คุยกันแล้ว (d = วินาที) · dec = ปฏิเสธ · miss = ไม่ได้รับ/ยกเลิก */
async function logCall(st, id, m, r) {
  try {
    if (await st.get('call/' + id + '/l', { type: 'json' }).catch(() => null)) return;
    const now = Date.now();
    await st.setJSON('call/' + id + '/l', { at: now });
    const s = r && r.st === 'ans' ? 'done' : r && r.st === 'dec' ? 'dec' : 'miss';
    const cl = { k: m.kind === 'v' ? 'v' : 'a', s, d: s === 'done' ? Math.max(0, Math.round((now - ((r && r.at) || now)) / 1000)) : 0 };
    const a = String(m.from), c = String(m.to), ms = getStore('pmsg');
    let key, f;
    if (a[0] !== c[0]) {
      const pk = a.startsWith('p-') ? a : c, tk = a.startsWith('t-') ? a : c;
      key = 'th/' + pk.slice(2) + '/' + tk.slice(2); f = a.startsWith('p-') ? 'p' : 't';
    } else { key = 'dm/' + [a.slice(2), c.slice(2)].sort().join('__'); f = a.slice(2); }
    const th = await ms.get(key, { type: 'json' }).catch(() => null); if (!th) return;
    th.msgs = (th.msgs || []).concat([{ id: newId(), f, x: '', at: now, cl }]).slice(-200);
    await ms.setJSON(key, th);
  } catch (e) { console.log('call log fail', String(e)); }
}

const OKID = /^[A-Za-z0-9_-]{6,128}$/;

export default async (req, ctx) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  /* ตัวตนผู้โทร/รับ */
  let me;
  if (b.pt) {
    const w = checkPtWhy(b.pt); if (!w.no) return json({ error: PT_MSG[w.why] || PT_MSG.nolink, expired: true }, 401);
    if (w.pv) return json({ error: 'หน้าจำลอง: โทรไม่ได้น้า' }, 403);
    me = { key: 'p-' + w.no, k: 'p', no: w.no, name: 'ผปค ' + w.no };
  } else {
    const u = await verify(b.idToken); if (!u || !['admin', 'teacher'].includes(u.role)) return json({ error: 'unauthorized' }, 401);
    me = { key: 't-' + u.uid, k: 't', uid: u.uid, name: clip(u.name || 'ครู', 40) };
  }
  const st = callStore();
  if (b.op === 'ice') {
    const ice = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    if (process.env.TURN_URL) ice.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
    return json({ ice, turn: !!process.env.TURN_URL });
  }
  if (b.op === 'inbox') {
    const { callInbox } = await import('../lib/call.mjs');
    return json({ call: await callInbox(me.key) });
  }
  if (b.op === 'start') {
    const to = b.to || {}, kind = b.kind === 'v' ? 'v' : 'a';
    let toKey;
    if (to.k === 't' && OKID.test(String(to.uid || ''))) toKey = 't-' + to.uid;
    else if (to.k === 'p' && /^\d{1,5}$/.test(String(to.no || ''))) toKey = 'p-' + to.no;
    else return json({ error: 'ไม่พบผู้รับสาย' }, 400);
    if (toKey === me.key) return json({ error: 'โทรหาตัวเองไม่ได้น้า' }, 400);
    /* ผู้ปกครอง ↔ ครู ต้องเคยมีห้องแชทกันแล้ว (ผู้ปกครองทักครูก่อน หรือครูทักผู้ปกครองที่เข้าแอพแล้ว) */
    if (me.k !== to.k) {
      const no = me.k === 'p' ? me.no : String(to.no), tu = me.k === 't' ? me.uid : String(to.uid);
      const th = await getStore('pmsg').get(`th/${no}/${tu}`, { type: 'json' }).catch(() => null);
      if (!th) {
        const j = me.k === 't' ? await getStore('pjoin').get('j/' + no, { type: 'json' }).catch(() => null) : null;
        if (!j) return json({ error: me.k === 'p' ? 'ส่งข้อความหาครูท่านนี้สักครั้งก่อน แล้วค่อยโทรได้น้า' : 'ผู้ปกครองท่านนี้ยังไม่ได้เข้าใช้แอพ' }, 403);
      }
    }
    const cur = await st.get('call/in/' + toKey, { type: 'json' }).catch(() => null);
    if (cur && Date.now() - cur.at < RING_MS && !(await st.get('call/' + cur.id + '/e', { type: 'json' }).catch(() => null))) return json({ busy: 1 });
    if (!b.offer || !b.offer.sdp || String(b.offer.sdp).length > 60000) return json({ error: 'ข้อมูลสายไม่ถูกต้อง' }, 400);
    const id = callId(), now = Date.now();
    await st.setJSON('call/' + id + '/m', { id, from: me.key, fk: me.k, name: me.name, to: toKey, kind, offer: { type: 'offer', sdp: String(b.offer.sdp) }, at: now });
    await st.setJSON('call/in/' + toKey, { id, name: me.name, kind, at: now });
    /* ปลุกเครื่องครูที่รับสาย (แจ้งเตือนเด้ง) */
    if (toKey.startsWith('t-')) await after(ctx, (async () => {
      if (!initPush()) return;
      const ps = getStore('subs'), subs = await subsOf(toKey.slice(2));
      await Promise.all(subs.map((s) => send(ps, s.key, s.rec, { title: (kind === 'v' ? '📹 ' : '📞 ') + me.name + ' โทรหาคุณ', body: 'แตะเพื่อรับสาย', tag: 'call-' + id, data: { call: id }, urgent: 1 })));
    })());
    return json({ id });
  }
  const id = String(b.id || ''); if (!CALL_ID.test(id)) return json({ error: 'bad id' }, 400);
  const m = await st.get('call/' + id + '/m', { type: 'json' }).catch(() => null);
  if (!m) return json({ error: 'สายนี้จบไปแล้วน้า', gone: 1 }, 404);
  const side = m.from === me.key ? 'a' : m.to === me.key ? 'b' : '';
  if (!side) return json({ error: 'forbidden' }, 403);
  if (b.op === 'get') {
    if (side !== 'b') return json({ error: 'forbidden' }, 403);
    const e = await st.get('call/' + id + '/e', { type: 'json' }).catch(() => null);
    if (e || Date.now() - m.at > RING_MS + 15000) return json({ error: 'สายนี้จบไปแล้วน้า', gone: 1 }, 410);
    return json({ offer: m.offer, kind: m.kind, name: m.name });
  }
  if (b.op === 'answer') {
    if (side !== 'b' || !b.answer || !b.answer.sdp) return json({ error: 'bad' }, 400);
    await st.setJSON('call/' + id + '/r', { st: 'ans', answer: { type: 'answer', sdp: String(b.answer.sdp) }, at: Date.now() });
    await st.delete('call/in/' + me.key).catch(() => {});
    return json({ ok: 1 });
  }
  if (b.op === 'decline') {
    if (side !== 'b') return json({ error: 'forbidden' }, 403);
    await st.setJSON('call/' + id + '/r', { st: 'dec', at: Date.now() });
    await st.delete('call/in/' + me.key).catch(() => {});
    await logCall(st, id, m, { st: 'dec' });
    return json({ ok: 1 });
  }
  if (b.op === 'ice_add') {
    const k = 'call/' + id + '/c' + side, cur = (await st.get(k, { type: 'json' }).catch(() => null)) || [];
    const add = (Array.isArray(b.c) ? b.c : []).slice(0, 30).map((x) => ({ candidate: String(x.candidate || '').slice(0, 400), sdpMid: x.sdpMid == null ? null : String(x.sdpMid).slice(0, 20), sdpMLineIndex: Number.isInteger(x.sdpMLineIndex) ? x.sdpMLineIndex : null })).filter((x) => x.candidate);
    await st.setJSON(k, cur.concat(add).slice(-80));
    return json({ ok: 1 });
  }
  if (b.op === 'poll') {
    const other = side === 'a' ? 'b' : 'a';
    const [r, e, ci] = await Promise.all([
      st.get('call/' + id + '/r', { type: 'json' }).catch(() => null), st.get('call/' + id + '/e', { type: 'json' }).catch(() => null),
      st.get('call/' + id + '/c' + other, { type: 'json' }).catch(() => null)
    ]);
    const ni = Math.max(0, +b.ni || 0), ice = (ci || []).slice(ni);
    const out = { ni: ni + ice.length, ice, ended: !!e };
    if (side === 'a' && r) { out.st = r.st; if (r.answer) out.answer = r.answer; }
    if (!r && side === 'a' && Date.now() - m.at > RING_MS + 5000) out.noanswer = 1;
    return json(out);
  }
  if (b.op === 'end') {
    const r0 = await st.get('call/' + id + '/r', { type: 'json' }).catch(() => null);
    await st.setJSON('call/' + id + '/e', { at: Date.now(), by: me.key });
    await logCall(st, id, m, r0);
    await st.delete('call/in/' + m.to).catch(() => {});
    return json({ ok: 1 });
  }
  return json({ error: 'unknown op' }, 400);
};
export const config = { path: '/api/rtc' };
