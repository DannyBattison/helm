import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGate, parseUser, sign, verify } from '../src/gate';

describe('the allowed username', () => {
  it('is one GitHub username, lower-cased, with a leading @ and spaces ignored', () => {
    expect(parseUser('DannyBattison')).toEqual({ user: 'dannybattison' });
    expect(parseUser('  @Danny-B  ')).toEqual({ user: 'danny-b' });
  });
  it('is required: nobody gets in by default', () => {
    expect(parseUser(undefined)).toHaveProperty('error');
    expect(parseUser('   ')).toHaveProperty('error');
  });
  it('refuses a list, so nobody assumes more than one person works', () => {
    for (const v of ['a,b', 'a b', 'a;b', 'a, b']) expect(parseUser(v)).toMatchObject({ error: expect.stringMatching(/one GitHub username/) });
  });
  it('refuses what cannot be a GitHub username', () => {
    for (const v of ['-lead', 'trail-', 'dou--ble', 'under_score', 'a'.repeat(40), 'sp\u00e9cial', 'a/b']) expect(parseUser(v)).toHaveProperty('error');
    expect(parseUser('a'.repeat(39))).toEqual({ user: 'a'.repeat(39) });
  });
});

describe('the cookie', () => {
  it('verifies what it signed, and nothing else', () => {
    const v = sign('a-long-enough-secret', 'danny', 'x', 1000, 5_000);
    expect(verify('a-long-enough-secret', v, 5_500)).toEqual({ login: 'danny', avatar: 'x' });
    expect(verify('another-long-secret!!', v, 5_500)).toBeNull();
    expect(verify('a-long-enough-secret', v, 7_000)).toBeNull();
    const [p, m] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ l: 'mallory', a: '', e: 9e15 })).toString('base64url');
    expect(verify('a-long-enough-secret', `${forged}.${m}`, 5_500)).toBeNull();
    expect(verify('a-long-enough-secret', `${p}.`, 5_500)).toBeNull();
    expect(verify('a-long-enough-secret', 'garbage')).toBeNull();
    expect(verify('a-long-enough-secret', undefined)).toBeNull();
  });
});

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

async function boot(allowed: string) {
  const gate = createGate({ allowed, secret: 'test-secret-test-secret' });
  server = createServer(async (req, res) => { if (!(await gate.handle(req, res))) { res.writeHead(200); res.end('page'); } });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  /** What the page does after helm's sign-in succeeds: trade the claim for a cookie. */
  const cookieFor = async (claim: string | null) => {
    const res = await post('/auth/claim', { claim });
    return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0], header: res.headers.get('set-cookie') || '' };
  };
  return { gate, base, post, cookieFor };
}

describe('claims and cookies', () => {
  it('exchanges a claim for a cookie, and the cookie then identifies the person', async () => {
    const { gate, base, cookieFor } = await boot('dannybattison');
    expect((await fetch(base + '/auth/me')).status).toBe(401);
    const claim = gate.issueClaim('DannyBattison', 'https://avatar')!;
    const r = await cookieFor(claim);
    expect(r.status).toBe(200);
    const me = await fetch(base + '/auth/me', { headers: { cookie: r.cookie! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ login: 'DannyBattison' });
  });

  it('gives a cookie that scripts cannot read and other sites cannot send', async () => {
    const { gate, cookieFor } = await boot('danny');
    const r = await cookieFor(gate.issueClaim('danny', '')!);
    expect(r.header).toMatch(/HttpOnly/);
    expect(r.header).toMatch(/SameSite=Strict/);
  });

  it('issues no claim to anyone but the allowed username', async () => {
    const { gate } = await boot('danny');
    expect(gate.issueClaim('stranger', '')).toBeNull();
  });

  it('lets a claim be used once', async () => {
    const { gate, cookieFor } = await boot('danny');
    const claim = gate.issueClaim('danny', '')!;
    expect((await cookieFor(claim)).status).toBe(200);
    expect((await cookieFor(claim)).status).toBe(401);
  });

  it('refuses a claim that was never issued', async () => {
    const { cookieFor } = await boot('danny');
    expect((await cookieFor('made-up')).status).toBe(401);
    expect((await cookieFor(null)).status).toBe(401);
  });

  it('stops honouring a cookie if the server is later set up for someone else', async () => {
    const first = await boot('danny');
    const cookie = (await first.cookieFor(first.gate.issueClaim('danny', '')!)).cookie!;
    expect((await fetch(first.base + '/auth/me', { headers: { cookie } })).status).toBe(200);
    await new Promise<void>((done) => server!.close(() => done()));
    const second = await boot('someone'); // same secret, different allowed user
    expect((await fetch(second.base + '/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('rejects a tampered cookie', async () => {
    const { gate, base, cookieFor } = await boot('danny');
    const cookie = (await cookieFor(gate.issueClaim('danny', '')!)).cookie!;
    expect((await fetch(base + '/auth/me', { headers: { cookie: cookie.slice(0, -4) + 'AAAA' } })).status).toBe(401);
  });

  it('signs out', async () => {
    const { post } = await boot('danny');
    expect((await post('/auth/logout')).headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('leaves every other path to the caller', async () => {
    const { base } = await boot('danny');
    expect(await (await fetch(base + '/anything')).text()).toBe('page');
  });
});
