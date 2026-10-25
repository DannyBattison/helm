import { randomBytes } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { api, shutdown, start } from '../../src/main/core';
import { originAllowed } from './auth';
import { dispatch } from './dispatch';
import { createGate, DEFAULT_CLIENT_ID, parseAllowed, realGithub } from './gate';
import { createHost } from './host';
import type { ServerMessage } from './protocol';

const PORT = +(process.env.PORT || 8787);
// Loopback unless told otherwise: put TLS in front (a reverse proxy) before exposing this.
const BIND = process.env.HOST || '127.0.0.1';
const WEB = resolve(__dirname, '../dist/web');
const EXTRA_ORIGINS = (process.env.HELM_HOSTED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

// Who may open helm: GitHub usernames. Nobody is let in by default, so an empty list is a mistake to stop on, not a way to turn the check off.
const ALLOWED = parseAllowed(process.env.HELM_HOSTED_ALLOWED_USERS);
if (!ALLOWED.size) {
  console.error('Set HELM_HOSTED_ALLOWED_USERS to the GitHub username(s) allowed to use this server, comma separated (for example `HELM_HOSTED_ALLOWED_USERS=DannyBattison`). Anyone on the list can run commands on this machine.');
  process.exit(1);
}
let SECRET = process.env.HELM_HOSTED_SECRET || '';
if (SECRET.length < 16) {
  if (SECRET) { console.error('HELM_HOSTED_SECRET must be at least 16 characters (for example `openssl rand -hex 32`).'); process.exit(1); }
  SECRET = randomBytes(32).toString('hex');
  console.warn('HELM_HOSTED_SECRET is not set: everyone is signed out whenever this restarts. Set it to keep sign-ins.');
}

const gate = createGate({
  allowed: ALLOWED,
  secret: SECRET,
  github: realGithub(process.env.GITHUB_CLIENT_ID || DEFAULT_CLIENT_ID),
  secureCookie: process.env.HELM_HOSTED_SECURE_COOKIE ? process.env.HELM_HOSTED_SECURE_COOKIE === '1' : undefined
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'";

const http = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
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

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
const clients = new Set<WebSocket>();
const out = (ws: WebSocket, m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

http.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url || '/', 'http://x').pathname;
  // Both checks happen before the socket opens: a page on another site must not be able to use someone's cookie, and the cookie must be
  // genuine for a username that is (still) on the list.
  if (path !== '/ws' || !originAllowed(req.headers.origin, req.headers.host, EXTRA_ORIGINS)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  if (!gate.identity(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  (ws as any).__alive = true;
  ws.on('pong', () => { (ws as any).__alive = true; });
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => ws.terminate());
  ws.on('message', async (raw) => {
    let m: any;
    try { m = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad message'); }
    if (m?.t !== 'call') return;
    try { out(ws, { t: 'result', id: m.id, ok: true, value: (await dispatch(api as any, m.name, m.args)) ?? null }); }
    catch (e: any) { out(ws, { t: 'result', id: m.id, ok: false, error: String(e?.message || e) }); }
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
  }));
  http.listen(PORT, BIND, () => console.log(`helm hosted on http://${BIND}:${PORT} for ${[...ALLOWED].join(', ')}${existsSync(WEB) ? '' : '  (no web client yet: run `npm run build` in hosted-server)'}`));
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
