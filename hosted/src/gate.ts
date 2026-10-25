import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Remembering who has signed in. The person signs in once, with helm's own GitHub sign-in (the one screen), and the server only lets them
 * through if their username is on the allow list. This turns that into a signed cookie, so reloading the page does not mean signing in again.
 */

/**
 * The one GitHub username allowed in, lower-cased, or an error message. GitHub usernames are not case sensitive, are 1 to 39 letters, digits
 * and single hyphens, and cannot start or end with a hyphen. A list is refused on purpose: this server has one user.
 */
export function parseUser(v: string | undefined): { user: string } | { error: string } {
  const raw = (v || '').trim().replace(/^@/, '');
  if (!raw) return { error: 'Set HELM_HOSTED_ALLOWED_USER to the GitHub username allowed to use this server (for example `HELM_HOSTED_ALLOWED_USER=DannyBattison`).' };
  if (/[\s,;]/.test(raw)) return { error: 'HELM_HOSTED_ALLOWED_USER takes one GitHub username. This server supports a single user.' };
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(raw)) return { error: `"${raw}" is not a valid GitHub username.` };
  return { user: raw.toLowerCase() };
}

// ------------------------------------------------------------------ the cookie: `payload.signature`, signed with the server secret
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
const CLAIM_TTL = 60_000;

export interface GateOptions {
  /** The one GitHub username (lower case) that may open helm. */
  allowed: string;
  secret: string;
  /** Set the Secure flag on the cookie. Default: when the proxy says the request was https. */
  secureCookie?: boolean;
}

export function createGate(opts: GateOptions) {
  // A claim is how a page that just signed in (over the WebSocket, which cannot set cookies) gets its cookie: one use, a minute to spend it.
  const claims = new Map<string, { login: string; avatar: string; expires: number }>();

  const readCookie = (req: IncomingMessage) => {
    const m = /(?:^|;\s*)helm_hosted=([^;]+)/.exec(req.headers.cookie || '');
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  const allowedLogin = (login: string) => login.toLowerCase() === opts.allowed;
  const secure = (req: IncomingMessage) => opts.secureCookie ?? req.headers['x-forwarded-proto'] === 'https';

  /** The signed-in person, if the cookie is genuine and it is for the allowed username. */
  function identity(req: IncomingMessage): { login: string; avatar: string } | null {
    const who = verify(opts.secret, readCookie(req));
    return who && allowedLogin(who.login) ? who : null;
  }

  /** Called when someone has signed in and been let in. Returns what they exchange for a cookie. */
  function issueClaim(login: string, avatar: string): string | null {
    if (!allowedLogin(login)) return null;
    const now = Date.now();
    for (const [k, c] of claims) if (c.expires < now) claims.delete(k);
    const id = randomBytes(24).toString('base64url');
    claims.set(id, { login, avatar, expires: now + CLAIM_TTL });
    return id;
  }

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<any> => new Promise((resolve) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 2000) req.destroy(); });
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

    if (path === '/auth/claim' && req.method === 'POST') {
      const b = await readBody(req);
      const c = typeof b.claim === 'string' ? claims.get(b.claim) : undefined;
      if (!c || c.expires < Date.now() || !allowedLogin(c.login)) { json(res, 401, { error: 'That claim is not valid.' }); return true; }
      claims.delete(b.claim);
      const cookie = `${COOKIE}=${encodeURIComponent(sign(opts.secret, c.login, c.avatar, SESSION_TTL))}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure(req) ? '; Secure' : ''}`;
      json(res, 200, { login: c.login }, { 'Set-Cookie': cookie });
      return true;
    }

    if (path === '/auth/logout' && req.method === 'POST') {
      json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
      return true;
    }

    json(res, 404, { error: 'not found' });
    return true;
  }

  return { identity, issueClaim, handle };
}
