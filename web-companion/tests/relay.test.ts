import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/core/dispatch';
import { Tunnel } from '../../src/core/tunnel';
import { createRelay } from '../relay/relay';

/** GitHub, as far as the relay talks to it: a device flow that finishes at once for whoever `who.login` is. */
const who = { login: 'Alice' };
const github = (async (url: string) => {
  const reply = (j: unknown) => ({ ok: true, json: async () => j }) as any;
  if (url.endsWith('/device/code')) return reply({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 1, expires_in: 900 });
  if (url.endsWith('/access_token')) return reply({ access_token: 'tok' });
  return reply({ login: who.login, avatar_url: 'https://avatars.githubusercontent.com/u/1' });
}) as any;

let closers: (() => void)[] = [];
afterEach(() => { closers.forEach((c) => c()); closers = []; who.login = 'Alice'; });

async function start() {
  const pushed: any[] = [];
  const relay = createRelay({ secret: 'x'.repeat(32), webRoot: tmpdir(), dataDir: tmpdir(), githubClientId: 'cid', fetch: github, makePush: () => ({ publicKey: 'k', count: () => 0, subscribe() {}, unsubscribe() {}, notify: async (p: any) => { pushed.push(p); } }) as any });
  await new Promise<void>((r) => relay.server.listen(0, '127.0.0.1', r));
  closers.push(() => relay.close());
  const host = `127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
  return { relay, host, pushed };
}

/** A browser: signs in with GitHub and keeps its cookies. */
function browser(host: string) {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const call = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const r = await fetch(`http://${host}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie() }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const signIn = async () => { const s = await call('/auth/device/start', {}); return call('/auth/device/poll', { ticket: s.json.ticket }); };
  const socket = (origin = `http://${host}`) => new Promise<{ ws: WebSocket; msgs: any[]; closed: Promise<number> }>((resolve) => {
    const ws = new WebSocket(`ws://${host}/ws`, { headers: { Cookie: cookie(), Origin: origin } });
    const msgs: any[] = [];
    const closed = new Promise<number>((r) => { ws.on('close', (c) => r(c)); ws.on('unexpected-response', () => r(403)); ws.on('error', () => undefined); });
    ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, msgs, closed }));
    ws.on('unexpected-response', () => resolve({ ws, msgs, closed }));
  });
  return { call, signIn, socket };
}

/** The desktop app's side: the real Tunnel, with a stub store and API. */
async function desktop(host: string, login = 'Alice', api: Record<string, unknown> = {}) {
  const store: any = { data: { settings: { tunnelEnabled: true, tunnelUrl: `http://${host}` }, user: { login } } };
  const changes = vi.fn();
  const t = new Tunnel(store, (n, a) => dispatch(api, n, a), changes, () => ({ dataDir: mkdtempSync(join(tmpdir(), 'helm-tunnel-')) }));
  closers.push(() => t.shutdown());
  t.apply();
  await vi.waitFor(() => expect(t.state.state).toBe('ready'), { timeout: 3000 });
  return t;
}

const until = <T>(fn: () => T | undefined | false, ms = 3000) => vi.waitFor(() => { const v = fn(); if (!v) throw new Error('not yet'); return v; }, { timeout: ms });

describe('pairing', () => {
  it('signs a browser in with GitHub and tells it nothing is paired yet', async () => {
    const { host } = await start();
    const b = browser(host);
    expect((await b.call('/auth/me')).status).toBe(401);
    expect((await b.signIn()).json).toMatchObject({ status: 'ok', login: 'Alice' });
    expect((await b.call('/auth/me')).json).toMatchObject({ login: 'alice', paired: false, online: false });
  });

  it('pairs with the code the desktop shows, once, and the desktop makes a new one', async () => {
    const { host } = await start();
    const t = await desktop(host);
    const first = t.state.code!;
    expect(first).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const b = browser(host);
    await b.signIn();
    expect((await b.call('/auth/pair', { code: 'ZZZZ-ZZZZ' })).status).toBe(404);
    expect((await b.call('/auth/pair', { code: first.toLowerCase().replace('-', '') })).status).toBe(200);
    expect((await b.call('/auth/me')).json).toMatchObject({ paired: true, online: true });
    await until(() => t.state.code && t.state.code !== first);
    const other = browser(host);
    await other.signIn();
    expect((await other.call('/auth/pair', { code: first })).status).toBe(404);
  });

  it('will not pair a browser signed in as someone else with this desktop, even with its code', async () => {
    const { host } = await start();
    const t = await desktop(host, 'Alice');
    who.login = 'Mallory';
    const m = browser(host);
    await m.signIn();
    expect((await m.call('/auth/pair', { code: t.state.code })).status).toBe(404);
  });

  it('slows down guessing', async () => {
    const { host } = await start();
    await desktop(host);
    const b = browser(host);
    await b.signIn();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await b.call('/auth/pair', { code: 'AAAA-AAAA' })).status);
    expect(statuses).toContain(429);
  });
});

describe('the tunnel', () => {
  async function paired(api: Record<string, unknown> = {}) {
    const s = await start();
    const t = await desktop(s.host, 'Alice', api);
    const b = browser(s.host);
    await b.signIn();
    await b.call('/auth/pair', { code: t.state.code });
    return { ...s, t, b };
  }

  it('runs a paired browser\'s calls on the desktop and sends back the result, and refuses what belongs to the desktop', async () => {
    const { b } = await paired({ getThing: async (x: number) => ({ x }), openFolder: async () => 'opened', boom: async () => { throw new Error('nope'); } });
    const { ws, msgs } = await b.socket();
    await until(() => msgs.some((m) => m.t === 'ready'));
    const ask = (id: number, name: string, args: unknown[] = []) => ws.send(JSON.stringify({ t: 'call', id, name, args }));
    ask(1, 'getThing', [5]); ask(2, 'openFolder'); ask(3, 'boom'); ask(4, 'constructor');
    const res = (id: number) => until(() => msgs.find((m) => m.t === 'result' && m.id === id));
    expect(await res(1)).toMatchObject({ ok: true, value: { x: 5 } });
    expect(await res(2)).toMatchObject({ ok: false, error: expect.stringContaining('done by the browser') });
    expect(await res(3)).toMatchObject({ ok: false, error: 'nope' });
    expect(await res(4)).toMatchObject({ ok: false });
  });

  it('forwards desktop events to paired browsers and counts them', async () => {
    const { b, t } = await paired();
    const { msgs } = await b.socket();
    await until(() => t.state.clients === 1);
    t.forward('toast', { tone: 'ready', title: 'Hello' });
    expect(await until(() => msgs.find((m) => m.t === 'event' && m.channel === 'toast'))).toMatchObject({ payload: { title: 'Hello' } });
  });

  it('turns a notification into a push for that user, even with no browser open', async () => {
    const { t, pushed } = await paired();
    t.notify({ kind: 'attention', title: 'Needs you', body: 'Approve?', silent: false, sessionId: 's1' });
    expect(await until(() => pushed[0])).toMatchObject({ title: 'Needs you', sessionId: 's1', kind: 'attention' });
  });

  it('does not let an unpaired browser, or one from another site, connect', async () => {
    const { b, host } = await paired();
    const stranger = browser(host);
    await stranger.signIn();
    expect(await (await stranger.socket()).closed).toBe(4404);
    expect(await (await b.socket('https://evil.example')).closed).toBe(403);
  });

  it('closes browsers when the desktop goes away, and signing everyone out ends their access', async () => {
    const { b, t } = await paired();
    const { closed } = await b.socket();
    await until(() => t.state.clients === 1);
    await t.revoke();
    expect(await closed).toBe(4404);
    await until(() => t.state.state === 'ready');
    expect((await b.call('/auth/me')).json).toMatchObject({ paired: true, online: false });
  });
});
