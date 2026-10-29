import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';

/** A browser's push subscription, as `PushManager.subscribe` returns it. */
export interface PushSub { endpoint: string; keys: { p256dh: string; auth: string } }

export interface PushPayload { title: string; body: string; sessionId: string; kind: string; silent?: boolean }

const MAX_SUBS = 20;

/** Only what a push service needs: an https endpoint and two keys. Anything else is turned away. */
export function validSub(s: any): s is PushSub {
  if (!s || typeof s.endpoint !== 'string' || s.endpoint.length > 1000 || !/^https:\/\//.test(s.endpoint)) return false;
  return typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length < 200 && s.keys.auth.length < 100;
}

/**
 * Web Push for phones that have helm installed: the server keeps a VAPID key and the list of subscribed devices in `dataDir`, and sends each
 * notification to all of them, so one arrives with the app closed. The key is made on first use and survives restarts.
 */
export function createPush(dataDir: string, contact = process.env.HELM_HOSTED_PUSH_CONTACT || 'mailto:helm@localhost', send: typeof webpush.sendNotification = webpush.sendNotification) {
  const file = join(dataDir, 'push.json');
  let data: { keys: { publicKey: string; privateKey: string }; subs: PushSub[] };
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { data = { keys: webpush.generateVAPIDKeys(), subs: [] }; }
  const save = () => writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  if (!existsSync(file)) save();
  const options = { vapidDetails: { subject: contact, ...data.keys }, TTL: 60 * 60 };

  return {
    publicKey: data.keys.publicKey,
    count: () => data.subs.length,
    subscribe(sub: PushSub) {
      data.subs = [sub, ...data.subs.filter((s) => s.endpoint !== sub.endpoint)].slice(0, MAX_SUBS);
      save();
    },
    unsubscribe(endpoint: string) {
      const n = data.subs.length;
      data.subs = data.subs.filter((s) => s.endpoint !== endpoint);
      if (data.subs.length !== n) save();
    },
    /** Sends to every device. A device the push service says is gone (404, 410) is forgotten. */
    async notify(p: PushPayload) {
      const body = JSON.stringify({ title: p.title, body: p.body, sessionId: p.sessionId, kind: p.kind, silent: !!p.silent });
      const gone: string[] = [];
      await Promise.all(data.subs.map(async (s) => {
        try { await send(s, body, { ...options, urgency: 'high' }); } catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(s.endpoint); }
      }));
      for (const g of gone) this.unsubscribe(g);
    }
  };
}
export type Push = ReturnType<typeof createPush>;

/**
 * Handles /push/*: `GET key` (the public key a browser subscribes with), `POST subscribe` and `POST unsubscribe`. Only the signed-in person
 * may use them; the cookie is SameSite=Strict, so another site cannot either. Returns false for any other path.
 */
export async function pushRoute(req: IncomingMessage, res: ServerResponse, push: Push, signedIn: (req: IncomingMessage) => boolean): Promise<boolean> {
  const path = new URL(req.url || '/', 'http://x').pathname;
  if (!path.startsWith('/push/')) return false;
  const reply = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body)); return true; };
  if (!signedIn(req)) return reply(401, { error: 'signed out' });
  if (path === '/push/key' && req.method === 'GET') return reply(200, { key: push.publicKey });
  if (req.method !== 'POST' || (path !== '/push/subscribe' && path !== '/push/unsubscribe')) return reply(404, { error: 'not found' });
  let text = '';
  for await (const c of req) { text += c; if (text.length > 4000) return reply(413, { error: 'too large' }); }
  let b: any;
  try { b = JSON.parse(text); } catch { return reply(400, { error: 'bad json' }); }
  if (path === '/push/unsubscribe') { if (typeof b?.endpoint === 'string') push.unsubscribe(b.endpoint); return reply(200, { ok: true }); }
  if (!validSub(b)) return reply(400, { error: 'not a push subscription' });
  push.subscribe({ endpoint: b.endpoint, keys: { p256dh: b.keys.p256dh, auth: b.keys.auth } });
  return reply(200, { ok: true });
}
