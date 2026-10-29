import { createSocket } from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', async (orig) => ({ ...(await orig<typeof import('node:dns/promises')>()), lookup: dns.lookup }));

import { P2P } from '../src/core/p2p/service';
import { NodeUdp } from '../src/core/p2p/udp';
import { join as joinLink } from '../src/shared/p2p/link';
import type { Link } from '../src/shared/p2p/link';
import { generateKeyPair } from '../src/shared/p2p/noise';

/** The second server the service asks, to tell a cone NAT from a symmetric one, is always stun.l.google.com:19302. */
const SECOND = { name: 'stun.l.google.com', ip: '127.0.0.2', port: 19302 };

/** A STUN server on UDP that says the sender is `answer(sourcePort)`, or says nothing if that gives null. */
async function stunServer(host: string, port: number, answer: (from: number) => { host: string; port: number } | null) {
  const sock = createSocket('udp4');
  const asked: number[] = [];
  sock.on('message', (m, r) => {
    const a = answer(r.port);
    asked.push(r.port);
    if (!a) return;
    const b = Buffer.alloc(32);
    b.writeUInt16BE(0x0101, 0); b.writeUInt16BE(12, 2); b.writeUInt32BE(0x2112a442, 4); m.copy(b, 8, 8, 20);
    b.writeUInt16BE(0x0020, 20); b.writeUInt16BE(8, 22); b[25] = 1; b.writeUInt16BE(a.port ^ 0x2112, 26);
    a.host.split('.').forEach((o, i) => { b[28 + i] = +o ^ b[4 + i]; });
    sock.send(b, r.port, r.address);
  });
  await new Promise<void>((res, rej) => { sock.once('error', rej); sock.bind(port, host, res); });
  closers.push(() => sock.close());
  return { port: (sock.address() as any).port as number, asked };
}

const closers: (() => void)[] = [];
beforeEach(() => {
  dns.lookup.mockReset();
  dns.lookup.mockImplementation(async (name: string) => ({ address: name === SECOND.name ? SECOND.ip : '127.0.0.1', family: 4 }));
});
afterEach(() => { vi.restoreAllMocks(); closers.splice(0).forEach((c) => c()); });

function desktop(stun: string, over: Record<string, unknown> = {}) {
  const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: stun, p2pAddress: '10.9.9.9', ...over } } };
  const dir = mkdtempSync(join(tmpdir(), 'helm-p2p-stun-'));
  const p = new P2P(store, async () => null, () => undefined, () => ({ dataDir: dir }), async () => 'alice');
  closers.push(() => void p.shutdown());
  return { p, store, dir };
}
const natKnown = (p: P2P) => vi.waitFor(() => expect(p.state.nat).toBeDefined(), { timeout: 5000 });
/** Makes the 2.5 s wait for a STUN answer 30 ms, so a server that stays silent costs 90 ms. */
const impatient = () => {
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms?: number, ...a: any[]) => real(fn, ms === 2500 ? 30 : ms, ...a)) as any);
};

describe('what the STUN servers say', () => {
  it('a cone NAT: both servers see the same address, which goes first among the discovered ones', async () => {
    const one = await stunServer('127.0.0.1', 0, (from) => ({ host: '203.0.113.9', port: from }));
    await stunServer(SECOND.ip, SECOND.port, (from) => ({ host: '203.0.113.9', port: from }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('cone');
    // the mapped port is the local port itself, so the address is written without one
    expect(d.p.state.mapped).toBe(`203.0.113.9:${d.p.state.port}`);
    expect(d.p.state.addresses.slice(0, 2)).toEqual(['10.9.9.9', '203.0.113.9']);
    expect(dns.lookup).toHaveBeenCalledWith('stun.example', { family: 4 });
    expect(dns.lookup).toHaveBeenCalledWith(SECOND.name, { family: 4 });
  });

  it('writes the mapped address as ip:port when the router changed the port', async () => {
    const one = await stunServer('127.0.0.1', 0, () => ({ host: '203.0.113.9', port: 40000 }));
    await stunServer(SECOND.ip, SECOND.port, () => ({ host: '203.0.113.9', port: 40000 }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('cone');
    expect(d.p.state.addresses.slice(0, 2)).toEqual(['10.9.9.9', '203.0.113.9:40000']);
  });

  it('a symmetric NAT: a different answer from the second server means the address is shown but left out of the code', async () => {
    const one = await stunServer('127.0.0.1', 0, () => ({ host: '203.0.113.9', port: 40000 }));
    await stunServer(SECOND.ip, SECOND.port, () => ({ host: '203.0.113.9', port: 40001 }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('symmetric');
    expect(d.p.state.mapped).toBe('203.0.113.9:40000');
    expect(d.p.state.addresses).not.toContain('203.0.113.9:40000');
    expect(d.p.state.addresses).not.toContain('203.0.113.9');
    expect(d.p.state.addresses[0]).toBe('10.9.9.9');
  });

  it('a different host from the second server is symmetric too', async () => {
    const one = await stunServer('127.0.0.1', 0, () => ({ host: '203.0.113.9', port: 40000 }));
    await stunServer(SECOND.ip, SECOND.port, () => ({ host: '203.0.113.10', port: 40000 }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('symmetric');
  });

  it('with only one answer, calls it a cone NAT: there is nothing to compare', async () => {
    const one = await stunServer('127.0.0.1', 0, (from) => ({ host: '203.0.113.9', port: from }));
    // nothing listens at the second server; make the wait short
    impatient();
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('cone');
  });

  // Found as a bug and fixed: the second server's lookup used to be outside the catch, so a second server that did not resolve threw away
  // the first server's good answer (nat 'unknown', no mapped address).
  it('keeps the first answer when the second server cannot be looked up', async () => {
    const one = await stunServer('127.0.0.1', 0, (from) => ({ host: '203.0.113.9', port: from }));
    dns.lookup.mockImplementation(async (name: string) => { if (name === SECOND.name) throw new Error('ENOTFOUND'); return { address: '127.0.0.1', family: 4 }; });
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state.nat).toBe('cone');
    expect(d.p.state.mapped).toBe(`203.0.113.9:${d.p.state.port}`);
  });

  it('unknown when the server never answers', async () => {
    const one = await stunServer('127.0.0.1', 0, () => null);
    impatient();
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state).toMatchObject({ state: 'ready', nat: 'unknown', mapped: undefined });
    expect(one.asked).toHaveLength(3); // asked three times
    expect(d.p.state.addresses).toEqual(['10.9.9.9', ...d.p.state.addresses.slice(1)]);
    expect(d.p.state.addresses).not.toContain('203.0.113.9');
  });

  it('unknown when the server name does not resolve, and the code still has the local addresses', async () => {
    dns.lookup.mockRejectedValue(new Error('ENOTFOUND'));
    const d = desktop('nowhere.invalid:3478');
    d.p.apply();
    await natKnown(d.p);
    expect(d.p.state).toMatchObject({ state: 'ready', nat: 'unknown', mapped: undefined });
    expect(d.p.state.code).toBeTruthy();
  });

  it('asks port 3478 when the setting has no port (or port 0)', async () => {
    impatient();
    for (const setting of ['stun.example', 'stun.example:0']) {
      dns.lookup.mockClear();
      const d = desktop(setting);
      d.p.apply();
      await natKnown(d.p);
      expect(dns.lookup).toHaveBeenCalledWith('stun.example', { family: 4 });
      expect(d.p.state.nat).toBe('unknown');
    }
  });

  it('does not ask anyone when the STUN setting is blank', async () => {
    const d = desktop('   ');
    d.p.apply();
    await vi.waitFor(() => expect(d.p.state.state).toBe('ready'), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 100));
    expect(dns.lookup).not.toHaveBeenCalled();
    expect(d.p.state.nat).toBeUndefined();
  });

  it('asks again every 25 s, and notices when the mapping moves', async () => {
    let port = 40000;
    const one = await stunServer('127.0.0.1', 0, () => ({ host: '203.0.113.9', port }));
    await stunServer(SECOND.ip, SECOND.port, () => ({ host: '203.0.113.9', port }));
    const timers: { fn: () => void; ms: number }[] = [];
    const realSet = globalThis.setInterval;
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: any, ms: number) => { const t = realSet(() => undefined, 1e9); t.unref(); timers.push({ fn, ms }); return t; }) as any);
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    expect(timers.map((t) => t.ms)).toEqual([25_000]);
    expect(d.p.state.addresses).toContain('203.0.113.9:40000');
    port = 40500;
    timers[0].fn();
    await vi.waitFor(() => expect(d.p.state.mapped).toBe('203.0.113.9:40500'), { timeout: 3000 });
    expect(d.p.state.addresses).toContain('203.0.113.9:40500');
    expect(d.p.state.addresses).not.toContain('203.0.113.9:40000');
  });

  it('tells a connected phone when the address changes, and only then', async () => {
    let port = 40000;
    const one = await stunServer('127.0.0.1', 0, () => ({ host: '203.0.113.9', port }));
    await stunServer(SECOND.ip, SECOND.port, () => ({ host: '203.0.113.9', port }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await natKnown(d.p);
    const udp = new NodeUdp(() => undefined);
    await udp.bind(0);
    closers.push(() => udp.close());
    const link: Link = await joinLink({ socket: udp, code: d.p.state.code!, identity: generateKeyPair(), name: 'Phone', githubToken: 'any', timeoutMs: 3000 });
    const got: any[] = [];
    link.onMessage((m) => got.push(JSON.parse(new TextDecoder().decode(m))));
    await vi.waitFor(() => expect(got.some((m) => m.t === 'hello')).toBe(true), { timeout: 3000 });
    await (d.p as any).refresh(); // nothing changed
    await new Promise((r) => setTimeout(r, 100));
    expect(got.filter((m) => m.t === 'candidates')).toEqual([]);
    port = 41000;
    await (d.p as any).refresh();
    await vi.waitFor(() => expect(got.filter((m) => m.t === 'candidates')).toHaveLength(1), { timeout: 3000 });
    const msg = got.find((m) => m.t === 'candidates');
    expect(msg.p).toBe(d.p.state.port);
    expect(msg.c).toEqual(d.p.state.addresses);
    expect(msg.c).toContain('203.0.113.9:41000');
  });
});

describe('turning the service off while STUN is being asked', () => {
  const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

  it('forgets an answer that arrives after the service was switched off (first lookup)', async () => {
    const g = gate();
    dns.lookup.mockImplementation(async () => { await g.p; return { address: '127.0.0.1', family: 4 }; });
    const d = desktop('stun.example:1');
    d.p.apply();
    await vi.waitFor(() => expect(dns.lookup).toHaveBeenCalled(), { timeout: 3000 });
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    g.open();
    await new Promise((r) => setTimeout(r, 100));
    expect(d.p.state).toMatchObject({ state: 'off', addresses: [] });
    expect(d.p.state.nat).toBeUndefined();
  });

  it('forgets a failure that arrives after the service was switched off', async () => {
    const g = gate();
    dns.lookup.mockImplementation(async () => { await g.p; throw new Error('late'); });
    const d = desktop('stun.example:1');
    d.p.apply();
    await vi.waitFor(() => expect(dns.lookup).toHaveBeenCalled(), { timeout: 3000 });
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    g.open();
    await new Promise((r) => setTimeout(r, 100));
    expect(d.p.state.nat).toBeUndefined();
    expect(d.p.state.state).toBe('off');
  });

  it('does not ask the second server once the service was switched off during the first answer, and keeps nothing', async () => {
    // The service is switched off inside the first server's handler, so its answer always arrives after that (no race with a timer).
    let off = () => undefined as void;
    const one = await stunServer('127.0.0.1', 0, (from) => { off(); return { host: '203.0.113.9', port: from }; });
    const d = desktop(`stun.example:${one.port}`);
    off = () => { d.store.data.settings.p2pEnabled = false; d.p.apply(); };
    dns.lookup.mockImplementation(async (name: string) => {
      if (name === SECOND.name) throw new Error('should not be asked');
      return { address: '127.0.0.1', family: 4 };
    });
    d.p.apply();
    await new Promise((r) => setTimeout(r, 300));
    expect(d.p.state.state).toBe('off');
    expect(d.p.state.nat).toBeUndefined();
    expect(dns.lookup).not.toHaveBeenCalledWith(SECOND.name, expect.anything());
  });

  it('forgets the answer if the service is switched off while the second server is being asked', async () => {
    const one = await stunServer('127.0.0.1', 0, (from) => ({ host: '203.0.113.9', port: from }));
    const g = gate();
    dns.lookup.mockImplementation(async (name: string) => { if (name === SECOND.name) await g.p; return { address: name === SECOND.name ? SECOND.ip : '127.0.0.1', family: 4 }; });
    await stunServer(SECOND.ip, SECOND.port, (from) => ({ host: '203.0.113.9', port: from }));
    const d = desktop(`stun.example:${one.port}`);
    d.p.apply();
    await vi.waitFor(() => expect(dns.lookup).toHaveBeenCalledWith(SECOND.name, { family: 4 }), { timeout: 3000 });
    d.store.data.settings.p2pEnabled = false;
    d.p.apply();
    g.open();
    await new Promise((r) => setTimeout(r, 200));
    expect(d.p.state).toMatchObject({ state: 'off', addresses: [] });
    expect(d.p.state.nat).toBeUndefined();
    expect(d.p.state.mapped).toBeUndefined();
  });
});
