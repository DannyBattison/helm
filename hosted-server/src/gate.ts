import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The OAuth app helm itself signs in with. Device flow needs no secret, so the same client id works for this gate. */
export const DEFAULT_CLIENT_ID = 'Ov23liTYcKE5lBWCEAAV';

export interface DeviceStart { userCode: string; verificationUri: string; deviceCode: string; interval: number; expiresIn: number }
export type DevicePoll = { status: 'pending' | 'slow_down' | 'denied' | 'expired' } | { status: 'error'; error?: string } | { status: 'ok'; login: string; avatar: string };

/**
 * Who someone is, according to GitHub. Only the identity is asked for (no scopes) and GitHub's token is dropped as soon as the username is known:
 * this gate decides who may open helm, and holds nothing that could reach anyone's code. (helm's own GitHub sign-in, inside the app, is separate.)
 */
export interface Github {
  start(): Promise<DeviceStart>;
  poll(deviceCode: string): Promise<DevicePoll>;
}

export function realGithub(clientId = DEFAULT_CLIENT_ID): Github {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'helm-hosted' };
  return {
    async start() {
      const r = await fetch('https://github.com/login/device/code', { method: 'POST', headers, body: JSON.stringify({ client_id: clientId, scope: '' }) });
      const j: any = await r.json();
      if (!j.device_code) throw new Error(j.error_description || 'GitHub would not start a sign-in');
      return { userCode: j.user_code, verificationUri: j.verification_uri, deviceCode: j.device_code, interval: j.interval || 5, expiresIn: j.expires_in || 900 };
    },
    async poll(deviceCode) {
      const r = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers, body: JSON.stringify({ client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
      const j: any = await r.json();
      if (j.error === 'authorization_pending') return { status: 'pending' };
      if (j.error === 'slow_down') return { status: 'slow_down' };
      if (j.error === 'access_denied') return { status: 'denied' };
      if (j.error === 'expired_token') return { status: 'expired' };
      if (!j.access_token) return { status: 'error', error: j.error_description || j.error || 'GitHub refused' };
      const u = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + j.access_token, Accept: 'application/vnd.github+json', 'User-Agent': 'helm-hosted' } });
      if (!u.ok) return { status: 'error', error: 'Could not read your GitHub profile' };
      const p: any = await u.json();
      return { status: 'ok', login: String(p.login), avatar: String(p.avatar_url || '') };
    }
  };
}

/** For tests: every sign-in succeeds at once, as the given login. */
export function fakeGithub(login: string): Github {
  return {
    async start() { return { userCode: 'TEST-0000', verificationUri: 'https://github.com/login/device', deviceCode: 'dev-' + randomBytes(6).toString('hex'), interval: 1, expiresIn: 600 }; },
    async poll() { return { status: 'ok', login, avatar: '' }; }
  };
}

/** `a, B ,c` → {a, b, c}. GitHub usernames are not case sensitive. */
export function parseAllowed(v: string | undefined): Set<string> {
  return new Set((v || '').split(/[\s,;]+/).map((s) => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
}

// ------------------------------------------------------------------ the sign-in cookie: `payload.signature`, signed with the server secret
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export function sign(secret: string, login: string, avatar: string, ttlMs: number, now = Date.now()): string {
  const payload = b64(JSON.stringify({ l: login, a: avatar, e: now + ttlMs }));
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function verify(secret: string, value: string | undefined, now = Date.now()): { login: string; avatar: string } | null {
  if (!value) return null;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  const want = createHmac('sha256', secret).update(payload).digest();
  let got: Buffer;
  try { got = Buffer.from(mac, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof p.l === 'string' && typeof p.e === 'number' && p.e >= now ? { login: p.l, avatar: typeof p.a === 'string' ? p.a : '' } : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ the gate
const COOKIE = 'helm_hosted';
const SESSION_TTL = 7 * 24 * 3600_000;

export interface GateOptions {
  /** Lower-case GitHub usernames that may open helm. */
  allowed: Set<string>;
  secret: string;
  github: Github;
  /** Set the Secure flag on the cookie. Default: when the proxy says the request was https. */
  secureCookie?: boolean;
}

export function createGate(opts: GateOptions) {
  const tickets = new Map<string, { deviceCode: string; expires: number; interval: number; last: number }>();
  const starts = new Map<string, number[]>();

  const readCookie = (req: IncomingMessage) => {
    const m = /(?:^|;\s*)helm_hosted=([^;]+)/.exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  const allowedLogin = (login: string) => opts.allowed.has(login.toLowerCase());
  const secure = (req: IncomingMessage) => opts.secureCookie ?? req.headers['x-forwarded-proto'] === 'https';

  /** The signed-in person, if the cookie is genuine and their username is still on the list. */
  function identity(req: IncomingMessage): { login: string; avatar: string } | null {
    const who = verify(opts.secret, readCookie(req));
    return who && allowedLogin(who.login) ? who : null;
  }

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<any> => new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 4000) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });

  /** Handles /auth/*. Returns false for any other path, so the caller can serve it. */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url || '/', 'http://x').pathname;
    if (!path.startsWith('/auth/')) return false;

    if (path === '/auth/me' && req.method === 'GET') {
      const who = identity(req);
      who ? json(res, 200, who) : json(res, 401, { error: 'signed out' });
      return true;
    }

    if (path === '/auth/device/start' && req.method === 'POST') {
      // Each start is a request to GitHub, so one address cannot make many.
      const ip = req.socket.remoteAddress || '?';
      const now = Date.now();
      const recent = (starts.get(ip) || []).filter((t) => now - t < 60_000);
      if (recent.length >= 10) { json(res, 429, { error: 'Too many sign-in attempts. Wait a minute.' }); return true; }
      starts.set(ip, [...recent, now]);
      try {
        const d = await opts.github.start();
        const ticket = randomBytes(18).toString('base64url');
        tickets.set(ticket, { deviceCode: d.deviceCode, expires: now + d.expiresIn * 1000, interval: d.interval, last: 0 });
        for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
        json(res, 200, { ticket, userCode: d.userCode, verificationUri: d.verificationUri, interval: d.interval, expiresIn: d.expiresIn });
      } catch (e: any) { json(res, 502, { error: String(e?.message || e) }); }
      return true;
    }

    if (path === '/auth/device/poll' && req.method === 'POST') {
      const b = await readBody(req);
      const t = typeof b.ticket === 'string' ? tickets.get(b.ticket) : undefined;
      if (!t || t.expires < Date.now()) { json(res, 200, { status: 'expired' }); return true; }
      if (Date.now() - t.last < (t.interval - 1) * 1000) { json(res, 200, { status: 'pending' }); return true; }
      t.last = Date.now();
      const r = await opts.github.poll(t.deviceCode).catch((e): DevicePoll => ({ status: 'error', error: String(e?.message || e) }));
      if (r.status === 'slow_down') { json(res, 200, { status: 'pending' }); return true; }
      if (r.status !== 'ok') { json(res, 200, r); return true; }
      tickets.delete(b.ticket);
      // Signed in to GitHub is not the same as allowed in. No cookie unless the username is on the list.
      if (!allowedLogin(r.login)) { json(res, 200, { status: 'forbidden', login: r.login }); return true; }
      const cookie = `${COOKIE}=${encodeURIComponent(sign(opts.secret, r.login, r.avatar, SESSION_TTL))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure(req) ? '; Secure' : ''}`;
      json(res, 200, { status: 'ok', login: r.login }, { 'Set-Cookie': cookie });
      return true;
    }

    if (path === '/auth/logout' && req.method === 'POST') {
      json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
      return true;
    }

    json(res, 404, { error: 'not found' });
    return true;
  }

  return { identity, handle };
}
