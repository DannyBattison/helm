import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../src/core/dispatch';
import { rankCandidates } from '../src/core/p2p/addresses';
import { P2P } from '../src/core/p2p/service';
import { bindingRequest, isStun, parseBindingResponse } from '../src/core/p2p/stun';
import { NodeUdp } from '../src/core/p2p/udp';
import { join as joinLink } from '../src/shared/p2p/link';
import type { Link } from '../src/shared/p2p/link';
import { generateKeyPair } from '../src/shared/p2p/noise';

describe('STUN', () => {
  /** A binding success response for `tx`, saying the sender is `host:port` (XOR-MAPPED-ADDRESS). */
  function response(tx: Uint8Array, host: string, port: number) {
    const b = new Uint8Array(32);
    const v = new DataView(b.buffer);
    v.setUint16(0, 0x0101); v.setUint16(2, 12); v.setUint32(4, 0x2112a442); b.set(tx, 8);
    v.setUint16(20, 0x0020); v.setUint16(22, 8); b[25] = 1;
    v.setUint16(26, port ^ 0x2112);
    host.split('.').forEach((o, i) => { b[28 + i] = +o ^ b[4 + i]; });
    return b;
  }
  const idOf = (tx: Uint8Array) => Buffer.from(tx).toString('hex');

  it('tells STUN from helm packets', () => {
    const { packet } = bindingRequest();
    expect(isStun(packet)).toBe(true);
    for (const first of [1, 2, 3]) { const p = new Uint8Array(40).fill(9); p[0] = first; expect(isStun(p)).toBe(false); }
    expect(isStun(packet.subarray(0, 19))).toBe(false);
  });

  it('reads the address a server saw', () => {
    const { packet } = bindingRequest();
    const tx = packet.subarray(8, 20);
    expect(parseBindingResponse(response(tx, '203.0.113.9', 41234))).toEqual({ id: idOf(tx), host: '203.0.113.9', port: 41234 });
    expect(parseBindingResponse(packet)).toBeNull();
    const cut = response(tx, '1.2.3.4', 5).subarray(0, 25);
    expect(parseBindingResponse(cut)).toBeNull();
  });
});

describe('which addresses go in the code', () => {
  const nic = (address: string, family: 'IPv4' | 'IPv6', internal = false) => ({ address, family, internal, netmask: '', mac: '', cidr: null }) as any;
  it('leaves out loopback, link-local and Teredo, and orders the rest', () => {
    const out = rankCandidates({
      lo: [nic('127.0.0.1', 'IPv4', true), nic('::1', 'IPv6', true)],
      eth0: [nic('192.168.1.20', 'IPv4'), nic('fe80::1', 'IPv6'), nic('2a00:1:2::5', 'IPv6'), nic('169.254.3.3', 'IPv4'), nic('fd12::1', 'IPv6')],
      Teredo: [nic('2001:0:4136::1', 'IPv6')],
      tailscale0: [nic('100.101.102.103', 'IPv4')],
      docker0: [nic('172.17.0.1', 'IPv4')],
      wan: [nic('198.51.100.4', 'IPv4')]
    }).map((c) => c.address);
    expect(out).toEqual(['192.168.1.20', '2a00:1:2::5', '198.51.100.4', '100.101.102.103', 'fd12::1', '172.17.0.1']);
  });
});

// ---------------------------------------------------------------------------------------------- the service, over real UDP
const closers: (() => void)[] = [];
afterEach(() => { closers.forEach((c) => c()); closers.length = 0; });

/** GitHub, as far as the desktop asks it: tokens `alice-token` and `mallory-token` belong to those users. */
const whoIs = async (token: string) => (token === 'alice-token' ? 'Alice' : token === 'mallory-token' ? 'Mallory' : null);

function desktop(api: Record<string, unknown> = {}) {
  const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1' } } };
  const p = new P2P(store, (n, a) => dispatch(api, n, a), () => undefined, () => ({ dataDir: dir }), whoIs);
  const dir = mkdtempSync(join(tmpdir(), 'helm-p2p-'));
  closers.push(() => p.shutdown());
  return { p, store, dir };
}
const ready = async (p: P2P) => { await vi.waitFor(() => expect(p.state.state === 'ready' && p.state.code).toBeTruthy(), { timeout: 3000 }); return p.state; };

async function phone(code: string, identity = generateKeyPair(), name = 'Test phone', githubToken: string | undefined = 'alice-token') {
  const udp = new NodeUdp(() => undefined);
  await udp.bind(0);
  closers.push(() => udp.close());
  return { identity, link: await joinLink({ socket: udp, code, identity, name, githubToken, timeoutMs: 3000 }).catch((e) => e as Error) };
}
const send = (l: Link, o: unknown) => l.send(new TextEncoder().encode(JSON.stringify(o)));
const incoming = (l: Link) => { const got: any[] = []; l.onMessage((m) => got.push(JSON.parse(new TextDecoder().decode(m)))); return got; };

describe('the desktop service', () => {
  it('pairs a phone with the code, runs its calls, and sends it events', async () => {
    const d = desktop({ getThing: async (x: number) => ({ x }), openFolder: async () => 'no', boom: async () => { throw new Error('nope'); } });
    d.p.apply();
    const st = await ready(d.p);
    expect(st.addresses[0]).toBe('127.0.0.1');
    const { link } = await phone(st.code!);
    expect(link).not.toBeInstanceOf(Error);
    const got = incoming(link as Link);
    const call = (id: number, name: string, args: unknown[] = []) => send(link as Link, { t: 'call', id, name, args });
    call(1, 'getThing', [5]); call(2, 'openFolder'); call(3, 'boom'); call(4, 'constructor');
    await vi.waitFor(() => expect(got.filter((m) => m.t === 'result')).toHaveLength(4), { timeout: 3000 });
    const res = (id: number) => got.find((m) => m.t === 'result' && m.id === id);
    expect(res(1)).toMatchObject({ ok: true, value: { x: 5 } });
    expect(res(2)).toMatchObject({ ok: false, error: expect.stringContaining('done by the browser') });
    expect(res(3)).toMatchObject({ ok: false, error: 'nope' });
    expect(res(4)).toMatchObject({ ok: false });
    d.p.forward('toast', { tone: 'ready', title: 'Hi' });
    await vi.waitFor(() => expect(got.find((m) => m.t === 'event')).toMatchObject({ channel: 'toast', payload: { title: 'Hi' } }), { timeout: 3000 });
    expect(d.p.state.devices).toMatchObject([{ name: 'Test phone', connected: true }]);
  });

  it('remembers a phone across restarts, so it can come back without a new secret, and forgets it when told to', async () => {
    const d = desktop();
    d.p.apply();
    const first = await ready(d.p);
    const id = generateKeyPair();
    expect((await phone(first.code!, id)).link).not.toBeInstanceOf(Error);
    d.p.shutdown();

    // A new service over the same files: same key, same port, same device list.
    const again = new P2P(d.store, () => Promise.resolve(null), () => undefined, () => ({ dataDir: d.dir }), whoIs);
    closers.push(() => again.shutdown());
    again.apply();
    const st = await ready(again);
    expect(st.port).toBe(first.port);
    expect(st.devices).toHaveLength(1);
    // The old code carried a spent secret; this phone is known, so even that does not matter.
    expect((await phone(first.code!, id)).link).not.toBeInstanceOf(Error);
    await again.revoke(st.devices[0].id);
    expect(again.state.devices).toHaveLength(0);
    expect((await phone(first.code!, id)).link).toBeInstanceOf(Error);
  });

  it('lets a code pair one device, once', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    expect((await phone(st.code!)).link).not.toBeInstanceOf(Error);
    expect((await phone(st.code!)).link).toBeInstanceOf(Error);
    d.p.newCode();
    expect((await phone(d.p.state.code!)).link).not.toBeInstanceOf(Error);
    expect(d.p.state.devices).toHaveLength(2);
  });

  it('only pairs a phone whose GitHub user is the one signed in here', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    expect((await phone(st.code!, generateKeyPair(), 'Mallory', 'mallory-token')).link).toBeInstanceOf(Error);
    expect((await phone(st.code!, generateKeyPair(), 'No token', '')).link).toBeInstanceOf(Error);
    expect((await phone(st.code!, generateKeyPair(), 'Bad token', 'nonsense')).link).toBeInstanceOf(Error);
    expect(d.p.state.devices).toHaveLength(0);
    // The code was not used up by those attempts: the right user can still pair with it.
    expect((await phone(st.code!)).link).not.toBeInstanceOf(Error);
    expect(d.p.state.devices).toMatchObject([{ name: 'Test phone' }]);
  });

  it('stops recognising a phone when a different GitHub user signs in on the computer', async () => {
    const d = desktop();
    d.p.apply();
    const st = await ready(d.p);
    const id = generateKeyPair();
    expect((await phone(st.code!, id)).link).not.toBeInstanceOf(Error);
    d.store.data.user = { login: 'bob' };
    expect((await phone(st.code!, id)).link).toBeInstanceOf(Error);
    d.store.data.user = { login: 'Alice' };
    expect((await phone(st.code!, id)).link).not.toBeInstanceOf(Error);
  });

  it('will not start until someone is signed in to GitHub', async () => {
    const d = desktop();
    d.store.data.user = null;
    d.p.apply();
    expect(d.p.state).toMatchObject({ state: 'error', error: expect.stringContaining('Sign in to GitHub') });
  });

  it('does nothing when turned off, and reports a port that is taken', async () => {
    const off = desktop();
    off.store.data.settings.p2pEnabled = false;
    off.p.apply();
    expect(off.p.state.state).toBe('off');

    const a = desktop(); a.p.apply();
    const used = (await ready(a.p)).port!;
    const b = desktop(); b.store.data.settings.p2pPort = used; b.p.apply();
    await vi.waitFor(() => expect(b.p.state.state).toBe('error'), { timeout: 3000 });
    expect(b.p.state.error).toMatch(/already in use/);
  });
});
