import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { api, shutdown, start } from '../../src/main/core';
import { originAllowed, tokenMatches } from './auth';
import { dispatch } from './dispatch';
import { createHost } from './host';
import { CLOSE_UNAUTHORIZED, type ClientMessage, type ServerMessage } from './protocol';

const TOKEN = process.env.HELM_HOSTED_TOKEN || '';
const PORT = +(process.env.PORT || 8787);
// Loopback unless told otherwise: put TLS in front (a reverse proxy) before exposing this.
const BIND = process.env.HOST || '127.0.0.1';
const WEB = resolve(__dirname, '../dist/web');
const EXTRA_ORIGINS = (process.env.HELM_HOSTED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const AUTH_TIMEOUT_MS = 5000;

if (TOKEN.length < 16) {
  console.error('Set HELM_HOSTED_TOKEN to a secret of at least 16 characters (for example `openssl rand -hex 24`). Anyone holding it can run commands on this machine.');
  process.exit(1);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon'
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://avatars.githubusercontent.com; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'";

const http = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(WEB, rel));
  // The built client is public; everything that matters is behind the WebSocket's token.
  if ((file !== WEB && !file.startsWith(WEB + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
const clients = new Set<WebSocket>();
const out = (ws: WebSocket, m: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

http.on('upgrade', (req, socket, head) => {
  if (new URL(req.url || '/', 'http://x').pathname !== '/ws' || !originAllowed(req.headers.origin, req.headers.host, EXTRA_ORIGINS)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws) => {
  let authed = false;
  const deadline = setTimeout(() => { if (!authed) ws.close(CLOSE_UNAUTHORIZED, 'auth timeout'); }, AUTH_TIMEOUT_MS);
  ws.on('close', () => { clearTimeout(deadline); clients.delete(ws); });
  ws.on('error', () => ws.terminate());
  ws.on('message', async (raw) => {
    let m: ClientMessage;
    try { m = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad message'); }
    if (!authed) {
      if (m.t !== 'auth' || !tokenMatches(m.token, TOKEN)) return ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
      authed = true;
      clearTimeout(deadline);
      clients.add(ws);
      return out(ws, { t: 'ready' });
    }
    if (m.t !== 'call') return;
    try { out(ws, { t: 'result', id: m.id, ok: true, value: (await dispatch(api as any, m.name, m.args)) ?? null }); }
    catch (e: any) { out(ws, { t: 'result', id: m.id, ok: false, error: String(e?.message || e) }); }
  });
});

// Dead connections (a closed laptop) would otherwise stay in `clients` and receive every terminal byte.
setInterval(() => {
  for (const ws of clients) {
    if ((ws as any).__alive === false) { ws.terminate(); continue; }
    (ws as any).__alive = false;
    ws.ping();
  }
}, 30_000);
wss.on('connection', (ws) => { (ws as any).__alive = true; ws.on('pong', () => { (ws as any).__alive = true; }); });

async function main() {
  await start(createHost((channel, payload) => {
    if (!clients.size) return;
    const text = JSON.stringify({ t: 'event', channel, payload } satisfies ServerMessage);
    for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }));
  http.listen(PORT, BIND, () => console.log(`helm hosted on http://${BIND}:${PORT}${existsSync(WEB) ? '' : '  (no web client yet: run `npm run build` in hosted-server)'}`));
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
