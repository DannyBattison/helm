import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { originAllowed } from '../../hosted/src/auth';
import { sign, verify } from '../../hosted/src/gate';
import { signInLimiter } from '../../hosted/src/policy';
import { createPush, pushRoute } from '../../hosted/src/push';
import type { Push } from '../../hosted/src/push';
import { serveStatic } from '../../hosted/src/static';

export interface RelayOptions {
  secret: string;
  /** The built companion page. */
  webRoot: string;
  /** Where push subscriptions are kept. */
  dataDir: string;
  /** The GitHub OAuth app used only to learn a username (no permissions are requested). */
  githubClientId: string;
  extraOrigins?: string[];
  secureCookie?: boolean;
  fetch?: typeof fetch;
  /** Replaces web push in tests. */
  makePush?: (login: string) => Push;
}

const ID_COOKIE = 'helm_companion';
const PAIR_COOKIE = 'helm_companion_pair';
const TTL = 30 * 24 * 3600_000;
const CODE_RE = /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/;
const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

interface Desktop { ws: WebSocket; login: string; code: string; codeAt: number; clients: Map<string, WebSocket> }

/**
 * The relay between a browser and a helm desktop app. Both connect out to it. A browser proves who it is with a GitHub sign-in (the relay
 * keeps no token: it learns the username and forgets the rest), then types the single-use code its desktop app shows; the relay only joins a
 * browser to a desktop that is signed in as that same username. After that it carries calls one way and results and events the other,
 * without reading them, except to send a notification on to the phone as a push.
 */
export function createRelay(o: RelayOptions) {
  const doFetch = o.fetch ?? fetch;
  const desktops = new Map<string, Desktop>();
  const tickets = new Map<string, { deviceCode: string; expires: number }>();
  const pushes = new Map<string, Push>();
  const mayStartSignIn = signInLimiter(10);
  const mayGuess = signInLimiter(6);
  const pushFor = (login: string) => {
    let p = pushes.get(login);
    if (!p) pushes.set(login, (p = o.makePush ? o.makePush(login) : createPush(o.dataDir, undefined, undefined, `push-${createHash('sha256').update(login).digest('hex').slice(0, 24)}.json`)));
    return p;
  };

  // ------------------------------------------------------------ cookies
  const cookieOf = (req: IncomingMessage, name: string) => {
    const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  const secure = (req: IncomingMessage) => o.secureCookie ?? req.headers['x-forwarded-proto'] === 'https';
  const set = (req: IncomingMessage, name: string, value: string, ttl = TTL) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(ttl / 1000)}${secure(req) ? '; Secure' : ''}`;
  const clear = (name: string) => `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  const who = (req: IncomingMessage) => verify(o.secret, cookieOf(req, ID_COOKIE));
  /** The pairing cookie names a desktop in the slot a sign-in cookie keeps the avatar in. */
  const paired = (req: IncomingMessage) => {
    const p = verify(o.secret, cookieOf(req, PAIR_COOKIE));
    const me = who(req);
    return p && me && p.login === me.login ? { login: p.login, desktopId: p.avatar } : null;
  };

  const json = (res: ServerResponse, status: number, body: unknown, cookies: string[] = []) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end(JSON.stringify(body));
    return true;
  };
  const body = (req: IncomingMessage): Promise<any> => new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 2000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
  const ip = (req: IncomingMessage) => req.socket.remoteAddress || '?';

  // ------------------------------------------------------------ /auth: GitHub, then the code
  async function auth(req: IncomingMessage, res: ServerResponse, path: string) {
    if (path === '/auth/device/start' && req.method === 'POST') {
      if (!mayStartSignIn(ip(req))) return json(res, 429, { error: 'Too many attempts. Wait a minute.' });
      // No scope: this sign-in reads the public profile and nothing else.
      const r = await doFetch('https://github.com/login/device/code', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: o.githubClientId, scope: '' }) });
      const j: any = await r.json();
      if (!r.ok || !j.device_code) return json(res, 502, { error: j.error_description || 'GitHub did not start the sign-in.' });
      const now = Date.now();
      for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
      const ticket = randomBytes(24).toString('base64url');
      tickets.set(ticket, { deviceCode: j.device_code, expires: now + j.expires_in * 1000 });
      return json(res, 200, { ticket, userCode: j.user_code, verificationUri: j.verification_uri, interval: j.interval, expiresIn: j.expires_in });
    }
    if (path === '/auth/device/poll' && req.method === 'POST') {
      const b = await body(req);
      const t = typeof b.ticket === 'string' ? tickets.get(b.ticket) : undefined;
      if (!t || t.expires < Date.now()) return json(res, 200, { status: 'expired' });
      const r = await doFetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: o.githubClientId, device_code: t.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
      const j: any = await r.json();
      if (j.error === 'authorization_pending' || j.error === 'slow_down') return json(res, 200, { status: 'pending' });
      if (j.error === 'access_denied') { tickets.delete(b.ticket); return json(res, 200, { status: 'denied' }); }
      if (!j.access_token) { tickets.delete(b.ticket); return json(res, 200, { status: 'error' }); }
      tickets.delete(b.ticket);
      const u: any = await (await doFetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${j.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'helm-companion-relay' } })).json();
      if (typeof u?.login !== 'string' || !LOGIN_RE.test(u.login)) return json(res, 200, { status: 'error' });
      const login = u.login.toLowerCase();
      const avatar = typeof u.avatar_url === 'string' && u.avatar_url.startsWith('https://avatars.githubusercontent.com/') ? u.avatar_url : '';
      return json(res, 200, { status: 'ok', login: u.login, avatar }, [set(req, ID_COOKIE, sign(o.secret, login, avatar, TTL))]);
    }
    if (path === '/auth/me' && req.method === 'GET') {
      const me = who(req);
      if (!me) return json(res, 401, { error: 'signed out' });
      const p = paired(req);
      return json(res, 200, { login: me.login, avatar: me.avatar, paired: !!p, online: !!(p && desktops.get(p.desktopId)?.login === p.login) });
    }
    if (path === '/auth/pair' && req.method === 'POST') {
      const me = who(req);
      if (!me) return json(res, 401, { error: 'Sign in with GitHub first.' });
      if (!mayGuess(ip(req)) || !mayGuess('login:' + me.login)) return json(res, 429, { error: 'Too many tries. Wait a minute.' });
      const code = String((await body(req)).code || '').trim().toUpperCase().replace(/^([A-Z0-9]{4})([A-Z0-9]{4})$/, '$1-$2');
      const found = CODE_RE.test(code) ? [...desktops.entries()].find(([, d]) => d.login === me.login && d.code === code && Date.now() - d.codeAt < 10 * 60_000 + 5000) : undefined;
      // The same answer for a wrong code, an old one, and one for somebody else's computer.
      if (!found) return json(res, 404, { error: 'That code is not right, or it has expired. Check the code in helm’s settings.' });
      const [id, d] = found;
      d.code = '';
      d.ws.send(JSON.stringify({ t: 'used' }));
      return json(res, 200, { ok: true }, [set(req, PAIR_COOKIE, sign(o.secret, me.login, id, TTL))]);
    }
    if (path === '/auth/logout' && req.method === 'POST') return json(res, 200, { ok: true }, [clear(ID_COOKIE), clear(PAIR_COOKIE)]);
    return json(res, 404, { error: 'not found' });
  }

  const server: Server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const path = new URL(req.url || '/', 'http://x').pathname;
    try {
      if (path.startsWith('/auth/')) return void (await auth(req, res, path));
      if (await pushRoute(req, res, (r) => { const p = paired(r); return p ? pushFor(p.login) : null; }, (r) => !!paired(r))) return;
      serveStatic(o.webRoot, req, res);
    } catch { if (!res.headersSent) res.writeHead(500).end(); }
  });

  // ------------------------------------------------------------ the desktop side: /tunnel
  const tunnelWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  tunnelWss.on('connection', (ws) => {
    (ws as any).__alive = true;
    ws.on('pong', () => { (ws as any).__alive = true; });
    ws.on('error', () => ws.terminate());
    let mine: { id: string; d: Desktop } | null = null;
    const wait = setTimeout(() => ws.close(4408, 'no hello'), 10_000);
    ws.on('close', () => {
      clearTimeout(wait);
      if (mine && desktops.get(mine.id) === mine.d) { desktops.delete(mine.id); for (const c of mine.d.clients.values()) c.close(4404, 'desktop went away'); }
    });
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!mine) {
        clearTimeout(wait);
        const ok = m?.t === 'hello' && typeof m.login === 'string' && LOGIN_RE.test(m.login) && /^[a-f0-9]{32}$/.test(m.id) && CODE_RE.test(m.code);
        if (!ok) { ws.send(JSON.stringify({ t: 'refused', error: 'Not a valid hello.' })); return ws.close(4400, 'bad hello'); }
        desktops.get(m.id)?.ws.close(4409, 'replaced');
        const d: Desktop = { ws, login: m.login.toLowerCase(), code: m.code, codeAt: Date.now(), clients: new Map() };
        desktops.set(m.id, d);
        mine = { id: m.id, d };
        return ws.send(JSON.stringify({ t: 'ready', clients: 0 }));
      }
      const d = mine.d;
      if (m?.t === 'code' && CODE_RE.test(m.code)) { d.code = m.code; d.codeAt = Date.now(); }
      else if (m?.t === 'result' && typeof m.client === 'string') d.clients.get(m.client)?.send(JSON.stringify({ t: 'result', id: m.id, ok: m.ok, value: m.value, error: m.error }));
      else if (m?.t === 'event' && typeof m.channel === 'string') {
        const text = JSON.stringify({ t: 'event', channel: m.channel, payload: m.payload });
        // A notification also goes to the phone as a push, which is how it arrives with the app closed.
        if (m.channel === 'notify' && m.payload) void pushFor(d.login).notify({ title: String(m.payload.title ?? ''), body: String(m.payload.body ?? ''), sessionId: String(m.payload.sessionId ?? ''), kind: String(m.payload.kind ?? ''), silent: !!m.payload.silent });
        for (const c of d.clients.values()) if (c.readyState === WebSocket.OPEN) c.send(text);
      }
    });
  });

  // ------------------------------------------------------------ the browser side: /ws
  const clientWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  clientWss.on('connection', (ws, req) => {
    (ws as any).__alive = true;
    ws.on('pong', () => { (ws as any).__alive = true; });
    ws.on('error', () => ws.terminate());
    const p = paired(req);
    const d = p ? desktops.get(p.desktopId) : undefined;
    if (!p || !d || d.login !== p.login) return void ws.close(4404, p ? 'desktop offline' : 'not paired');
    const client = randomBytes(8).toString('hex');
    d.clients.set(client, ws);
    const count = () => d.ws.readyState === WebSocket.OPEN && d.ws.send(JSON.stringify({ t: 'clients', n: d.clients.size }));
    count();
    ws.on('close', () => { d.clients.delete(client); count(); });
    ws.on('message', (raw) => {
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return ws.close(1003, 'bad message'); }
      if (m?.t === 'call' && typeof m.name === 'string' && Number.isSafeInteger(m.id) && Array.isArray(m.args) && d.ws.readyState === WebSocket.OPEN) d.ws.send(JSON.stringify({ t: 'call', client, id: m.id, name: m.name, args: m.args }));
    });
    ws.send(JSON.stringify({ t: 'ready' }));
  });

  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url || '/', 'http://x').pathname;
    if (path === '/tunnel') return void tunnelWss.handleUpgrade(req, socket, head, (ws) => tunnelWss.emit('connection', ws, req));
    // A page on another site must not be able to use someone's cookie.
    if (path !== '/ws' || !originAllowed(req.headers.origin, req.headers.host, o.extraOrigins)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit('connection', ws, req));
  });

  // Dead connections (a closed laptop) would otherwise stay in the lists.
  const beat = setInterval(() => {
    for (const w of [tunnelWss, clientWss]) for (const ws of w.clients) {
      if ((ws as any).__alive === false) { ws.terminate(); continue; }
      (ws as any).__alive = false;
      ws.ping();
    }
  }, 30_000);

  return { server, desktops, close() { clearInterval(beat); for (const w of [tunnelWss, clientWss]) for (const ws of w.clients) ws.terminate(); server.close(); } };
}
