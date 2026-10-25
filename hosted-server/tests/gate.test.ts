import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createGate, fakeGithub, parseAllowed, sign, verify, type Github } from '../src/gate';

describe('the allow list', () => {
  it('reads usernames however they are separated, ignoring case and @', () => {
    expect([...parseAllowed('DannyBattison, @Other_User;third\nfourth')].sort()).toEqual(['dannybattison', 'fourth', 'other_user', 'third']);
  });
  it('is empty when nothing is set, so nobody gets in by default', () => {
    expect(parseAllowed(undefined).size).toBe(0);
    expect(parseAllowed('  , ;').size).toBe(0);
  });
});

describe('the sign-in cookie', () => {
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

async function boot(login: string, allowed: string, github: Github = fakeGithub(login)) {
  const gate = createGate({ allowed: parseAllowed(allowed), secret: 'test-secret-test-secret', github });
  server = createServer(async (req, res) => { if (!(await gate.handle(req, res))) { res.writeHead(200); res.end('page'); } });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown = {}, cookie?: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const signIn = async () => {
    const start: any = await (await post('/auth/device/start')).json();
    await new Promise((r) => setTimeout(r, 1100)); // the fake asks to be polled no more than once a second
    const res = await post('/auth/device/poll', { ticket: start.ticket });
    return { json: (await res.json()) as any, cookie: res.headers.get('set-cookie')?.split(';')[0] };
  };
  return { gate, base, post, signIn };
}

describe('signing in', () => {
  it('lets a username on the list in, and then knows who they are', async () => {
    const { base, signIn } = await boot('DannyBattison', 'dannybattison');
    expect((await fetch(base + '/auth/me')).status).toBe(401);
    const r = await signIn();
    expect(r.json).toMatchObject({ status: 'ok', login: 'DannyBattison' });
    const me = await fetch(base + '/auth/me', { headers: { cookie: r.cookie! } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ login: 'DannyBattison' });
  });

  it('gives a cookie that the browser cannot read or send from another site', async () => {
    const { post } = await boot('danny', 'danny');
    const start: any = await (await post('/auth/device/start')).json();
    await new Promise((r) => setTimeout(r, 1100));
    const res = await post('/auth/device/poll', { ticket: start.ticket });
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
  });

  it('turns away a GitHub user who is not on the list, and gives them no cookie', async () => {
    const { base, signIn } = await boot('stranger', 'danny');
    const r = await signIn();
    expect(r.json).toEqual({ status: 'forbidden', login: 'stranger' });
    expect(r.cookie).toBeUndefined();
    expect((await fetch(base + '/auth/me')).status).toBe(401);
  });

  it('stops honouring a cookie once the username is taken off the list', async () => {
    const first = await boot('danny', 'danny,someone');
    const r = await first.signIn();
    const cookie = r.cookie!;
    expect((await fetch(first.base + '/auth/me', { headers: { cookie } })).status).toBe(200);
    await new Promise<void>((done) => server!.close(() => done()));
    const second = await boot('danny', 'someone'); // same secret, shorter list
    expect((await fetch(second.base + '/auth/me', { headers: { cookie } })).status).toBe(401);
  });

  it('rejects a tampered cookie', async () => {
    const { base, signIn } = await boot('danny', 'danny');
    const r = await signIn();
    expect((await fetch(base + '/auth/me', { headers: { cookie: r.cookie!.slice(0, -4) + 'AAAA' } })).status).toBe(401);
  });

  it('signs out', async () => {
    const { post } = await boot('danny', 'danny');
    const res = await post('/auth/logout');
    expect(res.headers.get('set-cookie')).toMatch(/Max-Age=0/);
  });

  it('limits how fast one address can start sign-ins', async () => {
    const { post } = await boot('danny', 'danny');
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await post('/auth/device/start')).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(10);
    expect(codes.filter((c) => c === 429)).toHaveLength(2);
  });

  it('leaves every other path to the caller', async () => {
    const { base } = await boot('danny', 'danny');
    expect(await (await fetch(base + '/anything')).text()).toBe('page');
  });
});
