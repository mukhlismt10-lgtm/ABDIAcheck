/* กล่องข้อความผู้ปกครองฝั่งครู (ต้องล็อกอินแอปเช็คงาน)
   POST /api/pmsg { idToken, op }
     op 'list'                 รายการบทสนทนาของครูคนนี้ (ผู้ดูแลเห็นทั้งหมด)
     op 'plist'                รายชื่อผู้ปกครองที่เข้ามาในแอพแล้ว (เฉพาะนักเรียนที่ครูสอน · ผู้ดูแลเห็นทุกคน) ไว้ค้นหาแล้วทักไปก่อนได้
     op 'read' { no, tuid? }   อ่านบทสนทนา ล้างตัวนับฝั่งครู (ยังไม่มีห้อง = ห้องว่างพร้อมให้เริ่มแชท)
     op 'reply' { no, text?, img? }   ตอบผู้ปกครอง / เริ่มแชทหาผู้ปกครองที่เข้ามาแล้ว (แนบรูปได้ หมดอายุใน 24 ชม.) → แจ้งเตือนผู้ปกครองในแอประบบอับดียะฮ์
     op 'hb' / 'bye' / 'pres' { ids }  สถานะออนไลน์ของครู
     op 'pview' { no }         ออกลิงก์หน้าจำลองผู้ปกครอง (อ่านอย่างเดียว)
     op 'board'                อ่านกระดานแจ้งผู้ปกครอง
     op 'bedit' { id, title, text, color, emoji }  แก้ไขประกาศ (เจ้าของโพสต์/ผู้ดูแล)
     op 'bpost' { title, text, color, emoji, pin }  โพสต์ประกาศ
     op 'bdel' { id }          ลบประกาศ (เจ้าของโพสต์/ผู้ดูแล)
     op 'bpin' { id, pin }     ปักหมุด/เลิกปักหมุด
     op 'g_list'/'g_new'/'g_read'/'g_send'/'g_act'/'g_edit'/'g_add'/'g_leave'  แชทกลุ่มของครู
     op 'dm_list'              รายการห้องแชทระหว่างครู (ของตัวเองเท่านั้น)
     op 'dm_read' { peer }     อ่านห้องแชทกับครูอีกคน ล้างตัวนับ
     op 'dm_send' { peer, text?, img?, re? } ส่งข้อความ/รูปหาครูอีกคน
     op 'act' { no, act, id, text?, emoji? }      แก้ไข/ยกเลิกส่ง/ลบฝั่งตัวเอง/รีแอคชัน ในห้องผู้ปกครอง
     op 'dm_act' { peer, act, id, text?, emoji? } เช่นเดียวกัน ในห้องแชทระหว่างครู
     op 'brx' { id, emoji } / 'bcm' { id, text } / 'bcdel' { id, cid }  รีแอคชัน/ความคิดเห็นบนกระดาน */
import { getStore } from '@netlify/blobs';
import { json, verify, clip, after, initPush, send, allSubs, subsOf, cfgOf } from '../lib/common.mjs';
import { pingSig, mintPt, PT_MSG, taughtNos, normNo } from '../lib/parent-data.mjs';
import { viewMsgs, lastView, applyAct, newMsg, replyRef, postsView, postView, boardSocial, mediaOf, mediaIn, hasMedia, okCid, sigOf, newId } from '../lib/chat.mjs';
import { presBeat, presOf } from '../lib/presence.mjs';
import { dropFiles } from '../lib/chatimg.mjs';
import { callInbox } from '../lib/call.mjs';

const APP = process.env.ABDIYAH_APP_URL || 'https://abdiyah-app.netlify.app';

export default async (req, ctx) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const me = await verify(b.idToken);
  if (!me || !['admin', 'teacher'].includes(me.role)) return json({ error: 'unauthorized' }, 401);
  const ms = getStore('pmsg'), admin = me.role === 'admin';
  /* ---- สถานะออนไลน์ ---- */
  const myCall = () => callInbox('t-' + me.uid);
  if (b.op === 'hb' || b.op === 'bye') { await presBeat(me.uid, b.op === 'bye'); return json({ ok: true, call: b.op === 'hb' ? await myCall() : null }); }
  if (b.op === 'pres') return json(await presOf(b.ids));
  /* หน้าจำลอง: ออกลิงก์ดูหน้าผู้ปกครองแบบอ่านอย่างเดียว อายุ 3 ชม. (ครูทุกคนดูได้ แต่ครูทั่วไปไม่เห็นแชทของครูท่านอื่น) */
  if (b.op === 'pview') {
    const no = String(b.no || ''); if (!/^\d{1,5}$/.test(no)) return json({ error: 'นักเรียนคนนี้ยังไม่มีรหัสนักเรียน จึงเปิดหน้าจำลองไม่ได้' }, 400);
    const pt = mintPt({ no, e: '', exp: Date.now() + 3 * 3600e3, pv: 1, tu: me.uid, adm: admin ? 1 : 0 });
    if (!pt) return json({ error: PT_MSG.nosecret }, 500);
    return json({ pt });
  }
  /* ---- กระดานแจ้งผู้ปกครอง ---- */
  if (['board', 'bpost', 'bdel', 'bpin', 'bedit', 'brx', 'bcm', 'bcdel'].includes(b.op)) {
    const bs = getStore('board');
    const posts = (await bs.get('posts', { type: 'json' }).catch(() => null)) || [];
    const sorted = (a) => a.slice().sort((p, q) => (q.pin ? 1 : 0) - (p.pin ? 1 : 0) || q.at - p.at);
    const V = { kind: 't', key: 't:' + me.uid, admin, uid: me.uid }, out = (a) => postsView(sorted(a), V);
    if (b.op === 'board') return json({ posts: out(posts), admin });
    if (b.op === 'bpost') {
      const title = clip(String(b.title || '').trim(), 60), x = clip(String(b.text || '').trim(), 1000);
      if (!title && !x) return json({ error: 'ยังไม่ได้พิมพ์ประกาศ' }, 400);
      const COLORS = ['pink', 'peach', 'butter', 'mint', 'sky', 'lav'];
      const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title, x, at: Date.now(), by: me.uid, byName: clip(me.name || 'ครู', 60),
        color: COLORS.includes(b.color) ? b.color : 'pink', emoji: clip(b.emoji || '📌', 8), pin: !!b.pin };
      const next = sorted([p, ...posts]).slice(0, 80);
      await bs.setJSON('posts', next);
      return json({ posts: out(next), admin });
    }
    const i = posts.findIndex((p) => p.id === String(b.id || ''));
    if (i < 0) return json({ error: 'ไม่พบประกาศนี้' }, 404);
    if (['brx', 'bcm', 'bcdel'].includes(b.op)) {
      const r = boardSocial(b.op, posts[i], b, V, me.name || 'ครู');
      if (r.error) return json({ error: r.error }, r.status);
      await bs.setJSON('posts', posts);
      return json({ post: postView(posts[i], V) });
    }
    if (!admin && posts[i].by !== me.uid) return json({ error: 'แก้ไขได้เฉพาะประกาศของตัวเอง' }, 403);
    if (b.op === 'bdel') posts.splice(i, 1);
    else if (b.op === 'bedit') {
      const title = clip(String(b.title || '').trim(), 60), x = clip(String(b.text || '').trim(), 1000);
      if (!title && !x) return json({ error: 'ยังไม่ได้พิมพ์ประกาศ' }, 400);
      const COLORS = ['pink', 'peach', 'butter', 'mint', 'sky', 'lav'], p = posts[i];
      p.title = title; p.x = x; if (COLORS.includes(b.color)) p.color = b.color; p.emoji = clip(b.emoji || p.emoji || '📌', 8); if (typeof b.pin === 'boolean') p.pin = b.pin; p.ed = Date.now();
    } else posts[i].pin = !!b.pin;
    await bs.setJSON('posts', posts);
    return json({ posts: out(posts), admin });
  }
  /* ---- แชทกลุ่ม (สมาชิกคือครู/ผู้ดูแล) : store `grp` key g/<id> ---- */
  if (/^g_/.test(String(b.op))) {
    const gs = getStore('grp'), okU = (u) => /^[A-Za-z0-9_-]{6,128}$/.test(String(u)), PIC = /^(?:[a-z0-9]{2,12}|data:image\/jpeg;base64,[A-Za-z0-9+\/]{200,14000}={0,2})$/;
    const sum = (g) => { const last = g.msgs.length ? lastView(g, me.uid) : null; return { id: g.id, name: g.name, pic: g.pic, n: (g.un && g.un[me.uid]) || 0, last: last ? clip(last.x, 80) : '', lf: last ? last.f : '', at: last ? last.at : g.at, mem: g.mem.length }; };
    if (b.op === 'g_list') {
      const { blobs } = await gs.list({ prefix: 'g/' }), out = [];
      const gl = await Promise.all(blobs.slice(0, 300).map(({ key }) => gs.get(key, { type: 'json' }).catch(() => null)));
      gl.forEach((g) => { if (g && g.mem && g.mem.includes(me.uid)) out.push(sum(g)); });
      out.sort((a, c) => c.at - a.at);
      return json({ list: out, unread: out.reduce((t, x) => t + x.n, 0), call: await myCall() });
    }
    if (b.op === 'g_new') {
      const name = clip(String(b.name || '').trim(), 40); if (!name) return json({ error: 'ตั้งชื่อกลุ่มก่อนน้า' }, 400);
      const mem = Array.from(new Set([me.uid].concat((Array.isArray(b.mem) ? b.mem : []).map(String).filter(okU)))).slice(0, 60);
      if (mem.length < 2) return json({ error: 'เลือกสมาชิกอย่างน้อย 1 คนน้า' }, 400);
      const g = { id: newId(), name, pic: PIC.test(String(b.pic || '')) ? String(b.pic) : 'cloud', by: me.uid, at: Date.now(), mem, msgs: [], un: {}, rd: {} };
      await gs.setJSON('g/' + g.id, g);
      return json({ group: sum(g) });
    }
    const gid = String(b.gid || ''); if (!/^[a-z0-9]{6,24}$/.test(gid)) return json({ error: 'bad gid' }, 400);
    const gk = 'g/' + gid, g = await gs.get(gk, { type: 'json' }).catch(() => null);
    if (!g || !g.mem.includes(me.uid)) return json({ error: 'ไม่พบกลุ่มนี้' }, 404);
    const info = () => ({ name: g.name, pic: g.pic, mem: g.mem, by: g.by });
    if (b.op === 'g_read') {
      const un = (g.un && g.un[me.uid]) || 0;
      if (un) { g.un[me.uid] = 0; g.rd = g.rd || {}; g.rd[me.uid] = Date.now(); await gs.setJSON(gk, g); }
      const msgs = viewMsgs(g, me.uid), rd = g.rd || {}, call = await myCall();
      const sig = sigOf(msgs) + ':' + sigOf(rd) + ':' + sigOf(info());
      if (b.sig && b.sig === sig) return json({ same: 1, sig, call });
      return json({ msgs, rd, sig, un, info: info(), call });
    }
    if (b.op === 'g_act') {
      const drop = b.act === 'unsend' ? mediaOf(g, b.id) : null;
      const err = applyAct(g, me.uid, b); if (err) return json({ error: err }, 400);
      await gs.setJSON(gk, g); if (drop) await dropFiles(drop);
      return json({ msgs: viewMsgs(g, me.uid) });
    }
    if (b.op === 'g_edit') {
      if (b.name != null) { const n = clip(String(b.name).trim(), 40); if (n) g.name = n; }
      if (b.pic != null && PIC.test(String(b.pic))) g.pic = String(b.pic);
      await gs.setJSON(gk, g); return json({ info: info() });
    }
    if (b.op === 'g_add') {
      const add = (Array.isArray(b.mem) ? b.mem : []).map(String).filter(okU);
      g.mem = Array.from(new Set(g.mem.concat(add))).slice(0, 60); await gs.setJSON(gk, g); return json({ info: info() });
    }
    if (b.op === 'g_leave') {
      g.mem = g.mem.filter((u) => u !== me.uid);
      if (!g.mem.length) await gs.delete(gk).catch(() => {}); else await gs.setJSON(gk, g);
      return json({ ok: 1 });
    }
    if (b.op === 'g_send') {
      const x = clip(String(b.text || '').trim(), 500); if (!x && !b.img && !b.st && !b.au) return json({ error: 'ยังไม่ได้พิมพ์ข้อความ' }, 400);
      const cid = okCid(b.cid);
      if (cid && g.msgs.some((z) => z.cid === cid)) return json({ msgs: viewMsgs(g, me.uid) });
      const md = await mediaIn(b, g, me.uid); if (md.error) return json({ error: md.error }, md.status || 400);
      g.msgs.push(Object.assign(newMsg(me.uid, x, replyRef(g, b.re), md), cid ? { cid } : {})); g.msgs = g.msgs.slice(-300);
      g.un = g.un || {}; g.mem.forEach((u) => { if (u !== me.uid) g.un[u] = (g.un[u] || 0) + 1; }); g.un[me.uid] = 0; g.at = Date.now();
      const pushP = (async () => {
        if (!initPush()) return;
        const store = getStore('subs'), subs = (await Promise.all(g.mem.filter((u) => u !== me.uid).map((u) => subsOf(u)))).flat().filter((s) => cfgOf(s.rec).dmOn);
        const payload = { title: '👥 ' + clip(g.name, 30) + ' · ' + clip(me.name || 'ครู', 30), body: x ? clip(x, 120) : b.st ? '🌸 ส่งสติ๊กเกอร์' : b.au ? '🎤 ส่งข้อความเสียง' : '📷 ส่งรูปภาพ', tag: 'g-' + g.id, data: { grp: g.id } };
        await Promise.all(subs.map((s) => send(store, s.key, s.rec, payload)));
      })();
      await gs.setJSON(gk, g);
      await after(ctx, pushP);
      return json({ msgs: viewMsgs(g, me.uid) });
    }
    return json({ error: 'unknown op' }, 400);
  }
  /* ---- แชทระหว่างครู: ห้องละ 2 คน เห็นเฉพาะคู่สนทนา (ผู้ดูแลก็ไม่เห็นห้องของคนอื่น) ---- */
  if (['dm_list', 'dm_read', 'dm_send', 'dm_act'].includes(b.op)) {
    const okId = (u) => /^[A-Za-z0-9_-]{6,128}$/.test(u), dk = (x, y) => 'dm/' + [x, y].sort().join('__');
    if (b.op === 'dm_list') {
      const { blobs } = await ms.list({ prefix: 'dm/' }), out = [];
      for (const { key } of blobs.filter((x) => x.key.includes(me.uid)).slice(-200)) {
        const th = await ms.get(key, { type: 'json' }).catch(() => null);
        if (!th || !th.ids || !th.ids.includes(me.uid) || !th.msgs || !th.msgs.length) continue;
        const last = lastView(th, me.uid); if (!last) continue;
        out.push({ peer: th.ids.find((u) => u !== me.uid), last: clip(last.x, 80), lf: last.f, at: last.at, n: (th.un && th.un[me.uid]) || 0 });
      }
      out.sort((a, c) => c.at - a.at);
      return json({ list: out, unread: out.reduce((s, x) => s + x.n, 0), call: await myCall() });
    }
    const peer = String(b.peer || ''); if (!okId(peer) || peer === me.uid) return json({ error: 'bad peer' }, 400);
    const k = dk(me.uid, peer);
    const th = (await ms.get(k, { type: 'json' }).catch(() => null)) || { ids: [me.uid, peer], msgs: [], un: {} };
    if (b.op === 'dm_read') {
      const un = (th.un && th.un[me.uid]) || 0;
      if (un) { th.un[me.uid] = 0; th.rd = th.rd || {}; th.rd[me.uid] = Date.now(); await ms.setJSON(k, th); } /* rd[uid] = เวลาที่คนนั้นอ่านล่าสุด */
      const msgs = viewMsgs(th, me.uid), rd = (th.rd && th.rd[peer]) || 0, sig = sigOf(msgs) + ':' + rd;
      const call = await myCall();
      if (b.sig && b.sig === sig) return json({ same: 1, sig, call });
      return json({ msgs, rd, sig, un, call });
    }
    if (b.op === 'dm_act') {
      if (!th.msgs.length) return json({ error: 'ไม่พบห้องแชท' }, 404);
      const drop = b.act === 'unsend' ? mediaOf(th, b.id) : null;
      const err = applyAct(th, me.uid, b); if (err) return json({ error: err }, 400);
      await ms.setJSON(k, th);
      if (drop) await dropFiles(drop);
      return json({ msgs: viewMsgs(th, me.uid) });
    }
    const x = clip(String(b.text || '').trim(), 500); if (!x && !b.img && !b.st && !b.au) return json({ error: 'ยังไม่ได้พิมพ์ข้อความ' }, 400);
    const cid = okCid(b.cid);
    if (cid && th.msgs.some((z) => z.cid === cid)) return json({ msgs: viewMsgs(th, me.uid) });
    const md = await mediaIn(b, th, me.uid); if (md.error) return json({ error: md.error }, md.status || 400);
    th.msgs.push(Object.assign(newMsg(me.uid, x, replyRef(th, b.re), md), cid ? { cid } : {})); th.msgs = th.msgs.slice(-300);
    th.un = th.un || {}; th.un[peer] = (th.un[peer] || 0) + 1; th.un[me.uid] = 0; th.at = Date.now();
    /* แจ้งเตือนเข้าเครื่องเพื่อนครูทันที (แม้ปิดแอพ): ส่งพร้อมกับการบันทึก ไม่รอ */
    const pushP = (async () => {
      if (!initPush()) return;
      const store = getStore('subs'), subs = (await subsOf(peer)).filter((s) => cfgOf(s.rec).dmOn);
      const payload = { title: '🌸 ' + clip(me.name || 'เพื่อนครู', 40) + ' ส่งข้อความมาหา', body: x ? clip(x, 120) : b.st ? '🌸 ส่งสติ๊กเกอร์' : b.au ? '🎤 ส่งข้อความเสียง' : '📷 ส่งรูปภาพ', tag: 'dm-' + me.uid, data: { dm: me.uid } };
      await Promise.all(subs.map((s) => send(store, s.key, s.rec, payload)));
    })();
    await ms.setJSON(k, th);
    await after(ctx, pushP);
    return json({ msgs: viewMsgs(th, me.uid) });
  }
  /* รายชื่อผู้ปกครองที่เข้ามาแล้ว ให้ครูค้นหาแล้วเริ่มแชทก่อนได้ */
  if (b.op === 'plist') {
    const [{ blobs }, scope] = await Promise.all([getStore('pjoin').list({ prefix: 'j/' }), admin ? null : taughtNos(me.uid)]);
    const rows = (await Promise.all(blobs.slice(0, 1500).map(({ key }) => getStore('pjoin').get(key, { type: 'json' }).catch(() => null)))).filter(Boolean);
    const out = rows.filter((r) => admin || scope.has(normNo(r.no))).map((r) => ({ no: r.no, sname: r.sname || '', l: r.l || 0 }));
    out.sort((a, c) => String(a.sname).localeCompare(String(c.sname), 'th'));
    return json({ list: out, admin });
  }
  if (b.op === 'list') {
    const { blobs } = await ms.list({ prefix: 'th/' }), out = [];
    for (const { key } of blobs.filter((x) => admin || x.key.endsWith('/' + me.uid)).slice(-400)) {
      const th = await ms.get(key, { type: 'json' }).catch(() => null); if (!th || !th.msgs || !th.msgs.length) continue;
      const last = lastView(th, 't', th.tuid === me.uid); if (!last) continue;
      out.push({ no: th.no, sname: th.sname, tuid: th.tuid, tn: th.tuid === me.uid ? th.tn || 0 : 0, last: clip(last.x, 80), lf: last.f, at: last.at, pav: th.pav || '' });
    }
    out.sort((a, c) => c.at - a.at);
    return json({ list: out, unread: out.reduce((s, x) => s + x.tn, 0), call: await myCall() });
  }
  const no = String(b.no || ''); if (!/^\d{1,5}$/.test(no)) return json({ error: 'bad no' }, 400);
  const tuid = admin && b.tuid ? String(b.tuid) : me.uid, k = `th/${no}/${tuid}`;
  let th = await ms.get(k, { type: 'json' }).catch(() => null);
  /* ยังไม่มีห้อง: ครูเริ่มแชทหาผู้ปกครองที่เข้ามาแล้วได้ (ต้องเป็นครูที่สอนนักเรียนคนนั้น หรือผู้ดูแล) */
  if (!th && tuid === me.uid && ['read', 'reply'].includes(b.op)) {
    const j = await getStore('pjoin').get('j/' + no, { type: 'json' }).catch(() => null);
    if (!j) return json({ error: 'ผู้ปกครองท่านนี้ยังไม่ได้เข้าใช้แอพ จึงยังทักไปไม่ได้' }, 404);
    if (!admin && !(await taughtNos(me.uid)).has(normNo(no))) return json({ error: 'ทักได้เฉพาะผู้ปกครองของนักเรียนที่คุณสอน' }, 403);
    if (b.op === 'read') return json({ msgs: [], rd: 0, sig: '', un: 0, sname: j.sname || '', pav: '', mine: true });
    th = { no, sname: j.sname || '', tuid: me.uid, msgs: [], tn: 0, pn: 0 };
  }
  if (!th) return json({ error: 'ไม่พบบทสนทนา' }, 404);
  if (b.op === 'read') {
    const un = tuid === me.uid ? th.tn || 0 : 0;
    if (un) { th.tn = 0; th.rt = Date.now(); await ms.setJSON(k, th); } /* rt = เวลาที่ครูอ่านล่าสุด (ผู้ปกครองเห็น "อ่านแล้ว") */
    const msgs = viewMsgs(th, 't', tuid === me.uid), rd = th.rp || 0, sig = sigOf(msgs) + ':' + rd;
    const call = await myCall();
    if (b.sig && b.sig === sig) return json({ same: 1, sig, call });
    return json({ msgs, rd, sig, un, sname: th.sname, pav: th.pav || '', mine: tuid === me.uid, call });
  }
  if (b.op === 'act') {
    if (tuid !== me.uid) return json({ error: 'ทำได้เฉพาะข้อความที่ส่งถึงตัวเอง' }, 403);
    const drop = b.act === 'unsend' ? mediaOf(th, b.id) : null;
    const err = applyAct(th, 't', b); if (err) return json({ error: err }, 400);
    await ms.setJSON(k, th);
    if (drop) await dropFiles(drop);
    return json({ msgs: viewMsgs(th, 't') });
  }
  if (b.op === 'reply') {
    if (tuid !== me.uid) return json({ error: 'ตอบได้เฉพาะข้อความที่ส่งถึงตัวเอง' }, 403);
    const x = clip(String(b.text || '').trim(), 500); if (!x && !b.img && !b.st && !b.au) return json({ error: 'ยังไม่ได้พิมพ์ข้อความ' }, 400);
    const cid = okCid(b.cid);
    if (cid && th.msgs.some((z) => z.cid === cid)) return json({ msgs: viewMsgs(th, 't', true) });
    const now = Date.now();
    const md = await mediaIn(b, th, 't', now); if (md.error) return json({ error: md.error }, md.status || 400);
    th.msgs.push(Object.assign(newMsg('t', x, replyRef(th, b.re), md), { at: now }, cid ? { cid } : {})); th.msgs = th.msgs.slice(-200); th.pn = (th.pn || 0) + 1; th.tn = 0; th.at = now;
    await ms.setJSON(k, th);
    await after(ctx, fetch(APP + '/api/samanping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ no, t: now, sig: pingSig(no, now), teacher: me.name || 'ครูสามัญ' }) }).catch((e) => console.log('ping fail', e.message)));
    return json({ msgs: viewMsgs(th, 't') });
  }
  return json({ error: 'unknown op' }, 400);
};
export const config = { path: '/api/pmsg' };
