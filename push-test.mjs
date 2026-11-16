/* ตรวจระบบแจ้งเตือนของผู้ใช้เอง: เช็คคีย์ VAPID บนเซิร์ฟเวอร์ + ส่งแจ้งเตือนทดสอบไปยังเครื่องของตัวเองทุกเครื่อง แล้วรายงานผลละเอียด
   POST /.netlify/functions/push-test { idToken, clientKey } */
import webpush from 'web-push';
import { getStore } from '@netlify/blobs';
import { json, verify, initPush, allSubs } from '../lib/common.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400); }
  const me = await verify(b.idToken);
  if (!me) return json({ error: 'unauthorized' }, 401);
  const pub = process.env.VAPID_PUBLIC_KEY || '', priv = process.env.VAPID_PRIVATE_KEY || '';
  const out = { keys: { pub: !!pub, priv: !!priv, subject: !!process.env.VAPID_SUBJECT, match: pub && b.clientKey ? pub === b.clientKey : null }, subs: 0, results: [] };
  if (!initPush()) return json(out);
  const mine = (await allSubs(getStore('subs'))).filter((s) => s.rec.uid === me.uid);
  out.subs = mine.length;
  for (const s of mine) {
    let host = ''; try { host = new URL(s.rec.sub.endpoint).host; } catch (e) { /* ignore */ }
    try {
      await webpush.sendNotification(s.rec.sub, JSON.stringify({ title: '🔔 ทดสอบแจ้งเตือน', body: 'ถ้าเห็นข้อความนี้ แปลว่าแจ้งเตือนใช้ได้แล้วน้า', tag: 'ptest' }), { TTL: 600, urgency: 'high' });
      out.results.push({ host, ok: true });
    } catch (e) {
      out.results.push({ host, ok: false, status: e.statusCode || 0, msg: String(e.body || e.message || '').slice(0, 120) });
      if (e.statusCode === 404 || e.statusCode === 410) await getStore('subs').delete(s.key).catch(() => {});
    }
  }
  return json(out);
};
