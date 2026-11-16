/* ฟีเจอร์เสริมของครู/ผู้ปกครอง: กระดานประกวดผลงาน · สรุปการประชุม · ติดตามนักเรียนกลุ่มเสี่ยง
   POST /api/extra { idToken | pt, op, ... }
   ประกวด (ครูและผู้ปกครองอ่านได้ · ผู้ปกครองโหวตได้ · ครูสร้าง/ลงผลงาน/ลบหลังหมดเขต)
     c_list · c_new {title,desc,end} · c_img {data} → {id} · c_add {cid,title,who,imgs[]} · c_vote {cid,eid}
     c_delentry {cid,eid} · c_del {cid}
   สรุปประชุม (ครูทุกคนอ่านได้ · แก้/ลบได้เฉพาะคนสร้างหรือผู้ดูแล)  m_list · m_save {m} · m_del {id}
   ติดตามนักเรียน  r_get · r_set {sid,st,note} */
import { json, verify, clip } from '../lib/common.mjs';
import { checkPtWhy, PT_MSG } from '../lib/parent-data.mjs';
import { getStore } from '@netlify/blobs';
import { randomBytes } from 'node:crypto';

const rid = () => Date.now().toString(36) + randomBytes(4).toString('hex');
const OKID = /^[a-z0-9]{6,24}$/, CIMG = /^\d{13}-[a-f0-9]{32}$/;
const dstr = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const tstr = (v) => (/^\d{2}:\d{2}$/.test(String(v || '')) ? String(v) : '');
const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  let me;
  if (b.pt) {
    const w = checkPtWhy(b.pt); if (!w.no) return json({ error: PT_MSG[w.why] || PT_MSG.nolink, expired: true }, 401);
    me = { parent: true, key: 'p-' + w.no, pv: !!w.pv, name: 'ผปค ' + w.no };
  } else {
    const u = await verify(b.idToken); if (!u || !['admin', 'teacher'].includes(u.role)) return json({ error: 'unauthorized' }, 401);
    me = { parent: false, key: 't-' + u.uid, uid: u.uid, admin: u.role === 'admin', name: clip(u.name || 'ครู', 60) };
  }
  const op = String(b.op || '');
  /* ---------- กระดานประกวด ---------- */
  if (op.startsWith('c_')) {
    const cs = getStore('contest'), is = getStore('contestimg');
    const view = (c) => {
      const closed = Date.now() > c.end, cnt = {}; Object.values(c.votes || {}).forEach((e) => { cnt[e] = (cnt[e] || 0) + 1; });
      const show = !me.parent || closed, total = Object.keys(c.votes || {}).length;
      return { id: c.id, title: c.title, desc: c.desc, end: c.end, at: c.at, byName: c.byName, closed, total: show ? total : undefined, mine: me.parent ? (c.votes || {})[me.key] || '' : undefined,
        canDel: !me.parent && (me.admin || c.by === me.uid) && closed, own: !me.parent && (me.admin || c.by === me.uid),
        entries: c.entries.map((e) => ({ id: e.id, title: e.title, who: e.who, imgs: e.imgs, at: e.at, n: show ? (cnt[e.id] || 0) : undefined })) };
    };
    const load = async (cid) => (OKID.test(String(cid || '')) ? cs.get('c/' + cid, { type: 'json' }).catch(() => null) : null);
    const dropImgs = (imgs) => Promise.all(imgs.filter((i) => CIMG.test(i)).map((i) => is.delete(i).catch(() => {})));
    if (op === 'c_list') {
      const { blobs } = await cs.list({ prefix: 'c/' });
      const all = (await Promise.all(blobs.slice(0, 100).map(({ key }) => cs.get(key, { type: 'json' }).catch(() => null)))).filter(Boolean).sort((a, c) => c.at - a.at);
      return json({ list: all.map(view), now: Date.now() });
    }
    if (me.parent) {
      if (op !== 'c_vote') return json({ error: 'forbidden' }, 403);
      if (me.pv) return json({ error: 'หน้าจำลอง: โหวตไม่ได้น้า' }, 403);
      const c = await load(b.cid); if (!c) return json({ error: 'ไม่พบการประกวดนี้' }, 404);
      if (Date.now() > c.end) return json({ error: 'หมดเขตโหวตแล้วน้า' }, 400);
      const eid = String(b.eid || ''); if (!c.entries.some((e) => e.id === eid)) return json({ error: 'ไม่พบผลงานนี้' }, 404);
      c.votes = c.votes || {}; if (c.votes[me.key] === eid) delete c.votes[me.key]; else c.votes[me.key] = eid;
      await cs.setJSON('c/' + c.id, c); return json({ c: view(c) });
    }
    if (op === 'c_new') {
      const title = clip(String(b.title || '').trim(), 80); if (!title) return json({ error: 'ตั้งชื่อการประกวดก่อนน้า' }, 400);
      const end = +b.end; if (!(end > Date.now() + 60000) || end > Date.now() + 366 * 86400e3) return json({ error: 'วันหมดเขตต้องเป็นอนาคตน้า' }, 400);
      const c = { id: rid(), title, desc: clip(String(b.desc || '').trim(), 400), end, at: Date.now(), by: me.uid, byName: me.name, entries: [], votes: {} };
      await cs.setJSON('c/' + c.id, c); return json({ c: view(c) });
    }
    if (op === 'c_img') {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(b.data || '')); if (!m || m[1].length > 420000) return json({ error: 'รูปไม่ถูกต้องหรือใหญ่เกินไป' }, 400);
      const buf = Buffer.from(m[1], 'base64'); if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return json({ error: 'รูปไม่ถูกต้อง' }, 400);
      const id = Date.now() + '-' + randomBytes(16).toString('hex');
      await is.set(id, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); return json({ id });
    }
    const c = await load(b.cid); if (!c) return json({ error: 'ไม่พบการประกวดนี้' }, 404);
    if (op === 'c_add') {
      if (Date.now() > c.end) return json({ error: 'หมดเขตแล้ว เพิ่มผลงานไม่ได้น้า' }, 400);
      const imgs = arr(b.imgs, 6).map(String).filter((i) => CIMG.test(i)); if (!imgs.length) return json({ error: 'แนบรูปอย่างน้อย 1 รูปน้า' }, 400);
      if (c.entries.length >= 60) return json({ error: 'ผลงานเต็มแล้ว (60 ชิ้น)' }, 400);
      c.entries.push({ id: rid(), title: clip(String(b.title || '').trim(), 60) || 'ผลงานน่ารัก', who: clip(String(b.who || '').trim(), 40), imgs, at: Date.now(), by: me.uid });
      await cs.setJSON('c/' + c.id, c); return json({ c: view(c) });
    }
    if (!(me.admin || c.by === me.uid)) return json({ error: 'ลบได้เฉพาะคนสร้างการประกวดหรือผู้ดูแลน้า' }, 403);
    if (Date.now() <= c.end) return json({ error: 'ลบได้หลังหมดเขตเท่านั้นน้า' }, 400);
    if (op === 'c_delentry') {
      const e = c.entries.find((x) => x.id === String(b.eid || '')); if (!e) return json({ error: 'ไม่พบผลงาน' }, 404);
      c.entries = c.entries.filter((x) => x !== e); Object.keys(c.votes || {}).forEach((k) => { if (c.votes[k] === e.id) delete c.votes[k]; });
      await cs.setJSON('c/' + c.id, c); await dropImgs(e.imgs); return json({ c: view(c) });
    }
    if (op === 'c_del') { await cs.delete('c/' + c.id).catch(() => {}); await dropImgs([].concat(...c.entries.map((e) => e.imgs))); return json({ ok: 1 }); }
    return json({ error: 'unknown op' }, 400);
  }
  if (me.parent) return json({ error: 'forbidden' }, 403);
  /* ---------- สรุปการประชุม ---------- */
  if (op.startsWith('m_')) {
    const ms = getStore('meet');
    if (op === 'm_list') {
      const { blobs } = await ms.list({ prefix: 'm/' });
      const all = (await Promise.all(blobs.slice(0, 300).map(({ key }) => ms.get(key, { type: 'json' }).catch(() => null)))).filter(Boolean).sort((a, c) => (c.date || '').localeCompare(a.date || '') || c.at - a.at);
      return json({ list: all.map((m) => Object.assign({}, m, { own: me.admin || m.by === me.uid })) });
    }
    if (op === 'm_save') {
      const x = b.m || {}, old = OKID.test(String(x.id || '')) ? await ms.get('m/' + x.id, { type: 'json' }).catch(() => null) : null;
      if (old && !(me.admin || old.by === me.uid)) return json({ error: 'แก้ไขได้เฉพาะคนสร้างหรือผู้ดูแลน้า' }, 403);
      const ag = x.agenda || {}, m = {
        id: old ? old.id : rid(), at: old ? old.at : Date.now(), by: old ? old.by : me.uid, byName: old ? old.byName : me.name, upd: Date.now(),
        title: clip(x.title, 120).trim() || 'การประชุม', no: clip(x.no, 30), date: dstr(x.date), start: tstr(x.start), end: tstr(x.end), place: clip(x.place, 120),
        chair: clip(x.chair, 80), chairPos: clip(x.chairPos, 60), secretary: clip(x.secretary, 80), status: x.status === 'final' ? 'final' : 'draft',
        attendees: arr(x.attendees, 100).map((a) => ({ n: clip(a && a.n, 80), pos: clip(a && a.pos, 60), st: ['p', 'a', 'l'].includes(a && a.st) ? a.st : 'p' })).filter((a) => a.n),
        agenda: { notify: clip(ag.notify, 4000), prev: clip(ag.prev, 2000), follow: clip(ag.follow, 4000), consider: clip(ag.consider, 6000), other: clip(ag.other, 3000) },
        resolutions: arr(x.resolutions, 40).map((r) => clip(r, 600)).filter(Boolean),
        actions: arr(x.actions, 40).map((a) => ({ t: clip(a && a.t, 300), who: clip(a && a.who, 80), due: dstr(a && a.due), done: !!(a && a.done) })).filter((a) => a.t),
        next: clip(x.next, 300), closeAt: tstr(x.closeAt), recorder: clip(x.recorder, 80), checker: clip(x.checker, 80)
      };
      await ms.setJSON('m/' + m.id, m); return json({ m: Object.assign({}, m, { own: true }) });
    }
    if (op === 'm_del') {
      const id = String(b.id || ''); if (!OKID.test(id)) return json({ error: 'bad id' }, 400);
      const m = await ms.get('m/' + id, { type: 'json' }).catch(() => null); if (!m) return json({ ok: 1 });
      if (!(me.admin || m.by === me.uid)) return json({ error: 'ลบได้เฉพาะคนสร้างหรือผู้ดูแลน้า' }, 403);
      await ms.delete('m/' + id); return json({ ok: 1 });
    }
  }
  /* ---------- ติดตามนักเรียน ---------- */
  if (op === 'r_get') return json({ f: (await getStore('risk').get('f', { type: 'json' }).catch(() => null)) || {} });
  if (op === 'r_set') {
    const sid = clip(b.sid, 60); if (!sid) return json({ error: 'bad sid' }, 400);
    const rs = getStore('risk'), f = (await rs.get('f', { type: 'json' }).catch(() => null)) || {};
    const st = ['none', 'following', 'talked', 'resolved'].includes(b.st) ? b.st : 'none';
    if (st === 'none' && !String(b.note || '').trim()) delete f[sid]; else f[sid] = { st, note: clip(String(b.note || '').trim(), 400), at: Date.now(), by: me.name };
    await rs.setJSON('f', f); return json({ f });
  }
  return json({ error: 'unknown op' }, 400);
};
export const config = { path: '/api/extra' };
