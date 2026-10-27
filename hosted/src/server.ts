import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { api, shutdown, start, syncHttp } from '../../src/core/core';
import { originAllowed } from './auth';
import { dispatch } from './dispatch';
import { createGate, parseUser } from './gate';
import { createHost } from './host';
import { callAllowed, signedOutState, signInLimiter } from './policy';
import type { ServerMessage } from './protocol';

const PORT = +(process.env.PORT || 8787);
// Loopback unless told otherwise: put TLS in front (a reverse proxy) before exposing this.
const BIND = process.env.HOST || '127.0.0.1';
const WEB = resolve(__dirname, '../dist/web');
const EXTRA_ORIGINS = (process.env.HELM_HOSTED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Who may open helm: one GitHub username. Nobody is let in by default, so a missing value is a mistake to stop on, not a way to turn the check off.
const parsed = parseUser(process.env.HELM_HOSTED_ALLOWED_USER);
if ('error' in parsed) {
  console.error(parsed.error + ' That person can run commands on this machine.');
  process.exit(1);
}
const ALLOWED = parsed.user;
let SECRET = process.env.HELM_HOSTED_SECRET || '';
if (SECRET.length < 16) {
  if (SECRET) { console.error('HELM_HOSTED_SECRET must be at least 16 characters (for example `openssl rand -hex 32`).'); process.exit(1); }
  SECRET = randomBytes(32).toString('hex');
  console.warn('HELM_HOSTED_SECRET is not set: everyone is signed out whenever this restarts. Set it to keep sign-ins.');
}

const gate = createGate({
  allowed: ALLOWED,
  secret: SECRET,
  secureCookie: process.env.HELM_HOSTED_SECURE_COOKIE ? process.env.HELM_HOSTED_SECURE_COOKIE === '1' : undefined
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'";

const SYNC_BODY_LIMIT = 512 * 1024 * 1024;
const maySyncAttempt = signInLimiter(30);

/** Another helm instance syncing with this one: a bearer key instead of the cookie. Off (and invisible) unless turned on in settings. */
async function syncRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const reply = (status: number, json: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(json)); };
  if (!syncHttp.isOn()) return reply(404, { error: 'Not found' });
  if (!syncHttp.authorised(req.headers.authorization)) {
    // Guessing the key is rate limited per address; a right key is never counted.
    return reply(maySyncAttempt(req.socket.remoteAddress || '?') ? 401 : 429, { error: 'Unauthorised' });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > SYNC_BODY_LIMIT) return reply(413, { error: 'Too large' });
    chunks.push(c as Buffer);
  }
  const r = await syncHttp.handle(req.method || 'GET', new URL(req.url || '/', 'http://x').pathname, Buffer.concat(chunks).toString('utf8'));
  reply(r.status, r.json);
}

const http = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if ((req.url || '').startsWith('/api/sync/')) { await syncRoute(req, res).catch(() => { if (!res.headersSent) res.writeHead(500).end(); }); return; }
  if (await gate.handle(req, res).catch(() => { res.writeHead(500).end(); return true; })) return;
  const url = new URL(req.url || '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(WEB, rel));
  // The built client is public (it has to be, to show the sign-in screen); everything that matters is behind the cookie.
  if ((file !== WEB && !file.startsWith(WEB + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 * 1024 });
/** Signed-in connections: the only ones that receive events. */
const clients = new Set<WebSocket>();
const out = (ws: WebSocket, m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };
const mayStartSignIn = signInLimiter();
const SIGN_IN_PATIENCE_MS = 10 * 60_000;

http.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url || '/', 'http://x').pathname;
  // A page on another site must not be able to use someone's cookie. Whether this page has signed in is decided per message, below.
  if (path !== '/ws' || !originAllowed(req.headers.origin, req.headers.host, EXTRA_ORIGINS)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  (ws as any).__alive = true;
  ws.on('pong', () => { (ws as any).__alive = true; });
  ws.on('error', () => ws.terminate());
  const ip = req.socket.remoteAddress || '?';
  // Signed in already (a valid cookie for a username still on the list), or not yet: then only helm's sign-in screen works.
  let signedIn = !!gate.identity(req);
  let patience: ReturnType<typeof setTimeout> | undefined;
  if (signedIn) clients.add(ws);
  else patience = setTimeout(() => ws.close(4408, 'sign-in timed out'), SIGN_IN_PATIENCE_MS);
  ws.on('close', () => { clearTimeout(patience); clients.delete(ws); });

  const letIn = async (login: string, avatar: string) => {
    signedIn = true;
    clearTimeout(patience);
    clients.add(ws);
    const claim = gate.issueClaim(login, avatar);
    if (claim) out(ws, { t: 'session', claim });
    // The state event that follows a sign-in went to the people already in; this page gets its own copy.
    out(ws, { t: 'event', channel: 'state', payload: await api.getState() });
  };

  ws.on('message', async (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad message'); }
    if (m?.t !== 'call') return;
    const fail = (error: string) => out(ws, { t: 'result', id: m.id, ok: false, error });
    if (!callAllowed(signedIn, m.name)) return fail('Sign in first.');
    if (!signedIn && m.name === 'signInStart' && !mayStartSignIn(ip)) return fail('Too many sign-in attempts. Wait a minute.');
    try {
      const value = (!signedIn && m.name === 'getState') ? signedOutState((await dispatch(api as any, 'getState', [])) as any) : await dispatch(api as any, m.name, m.args);
      out(ws, { t: 'result', id: m.id, ok: true, value: value ?? null });
      // helm's sign-in only succeeds for a username on the list (the core asks `allowLogin` before it keeps anything), so success means let in.
      if (!signedIn && (m.name === 'signInWait' || m.name === 'signInToken') && value && typeof (value as any).login === 'string') await letIn((value as any).login, String((value as any).avatar || ''));
    } catch (e: any) { fail(String(e?.message || e)); }
  });
  out(ws, { t: 'ready' });
});

// Dead connections (a closed laptop) would otherwise stay in `clients` and receive every terminal byte.
setInterval(() => {
  for (const ws of clients) {
    if ((ws as any).__alive === false) { ws.terminate(); continue; }
    (ws as any).__alive = false;
    ws.ping();
  }
}, 30_000);

async function main() {
  await start(createHost((channel, payload) => {
    if (!clients.size) return;
    const text = JSON.stringify({ t: 'event', channel, payload } satisfies ServerMessage);
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }, (login) => login.toLowerCase() === ALLOWED));
  http.listen(PORT, BIND, () => console.log(`helm hosted on http://${BIND}:${PORT} for ${ALLOWED}${existsSync(WEB) ? '' : '  (no web client yet: run `npm run build` in hosted)'}`));
}

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    http.close();
    await shutdown().catch(() => undefined);
    process.exit(0);
  });
}
void main();
