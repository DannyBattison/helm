import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { P2P } from '../src/core/p2p/service';
import type { Notice } from '../src/core/p2p/service';
import { NodeUdp } from '../src/core/p2p/udp';
import { join as joinLink } from '../src/shared/p2p/link';
import type { Link } from '../src/shared/p2p/link';
import { generateKeyPair } from '../src/shared/p2p/noise';
import { decodeShareCode } from '../src/shared/p2p/sharecode';

const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const c of closers.splice(0)) await c(); });

const whoIs = async (token: string) => (token === 'alice-token' ? 'Alice' : token === 'mallory-token' ? 'Mallory' : null);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

interface Opts { api?: Record<string, unknown>; settings?: Record<string, unknown>; dir?: string; vault?: Record<string, unknown>; who?: (t: string) => Promise<string | null>; changes?: any[]; mapper?: any }
function desktop(o: Opts = {}) {
  const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1', p2pPortMap: false, ...o.settings } } };
  const dir = o.dir ?? mkdtempSync(join(tmpdir(), 'helm-p2p-state-'));
  const call = async (name: string, args: unknown[]) => { const f = o.api?.[name] as any; if (!f) throw new Error(`Error invoking remote method '${name}': Error: no such call`); return f(...args); };
  const p = new P2P(store, call, () => o.changes?.push(structuredClone(p.state)), () => ({ dataDir: dir, ...o.vault }), o.who ?? whoIs, o.mapper ? () => o.mapper : undefined);
  closers.push(() => p.shutdown());
  return { p, store, dir };
}
const ready = async (p: P2P) => { await vi.waitFor(() => expect(p.state.state === 'ready' && p.state.code).toBeTruthy(), { timeout: 4000 }); return p.state; };
const saved = (p: P2P) => (p as any).saved;

async function phone(code: string, identity = generateKeyPair(), name = 'Test phone', githubToken: string | undefined = 'alice-token') {
  const udp = new NodeUdp(() => undefined);
  await udp.bind(0);
  closers.push(() => udp.close());
  const link = await joinLink({ socket: udp, code, identity, name, githubToken, timeoutMs: 3000 });
  const got: any[] = [];
  link.onMessage((m) => got.push(JSON.parse(new TextDecoder().decode(m))));
  return { identity, link, got, id: hex(identity.publicKey) };
}
const send = (l: Link, o: unknown) => l.send(new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o)));
const notice = (over: Partial<Notice> = {}): Notice => ({ id: 'n' + Math.random(), at: Date.now(), kind: 'ready', title: 'T', body: 'B', silent: false, sessionId: 's', ...over });

describe('state transitions', () => {
  it('goes off -> starting -> ready -> off, with the details of each', async () => {
    const changes: any[] = [];
    const d = desktop({ changes });
    expect(d.p.state).toEqual({ state: 'off', addresses: [], devices: [] });
    d.p.apply();
    expect(d.p.state.state).toBe('starting');
    const st = await ready(d.p);
    expect(st).toMatchObject({ state: 'ready', portMap: { state: 'off' }, addresses: expect.arrayContaining(['127.0.0.1']) });
    expect(st.port).toBeGreaterThan(0);
    expect(decodeShareCode(st.code!).code).toMatchObject({ p: st.port, n: hostname() });
    expect(changes.map((c) => c.state)).toContain('starting');
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    expect(d.p.state).toMatchObject({ state: 'off', addresses: [], code: undefined, port: undefined, nat: undefined, mapped: undefined });
  });

  it('turning it off frees the port again, after a moment', async () => {
    const d = desktop();
    d.p.apply();
    const port = (await ready(d.p)).port!;
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    const probe = new NodeUdp(() => undefined);
    await vi.waitFor(async () => { await probe.bind(port); }, { timeout: 3000 });
    probe.close();
  });

  it('refuses to start without a GitHub user, and does start once there is one', async () => {
    const d = desktop();
    d.store.data.user = undefined;
    d.p.apply();
    expect(d.p.state).toMatchObject({ state: 'error', port: undefined, addresses: [] });
    d.store.data.user = { login: 'alice' };
    d.p.apply();
    await ready(d.p);
    expect(d.p.state.error).toBeUndefined();
  });

  it('a new code replaces the one-time secret, and the code is stable otherwise', async () => {
    const d = desktop();
    d.p.apply();
    const first = (await ready(d.p)).code!;
    d.p.newCode();
    const second = d.p.state.code!;
    expect(second).not.toBe(first);
    expect(decodeShareCode(second).code.s).not.toBe(decodeShareCode(first).code.s);
    (d.p as any).refreshState();
    expect(d.p.state.code).toBe(second);
    expect(decodeShareCode(second).code.k).toBe(decodeShareCode(first).code.k);
  });

  it('newCode and refreshState do nothing when it is not running', () => {
    const d = desktop();
    d.p.newCode();
    expect(d.p.state).toEqual({ state: 'off', addresses: [], devices: [] });
  });
});

describe('enabling and disabling quickly', () => {
  it('apply() twice in a row ends with one running service', async () => {
    const d = desktop();
    d.p.apply(); d.p.apply(); d.p.apply();
    const st = await ready(d.p);
    const again = await ready(d.p);
    expect(again.port).toBe(st.port);
    expect(d.p.state.state).toBe('ready');
  });

  it('switched off while still starting: the socket it opened is closed and the state stays off', async () => {
    const close = vi.spyOn(NodeUdp.prototype, 'close');
    const d = desktop();
    d.p.apply();
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    await vi.waitFor(() => expect(close).toHaveBeenCalled(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    expect(d.p.state.state).toBe('off');
    expect((d.p as any).udp).toBeNull();
    expect((d.p as any).timer).toBeNull();
  });

  it('a start that fails after it was replaced reports nothing', async () => {
    const a = desktop();
    a.p.apply();
    const used = (await ready(a.p)).port!;
    const d = desktop({ settings: { p2pPort: used } });
    d.p.apply();
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    await new Promise((r) => setTimeout(r, 1400)); // longer than the retries for a port that is busy
    expect(d.p.state.state).toBe('off');
    expect(d.p.state.error).toBeUndefined();
  }, 10_000);

  it('restarts onto a new chosen port when the setting changes, keeping the identity', async () => {
    const d = desktop();
    d.p.apply();
    const first = await ready(d.p);
    const probe = new NodeUdp(() => undefined);
    const free = await probe.bind(0);
    probe.close();
    await new Promise((r) => setTimeout(r, 200));
    d.store.data.settings.p2pPort = free;
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.port).toBe(free), { timeout: 4000 });
    await ready(d.p);
    expect(decodeShareCode(d.p.state.code!).code.k).toBe(decodeShareCode(first.code!).code.k);
    // a port chosen in settings is not remembered as the saved one
    expect(saved(d.p).port).toBe(first.port);
  });
});

describe('ports', () => {
  it('falls back to a random port when the saved one is busy, and remembers the new one', async () => {
    const a = desktop();
    a.p.apply();
    const used = (await ready(a.p)).port!;
    const dir = mkdtempSync(join(tmpdir(), 'helm-p2p-state-'));
    writeFileSync(join(dir, 'p2p.bin'), JSON.stringify({ secretKey: hex(generateKeyPair().secretKey), devices: [], port: used }));
    const d = desktop({ dir });
    d.p.apply();
    const st = await vi.waitFor(async () => { const s = await ready(d.p); return s; }, { timeout: 6000 });
    expect(st.port).not.toBe(used);
    expect(st.error).toBeUndefined();
    expect(JSON.parse(readFileSync(join(dir, 'p2p.bin'), 'utf8')).port).toBe(st.port);
  }, 10_000);

  it('uses the saved port when it is free', async () => {
    const probe = new NodeUdp(() => undefined);
    const free = await probe.bind(0);
    probe.close();
    await new Promise((r) => setTimeout(r, 200));
    const dir = mkdtempSync(join(tmpdir(), 'helm-p2p-state-'));
    writeFileSync(join(dir, 'p2p.bin'), JSON.stringify({ secretKey: hex(generateKeyPair().secretKey), devices: [], port: free }));
    const d = desktop({ dir });
    d.p.apply();
    expect((await ready(d.p)).port).toBe(free);
  });

  it('reports a chosen port that is busy, as an error naming it', async () => {
    const a = desktop();
    a.p.apply();
    const used = (await ready(a.p)).port!;
    const d = desktop({ settings: { p2pPort: used } });
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.state).toBe('error'), { timeout: 5000 });
    expect(d.p.state.error).toBe(`Port ${used} is already in use. Choose another in Settings.`);
  }, 10_000);

  it('reports any other bind failure with its own message', async () => {
    vi.spyOn(NodeUdp.prototype, 'bind').mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    const d = desktop({ settings: { p2pPort: 4000 } });
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.state).toBe('error'), { timeout: 5000 });
    expect(d.p.state.error).toBe('permission denied');
  }, 10_000);
});

describe('the identity file', () => {
  it('makes a new identity when p2p.bin is missing, and keeps it afterwards', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const file = JSON.parse(readFileSync(join(d.dir, 'p2p.bin'), 'utf8'));
    expect(file.secretKey).toMatch(/^[0-9a-f]{64}$/);
    expect(file.devices).toEqual([]);
    expect(file.port).toBe(st.port);
  });

  it('makes a new identity when p2p.bin is corrupt, or has no key', async () => {
    for (const content of ['not json at all', '{"devices":[]}', 'null', '']) {
      const dir = mkdtempSync(join(tmpdir(), 'helm-p2p-state-'));
      writeFileSync(join(dir, 'p2p.bin'), content);
      const d = desktop({ dir });
      d.p.apply();
      await ready(d.p);
      expect(JSON.parse(readFileSync(join(dir, 'p2p.bin'), 'utf8')).secretKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('keeps the same key across restarts (the phone knows it from the code)', async () => {
    const d = desktop();
    d.p.apply();
    const k = decodeShareCode((await ready(d.p)).code!).k;
    await d.p.shutdown();
    const again = desktop({ dir: d.dir });
    again.p.apply();
    expect(decodeShareCode((await ready(again.p)).code!).k).toBe(k);
  });

  it('encrypts the file with the vault, and reads it back with the vault', async () => {
    const encrypt = vi.fn((t: string) => Buffer.from(Buffer.from(t).reverse()));
    const decrypt = vi.fn((b: Buffer) => Buffer.from(b).reverse().toString('utf8'));
    const d = desktop({ vault: { encrypt, decrypt } });
    d.p.apply();
    const k = decodeShareCode((await ready(d.p)).code!).k;
    expect(encrypt).toHaveBeenCalled();
    const raw = readFileSync(join(d.dir, 'p2p.bin'));
    expect(() => JSON.parse(raw.toString('utf8'))).toThrow(); // not plain JSON on disk
    expect(JSON.parse(decrypt(raw))).toMatchObject({ devices: [] });
    await d.p.shutdown();
    const again = desktop({ dir: d.dir, vault: { encrypt, decrypt } });
    again.p.apply();
    expect(decodeShareCode((await ready(again.p)).code!).k).toBe(k);
    expect(decrypt).toHaveBeenCalled();
  });

  it('starts over when the vault cannot decrypt what is there', async () => {
    const d = desktop();
    d.p.apply();
    const k = decodeShareCode((await ready(d.p)).code!).k;
    await d.p.shutdown();
    const again = desktop({ dir: d.dir, vault: { encrypt: (t: string) => Buffer.from(t), decrypt: () => { throw new Error('wrong key'); } } });
    again.p.apply();
    expect(decodeShareCode((await ready(again.p)).code!).code.k).not.toBe(k);
  });

  it('writes the file readable by its owner only', async () => {
    const d = desktop();
    d.p.apply();
    await ready(d.p);
    const { statSync } = await import('node:fs');
    if (process.platform !== 'win32') expect(statSync(join(d.dir, 'p2p.bin')).mode & 0o777).toBe(0o600);
  });
});

describe('who may connect', () => {
  const key = () => generateKeyPair().publicKey;
  const auth = (p: P2P, k: Uint8Array, said: object) => (p as any).authorize(k, said) as Promise<{ name: string } | false>;
  const secretOf = (p: P2P) => (p as any).secret.value as string;

  async function started(o: Opts = {}) {
    const d = desktop(o);
    d.p.apply();
    await ready(d.p);
    return d;
  }

  it('refuses everyone when nobody is signed in on this computer, even a known phone', async () => {
    const d = await started();
    const id = generateKeyPair();
    await phone(d.p.state.code!, id);
    d.store.data.user = null;
    expect(await auth(d.p, id.publicKey, {})).toBe(false);
    expect(await auth(d.p, key(), { s: secretOf(d.p), g: 'alice-token' })).toBe(false);
  });

  it('recognises a known phone only while the GitHub user matches, ignoring case', async () => {
    const d = await started();
    const id = generateKeyPair();
    await phone(d.p.state.code!, id, 'Mine');
    expect(saved(d.p).devices[0].login).toBe('alice');
    expect(await auth(d.p, id.publicKey, {})).toEqual({ name: 'Mine' });
    d.store.data.user = { login: 'ALICE' };
    expect(await auth(d.p, id.publicKey, {})).toEqual({ name: 'Mine' });
    d.store.data.user = { login: 'bob' };
    expect(await auth(d.p, id.publicKey, {})).toBe(false);
  });

  it('treats a phone paired before logins were recorded as belonging to whoever is signed in', async () => {
    const d = await started();
    const id = generateKeyPair();
    await phone(d.p.state.code!, id, 'Old');
    delete saved(d.p).devices[0].login;
    d.store.data.user = { login: 'bob' };
    expect(await auth(d.p, id.publicKey, {})).toEqual({ name: 'Old' });
  });

  it('refuses a new phone with no secret, no GitHub token, a wrong, short or long secret, or an old one', async () => {
    const d = await started();
    const good = secretOf(d.p);
    expect(await auth(d.p, key(), { g: 'alice-token' })).toBe(false); // no secret
    expect(await auth(d.p, key(), { s: good })).toBe(false); // no token
    expect(await auth(d.p, key(), {})).toBe(false);
    expect(await auth(d.p, key(), { s: good.slice(1), g: 'alice-token' })).toBe(false); // short
    expect(await auth(d.p, key(), { s: good + 'x', g: 'alice-token' })).toBe(false); // long
    expect(await auth(d.p, key(), { s: (good[0] === 'A' ? 'B' : 'A') + good.slice(1), g: 'alice-token' })).toBe(false); // one character off
    expect(await auth(d.p, key(), { s: good.slice(0, -1) + (good.endsWith('A') ? 'B' : 'A'), g: 'alice-token' })).toBe(false); // last character off
    expect(saved(d.p).devices).toHaveLength(0);
    expect(await auth(d.p, key(), { s: good, g: 'alice-token' })).toEqual({ name: 'Phone' }); // still good: those did not use it up
  });

  it('refuses when there is no secret at all', async () => {
    const d = await started();
    (d.p as any).secret = null;
    expect(await auth(d.p, key(), { s: 'x', g: 'alice-token' })).toBe(false);
  });

  it('refuses a secret after its ten minutes are up, and a new code works', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const d = await started();
    const old = secretOf(d.p);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    expect(await auth(d.p, key(), { s: old, g: 'alice-token' })).toBe(false);
    // the next code made is a fresh secret
    d.p.newCode();
    expect(secretOf(d.p)).not.toBe(old);
    expect(await auth(d.p, key(), { s: secretOf(d.p), g: 'alice-token' })).toEqual({ name: 'Phone' });
  });

  it('makes a new secret when asked for the code after it expired', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const d = await started();
    const old = secretOf(d.p);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1);
    (d.p as any).refreshState();
    expect(secretOf(d.p)).not.toBe(old);
  });

  it('refuses a token that belongs to someone else, is not valid, or whose check fails', async () => {
    const d = await started({ who: async (t) => { if (t === 'boom') throw new Error('offline'); return whoIs(t); } });
    const s = secretOf(d.p);
    expect(await auth(d.p, key(), { s, g: 'mallory-token' })).toBe(false);
    expect(await auth(d.p, key(), { s, g: 'nonsense' })).toBe(false);
    expect(await auth(d.p, key(), { s, g: 'boom' })).toBe(false);
    expect(await auth(d.p, key(), { s, g: 'alice-token' })).toEqual({ name: 'Phone' });
  });

  it('lets only one of two phones using the same secret at once pair', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = await started({ who: async () => { await gate; return 'alice'; } });
    const s = secretOf(d.p);
    const a = auth(d.p, key(), { s, g: 't1', n: 'First' });
    const b = auth(d.p, key(), { s, g: 't2', n: 'Second' });
    release();
    const results = await Promise.all([a, b]);
    expect(results.filter(Boolean)).toEqual([{ name: 'First' }]);
    expect(results[1]).toBe(false);
    expect(saved(d.p).devices.map((x: any) => x.name)).toEqual(['First']);
    expect(secretOf(d.p)).not.toBe(s); // spent: the code now carries a new one
    expect(await auth(d.p, key(), { s, g: 't3' })).toBe(false);
  });

  it('names the phone from what it says, at most 60 characters, "Phone" if it says nothing', async () => {
    const d = await started();
    expect(await auth(d.p, key(), { s: secretOf(d.p), g: 'alice-token', n: 'x'.repeat(100) })).toEqual({ name: 'x'.repeat(60) });
    d.p.newCode();
    expect(await auth(d.p, key(), { s: secretOf(d.p), g: 'alice-token', n: '' })).toEqual({ name: 'Phone' });
  });

  it('records when a paired phone was last seen', async () => {
    const d = await started();
    const id = generateKeyPair();
    await phone(d.p.state.code!, id);
    const before = saved(d.p).devices[0].lastSeen;
    await new Promise((r) => setTimeout(r, 20));
    await phone(d.p.state.code!, id);
    await vi.waitFor(() => expect(saved(d.p).devices[0].lastSeen).toBeGreaterThan(before), { timeout: 3000 });
  });
});

describe('what a phone says', () => {
  async function connected(api: Record<string, unknown> = {}) {
    const d = desktop({ api });
    d.p.apply();
    const st = await ready(d.p);
    const ph = await phone(st.code!);
    return { d, ...ph };
  }
  const results = (got: any[]) => got.filter((m) => m.t === 'result');

  it('greets a phone that connects with this computer\'s name', async () => {
    const { got } = await connected();
    await vi.waitFor(() => expect(got).toContainEqual({ t: 'hello', name: hostname() }), { timeout: 3000 });
  });

  it('ignores garbage, other message types and calls without a name, then still answers a real call', async () => {
    const { link, got } = await connected({ ping: async () => 'pong' });
    send(link, 'this is not json');
    send(link, 'null');
    send(link, { t: 'noise' });
    send(link, { t: 'call', id: 1 });
    send(link, { t: 'call', id: 2, name: 5 });
    send(link, { t: 'ack' });
    send(link, { t: 'ack', ids: 'nope' });
    send(link, { t: 'call', id: 3, name: 'ping', args: [] });
    await vi.waitFor(() => expect(results(got)).toHaveLength(1), { timeout: 3000 });
    expect(results(got)[0]).toEqual({ t: 'result', id: 3, ok: true, value: 'pong' });
  });

  it('turns undefined results into null, and cleans error messages (shortened to 500 characters)', async () => {
    const { link, got } = await connected({ nothing: async () => undefined, wrapped: async () => { throw new Error('x'); }, long: async () => { throw new Error('e'.repeat(900)); }, plain: async () => { throw 'just text'; } });
    const call = (id: number, name: string) => send(link, { t: 'call', id, name, args: [] });
    call(1, 'nothing'); call(2, 'long'); call(3, 'plain'); call(4, 'missing');
    await vi.waitFor(() => expect(results(got)).toHaveLength(4), { timeout: 3000 });
    const r = (id: number) => results(got).find((m) => m.id === id);
    expect(r(1)).toEqual({ t: 'result', id: 1, ok: true, value: null });
    expect(r(2).error).toHaveLength(500);
    expect(r(3)).toMatchObject({ ok: false, error: 'just text' });
    expect(r(4)).toMatchObject({ ok: false, error: 'no such call' }); // "Error invoking remote method" noise taken off
  });

  it('forward() with nobody connected is a no-op, and reaches every connected phone', async () => {
    const d = desktop();
    d.p.forward('toast', { tone: 'ready', title: 'nobody' });
    d.p.apply();
    const st = await ready(d.p);
    d.p.forward('toast', { tone: 'ready', title: 'nobody' });
    const a = await phone(st.code!); d.p.newCode();
    const b = await phone(d.p.state.code!);
    d.p.forward('toast', { tone: 'ready', title: 'everyone' });
    for (const x of [a, b]) await vi.waitFor(() => expect(x.got.filter((m) => m.t === 'event')).toEqual([{ t: 'event', channel: 'toast', payload: { tone: 'ready', title: 'everyone' } }]), { timeout: 3000 });
  });
});

describe('phones that are connected hear about new addresses', () => {
  it('sends {t:"candidates"} to every connected phone when the addresses change', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const a = await phone(st.code!); d.p.newCode();
    const b = await phone(d.p.state.code!);
    d.store.data.settings.p2pAddress = '10.9.9.9';
    d.p.newCode();
    for (const x of [a, b]) await vi.waitFor(() => expect(x.got.filter((m) => m.t === 'candidates')).toHaveLength(1), { timeout: 3000 });
    const msg = a.got.find((m) => m.t === 'candidates');
    expect(msg).toEqual({ t: 'candidates', p: d.p.state.port, c: d.p.state.addresses });
    expect(msg.c[0]).toBe('10.9.9.9');
    // an unchanged list is not sent again
    d.p.newCode();
    await new Promise((r) => setTimeout(r, 150));
    expect(a.got.filter((m) => m.t === 'candidates')).toHaveLength(1);
  });

  it('does not send anything for the first list it builds', async () => {
    const d = desktop();
    d.p.apply();
    await ready(d.p);
    expect((d.p as any).lastCandidates).not.toBe('');
  });
});

describe('notices for phones', () => {
  async function paired(o: Opts = {}) {
    const d = desktop(o);
    d.p.apply();
    const st = await ready(d.p);
    const ph = await phone(st.code!);
    return { d, ...ph };
  }
  const queue = (p: P2P, id: string): Notice[] => saved(p).queue?.[id] ?? [];
  const body = (kind: Notice['kind'] = 'attention') => ({ kind, title: 'Done', body: 'Session finished', silent: false, sessionId: 's1' });

  it('sends one to a connected phone at once, and keeps it until the phone says it has shown it', async () => {
    const { d, got, link, id } = await paired();
    d.p.notify(body());
    await vi.waitFor(() => expect(got.filter((m) => m.t === 'notices')).toHaveLength(1), { timeout: 3000 });
    const n = got.find((m) => m.t === 'notices').items[0];
    expect(n).toMatchObject({ title: 'Done', kind: 'attention', sessionId: 's1' });
    expect(n.id).toMatch(/^[0-9a-f]{16}$/);
    expect(queue(d.p, id).map((x) => x.id)).toEqual([n.id]);
    send(link, { t: 'ack', ids: [n.id] });
    await vi.waitFor(() => expect(queue(d.p, id)).toEqual([]), { timeout: 3000 });
  });

  it('keeps notices for a phone that is away and hands them over when it comes back', async () => {
    const { d, identity, id } = await paired();
    d.p.notify(body());
    d.p.notify({ ...body('failed'), title: 'Second' });
    expect(queue(d.p, id)).toHaveLength(2);
    const back = await phone(d.p.state.code!, identity);
    await vi.waitFor(() => expect(back.got.find((m) => m.t === 'notices' && m.items.length === 2)).toBeTruthy(), { timeout: 3000 });
  });

  it('acknowledging removes only the notices named', async () => {
    const { d, link, id } = await paired();
    for (const t of ['a', 'b', 'c']) d.p.notify({ ...body(), title: t });
    const [a, b, c] = queue(d.p, id);
    send(link, { t: 'ack', ids: [a.id, c.id, 'unknown'] });
    await vi.waitFor(() => expect(queue(d.p, id).map((x) => x.id)).toEqual([b.id]), { timeout: 3000 });
    // an ack for a phone with no queue at all is harmless
    delete saved(d.p).queue;
    send(link, { t: 'ack', ids: [b.id] });
    send(link, { t: 'call', id: 9, name: 'nope', args: [] });
    await new Promise((r) => setTimeout(r, 150));
  });

  it('keeps at most 50 per phone, the newest', async () => {
    const { d, id } = await paired();
    for (let i = 0; i < 60; i++) d.p.notify({ ...body(), title: `n${i}` });
    const q = queue(d.p, id);
    expect(q).toHaveLength(50);
    expect(q[0].title).toBe('n10');
    expect(q[49].title).toBe('n59');
  });

  it('drops notices older than three days, when a phone connects and when new ones are added', async () => {
    const { d, identity, id } = await paired();
    const day = 24 * 3600_000;
    saved(d.p).queue = { [id]: [notice({ id: 'old', at: Date.now() - 3 * day - 1000 }), notice({ id: 'fresh', at: Date.now() - 2 * day })] };
    d.p.notify(body());
    expect(queue(d.p, id).map((n) => n.id)).not.toContain('old');
    expect(queue(d.p, id).map((n) => n.id)).toContain('fresh');
    saved(d.p).queue = { [id]: [notice({ id: 'old', at: Date.now() - 4 * day }), notice({ id: 'fresh2' })] };
    const back = await phone(d.p.state.code!, identity);
    await vi.waitFor(() => expect(back.got.find((m) => m.t === 'notices')).toBeTruthy(), { timeout: 3000 });
    expect(back.got.find((m) => m.t === 'notices').items.map((n: Notice) => n.id)).toEqual(['fresh2']);
    expect(queue(d.p, id).map((n) => n.id)).toEqual(['fresh2']);
  });

  it('sends nothing to a phone that has an empty queue when it connects', async () => {
    const { got } = await paired();
    await vi.waitFor(() => expect(got.some((m) => m.t === 'hello')).toBe(true), { timeout: 3000 });
    expect(got.filter((m) => m.t === 'notices')).toEqual([]);
  });

  it('queues nothing when not ready, or when no phone is paired', async () => {
    const d = desktop();
    d.p.notify(body()); // not started
    d.p.apply();
    d.p.notify(body()); // starting
    await ready(d.p);
    d.p.notify(body()); // ready, but no devices
    expect(saved(d.p).queue).toBeUndefined();
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    d.p.notify(body());
    expect(saved(d.p).queue).toBeUndefined();
  });

  it('forgets a phone\'s notices when it is revoked', async () => {
    const { d, id } = await paired();
    d.p.notify(body());
    expect(queue(d.p, id)).toHaveLength(1);
    await d.p.revoke(id);
    expect(saved(d.p).queue[id]).toBeUndefined();
  });
});

describe('the identity file under many writes', () => {
  // Found as a bug and fixed: saves used to be fire-and-forget and could overlap, and a short write landing over a longer one left the tail
  // of the longer file behind, so the file no longer parsed; the next start made a new identity and every pairing was lost.
  it('leaves p2p.bin parseable after a burst of notices and a reconnect', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const ph = await phone(st.code!);
    const day = 24 * 3600_000;
    saved(d.p).queue = { [ph.id]: Array.from({ length: 40 }, (_, i) => notice({ id: `old${i}`, at: Date.now() - 4 * day })) };
    const back = await phone(d.p.state.code!, ph.identity);
    await vi.waitFor(() => expect(back.got.find((m) => m.t === 'hello')).toBeTruthy(), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 500));
    expect(() => JSON.parse(readFileSync(join(d.dir, 'p2p.bin'), 'utf8'))).not.toThrow();
  });
});

describe('revoking', () => {
  it('disconnects the phone and forgets it', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const ph = await phone(st.code!);
    const closed = vi.fn();
    ph.link.onClose(closed);
    await d.p.revoke(ph.id);
    expect(d.p.state.devices).toEqual([]);
    expect(saved(d.p).devices).toEqual([]);
    expect(d.p.state.devices).toHaveLength(0);
    await vi.waitFor(() => expect(closed).toHaveBeenCalled(), { timeout: 4000 });
  });

  it('is fine for an id nobody has, and works before the service ever ran', async () => {
    const d = desktop();
    d.p.apply();
    await ready(d.p);
    const ph = await phone(d.p.state.code!);
    await d.p.revoke('00'.repeat(32));
    expect(d.p.state.devices).toHaveLength(1);
    expect(d.p.state.devices[0]).toMatchObject({ connected: true });
    expect(ph.link).toBeTruthy();
    const cold = desktop();
    await cold.p.revoke('abcd');
    expect(cold.p.state.state).toBe('off');
  });

  it('shows connected phones as connected, and not after they leave', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const ph = await phone(st.code!);
    expect(d.p.state.devices).toMatchObject([{ id: ph.id, connected: true }]);
    ph.link.close();
    await vi.waitFor(() => expect(d.p.state.devices[0].connected).toBe(false), { timeout: 5000 });
  }, 10_000);
});

describe('shutdown', () => {
  it('waits until the router has been told to take the forwarding away', async () => {
    let unmapped = false;
    const mapper = { map: async () => ({ mapping: null, note: 'none' }), unmap: async () => { await new Promise((r) => setTimeout(r, 150)); unmapped = true; }, onRenewed: undefined };
    const d = desktop({ settings: { p2pPortMap: true }, mapper });
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.portMap?.state).toBe('failed'), { timeout: 4000 });
    await d.p.shutdown();
    expect(unmapped).toBe(true);
    expect((d.p as any).udp).toBeNull();
  });

  it('does not fail when the router cannot be reached to unmap, or when it was never started', async () => {
    const mapper = { map: async () => ({ mapping: null }), unmap: async () => { throw new Error('gone'); }, onRenewed: undefined };
    const d = desktop({ settings: { p2pPortMap: true }, mapper });
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.portMap?.state).toBe('failed'), { timeout: 4000 });
    await expect(d.p.shutdown()).resolves.toBeUndefined();
    await expect(desktop().p.shutdown()).resolves.toBeUndefined();
  });

  it('closes the connections and stops the timer', async () => {
    const d = desktop();
    d.p.apply();
    await ready(d.p);
    expect((d.p as any).timer).not.toBeNull();
    await d.p.shutdown();
    expect((d.p as any).timer).toBeNull();
    expect((d.p as any).links.size).toBe(0);
  });

  it('drops a mapping that finishes after shutdown, and gives it back', async () => {
    let finish!: () => void;
    const unmap = vi.fn(async () => undefined);
    const mapper = { map: () => new Promise((r) => { finish = () => r({ mapping: { method: 'upnp', externalIp: '203.0.113.9', externalPort: 1 } }); }), unmap, onRenewed: undefined as any };
    const d = desktop({ settings: { p2pPortMap: true }, mapper });
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.state).toBe('ready'), { timeout: 4000 });
    await vi.waitFor(() => expect(typeof finish).toBe('function'), { timeout: 3000 });
    await d.p.shutdown();
    unmap.mockClear();
    finish();
    await vi.waitFor(() => expect(unmap).toHaveBeenCalled(), { timeout: 3000 });
    expect(d.p.state.portMap).not.toMatchObject({ state: 'mapped' });
    // and a renewal arriving late is ignored
    const before = d.p.state;
    mapper.onRenewed?.({ method: 'upnp', externalIp: '198.51.100.1', externalPort: 2 });
    expect(d.p.state).toBe(before);
  });
});
