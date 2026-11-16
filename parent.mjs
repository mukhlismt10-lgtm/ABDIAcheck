/* หน้าผู้ปกครอง (ดูอย่างเดียว) + ข้อความถึงครูสามัญ + กระดานแจ้งผู้ปกครอง
   POST /api/parent { pt, op }
     op 'data'            ข้อมูลการเรียนของลูก + จำนวนข้อความใหม่จากครูแต่ละท่าน
     op 'pres' { ids }    ครูออนไลน์อยู่ไหม (อายุ heartbeat ล่าสุดเป็น ms)
     op 'unread'          จำนวนข้อความใหม่ + เวลาประกาศล่าสุดบนกระดาน (เบา ใช้โพลล์)
     op 'thread' { to }   อ่านข้อความกับครู to (uid) แล้วล้างตัวนับฝั่งผู้ปกครอง
     op 'send' { to, text?, img? }  ส่งข้อความ/รูป (รูปเป็น data URL JPEG หมดอายุใน 24 ชม.) ถึงครู (แจ้งเตือนเครื่องครูทันที)
     op 'board'           อ่านประกาศบนกระดาน
     (op 'data' จะจดว่าผู้ปกครองเข้ามาแล้ว ลง store `pjoin` ให้ครูค้นหาได้)
     op 'act' { to, act, id, text?, emoji? }  แก้ไข/ยกเลิกส่ง/ลบฝั่งตัวเอง/รีแอคชันข้อความ
     op 'brx' { id, emoji } / 'bcm' { id, text } / 'bcdel' { id, cid }  รีแอคชัน/ความคิดเห็นบนกระดาน */
import { getStore } from '@netlify/blobs';
import { json, initPush, send, allSubs, clip, after } from '../lib/common.mjs';
import { checkPtWhy, PT_MSG, studentData } from '../lib/parent-data.mjs';
import { viewMsgs, applyAct, newMsg, replyRef, postsView, postView, boardSocial, mediaOf, mediaIn, hasMedia, okCid, sigOf } from '../lib/chat.mjs';
import { presOf, presBeat } from '../lib/presence.mjs';
import { callInbox } from '../lib/call.mjs';
import { dropFiles } from '../lib/chatimg.mjs';

const key = (tuid, no) => `th/${no}/${tuid}`;
const PAV = ['hijab', 'kopiah'];

export default async (req, ctx) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const who = checkPtWhy(b.pt);
  if (!who.no) return json({ error: PT_MSG[who.why] || PT_MSG.nolink, expired: true, why: who.why }, 401);
  /* ลิงก์หน้าจำลองของครู: อ่านอย่างเดียว ไม่แก้ข้อมูลผู้ปกครอง ไม่ล้างตัวนับข้อความที่ยังไม่อ่าน */
  if (who.pv && ['send', 'act', 'avatar', 'brx', 'bcm', 'bcdel'].includes(b.op)) return json({ error: 'โหมดหน้าจำลอง: ส่งข้อความหรือกดไม่ได้น้า (ผู้ปกครองจริงทำได้)' }, 403);
  const ms = getStore('pmsg');
  const boardOf = async () => (await getStore('board').get('posts', { type: 'json' }).catch(() => null)) || [];
  const unreadOf = async () => {
    const { blobs } = await ms.list({ prefix: `th/${who.no}/` }), u = {};
    const ths = await Promise.all(blobs.slice(0, 40).map(({ key: k }) => ms.get(k, { type: 'json' }).catch(() => null)));
    ths.forEach((th) => { if (th && th.pn) u[th.tuid] = th.pn; });
    if (who.pv && !who.adm) Object.keys(u).forEach((k) => { if (k !== who.tu) delete u[k]; });
    return u;
  };
  if (b.op === 'unread') {
    const [unread, posts] = await Promise.all([unreadOf(), boardOf()]);
    return json({ unread, bl: posts.reduce((m, p) => Math.max(m, p.at || 0), 0), call: who.pv ? null : await callInbox('p-' + who.no) });
  }
  const V = { kind: 'p', key: 'p:' + who.no };
  const myP = 'p-' + who.no;
  if (b.op === 'hb' || b.op === 'bye') { if (!who.pv) await presBeat(myP, b.op === 'bye'); return json({ ok: true }); }
  /* ผู้ปกครองดูสถานะได้เฉพาะครู (ไม่ใช่ผู้ปกครองท่านอื่น) */
  if (b.op === 'pres') return json(await presOf((Array.isArray(b.ids) ? b.ids : []).filter((x) => !/^p-/.test(String(x)))));
  if (b.op === 'board') return json({ posts: postsView(await boardOf(), V) });
  if (['brx', 'bcm', 'bcdel'].includes(b.op)) {
    const bs = getStore('board'), posts = await boardOf(), i = posts.findIndex((p) => p.id === String(b.id || ''));
    if (i < 0) return json({ error: 'ไม่พบประกาศนี้' }, 404);
    let nm = 'ผู้ปกครอง';
    if (b.op !== 'bcdel') { try { const d = await studentData(who.no); if (d && d.name) nm = 'ผปค ' + who.no; } catch (e) { nm = 'ผู้ปกครองเลขที่ ' + who.no; } }
    const r = boardSocial(b.op, posts[i], b, V, nm);
    if (r.error) return json({ error: r.error }, r.status);
    await bs.setJSON('posts', posts);
    return json({ post: postView(posts[i], V) });
  }

  const to = String(b.to || '');
  /* ผู้ปกครองเปลี่ยนรูปโปรไฟล์ (หญิง/ชาย) ให้ครูเห็นทันที */
  if (b.op === 'avatar') {
    const k = key(to, who.no), th = await ms.get(k, { type: 'json' }).catch(() => null);
    if (th && PAV.includes(b.pav)) { th.pav = b.pav; await ms.setJSON(k, th); }
    return json({ ok: true });
  }
  if (b.op === 'act') {
    const k = key(to, who.no), th = await ms.get(k, { type: 'json' }).catch(() => null);
    if (!th) return json({ error: 'ไม่พบบทสนทนา' }, 404);
    const drop = b.act === 'unsend' ? mediaOf(th, b.id) : null;
    const err = applyAct(th, 'p', b); if (err) return json({ error: err }, 400);
    await ms.setJSON(k, th);
    if (drop) await dropFiles(drop);
    return json({ msgs: viewMsgs(th, 'p') });
  }
  /* ข้อความ: ถ้ามีบทสนทนาอยู่แล้ว ไม่ต้องโหลดข้อมูลนักเรียนทั้งระบบอีก (เร็วขึ้นมาก) */
  if (b.op === 'thread' || b.op === 'send') {
    const k = key(to, who.no);
    let th = await ms.get(k, { type: 'json' }).catch(() => null);
    if (b.op === 'thread') {
      if (who.pv && !who.adm && to !== who.tu) return json({ msgs: [], un: 0, hid: 1 });
      const call = who.pv ? null : await callInbox('p-' + who.no);
      if (!th) return json({ msgs: [], call });
      const un = th.pn || 0;
      if (th.pn && !who.pv) { th.pn = 0; th.rp = Date.now(); await ms.setJSON(k, th); } /* rp = เวลาที่ผู้ปกครองอ่านล่าสุด (ครูเห็น "อ่านแล้ว") */
      const msgs = viewMsgs(th, 'p'), rd = th.rt || 0, sig = sigOf(msgs) + ':' + rd;
      if (b.sig && b.sig === sig) return json({ same: 1, sig, call });
      return json({ msgs, rd, sig, un, call });
    }
    const x = clip(String(b.text || '').trim(), 500);
    if (!x && !b.img && !b.st && !b.au) return json({ error: 'ยังไม่ได้พิมพ์ข้อความ' }, 400);
    if (!th) {
      let d;
      try { d = await studentData(who.no); } catch (e) { return json({ error: e.message || 'อ่านข้อมูลไม่ได้' }, 500); }
      if (!d) return json({ error: 'ยังไม่พบนักเรียนรหัส ' + who.no + ' ในแอปเช็คงาน (รหัสนักเรียนต้องตรงกับเลขประจำตัว)' }, 404);
      if (!d.teachers.find((t) => t.id === to)) return json({ error: 'ครูท่านนี้ไม่ได้สอนนักเรียนคนนี้' }, 403);
      th = { no: who.no, sname: d.name, tuid: to, msgs: [], tn: 0, pn: 0 };
    }
    if (PAV.includes(b.pav)) th.pav = b.pav;
    const cid = okCid(b.cid);
    if (cid && th.msgs.some((z) => z.cid === cid)) return json({ msgs: viewMsgs(th, 'p') });
    const now = Date.now();
    if (th.msgs.filter((m) => m.f === 'p' && now - m.at < 3600e3).length >= 30) return json({ error: 'ส่งถี่เกินไป ลองใหม่ภายหลัง' }, 429);
    const md = await mediaIn(b, th, 'p', now); if (md.error) return json({ error: md.error }, md.status || 400);
    th.msgs.push(Object.assign(newMsg('p', x, replyRef(th, b.re), md), { at: now }, cid ? { cid } : {})); th.msgs = th.msgs.slice(-200); th.tn = (th.tn || 0) + 1; th.pn = 0; th.at = now;
    await ms.setJSON(k, th);
    /* แจ้งเตือนครูเบื้องหลัง ไม่ให้ผู้ปกครองต้องรอ */
    const sname = th.sname;
    await after(ctx, (async () => {
      if (!initPush()) return;
      const store = getStore('subs'), subs = (await allSubs(store)).filter((s) => s.rec.uid === to);
      await Promise.all(subs.map((s) => send(store, s.key, s.rec, { title: '💌 คุณครูมีข้อความจากผู้ปกครองน้าา', body: 'ผปค ' + who.no + ': ' + (x ? clip(x, 120) : b.st ? '🌸 ส่งสติ๊กเกอร์' : b.au ? '🎤 ส่งข้อความเสียง' : '📷 ส่งรูปภาพ'), tag: 'pmsg', data: { pmsg: 1 } })));
    })());
    return json({ msgs: viewMsgs(th, 'p') });
  }

  let d;
  try { d = await studentData(who.no); } catch (e) { return json({ error: e.message || 'อ่านข้อมูลไม่ได้' }, 500); }
  if (!d) return json({ error: 'ยังไม่พบนักเรียนรหัส ' + who.no + ' ในแอปเช็คงาน (รหัสนักเรียนต้องตรงกับเลขประจำตัว)' }, 404);
  /* จดว่าผู้ปกครองเลขที่นี้ "เข้ามาแล้ว" (ให้ครูค้นหารายชื่อแล้วทักไปหาได้) · เขียนอย่างมาก 1 ครั้ง/30 นาที · หน้าจำลองของครูไม่นับ */
  if (b.op === 'data' && !who.pv) {
    try {
      const js = getStore('pjoin'), jk = 'j/' + who.no, cur = await js.get(jk, { type: 'json' }).catch(() => null), now = Date.now();
      if (!cur || now - (cur.l || 0) > 1800e3 || cur.sname !== d.name) await js.setJSON(jk, { no: who.no, sname: d.name || '', f: (cur && cur.f) || now, l: now });
    } catch (e) { /* จดไม่ได้ก็ไม่เป็นไร */ }
  }
  if (b.op === 'data') { const [unread, posts] = await Promise.all([unreadOf(), boardOf()]); return json(Object.assign(d, { unread, bl: posts.reduce((m, p) => Math.max(m, p.at || 0), 0) })); }
  return json({ error: 'unknown op' }, 400);
};
export const config = { path: '/api/parent' };
