import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { host, join } from '../src/shared/p2p/link';
import type { Link } from '../src/shared/p2p/link';
import { generateKeyPair } from '../src/shared/p2p/noise';
import { b64, encodeShareCode } from '../src/shared/p2p/sharecode';
import { SimNet } from './p2p-simnet';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);

/** A desktop with the pairing rules helm uses: a known device, or a one-time secret that works once. */
function desktop(net: SimNet, over: { initsPerSecond?: number; at?: string } = {}) {
  let asked = 0;
  const identity = generateKeyPair();
  const devices = new Map<string, string>();
  const secrets = new Set<string>();
  const links: { link: Link; name: string; key: Uint8Array }[] = [];
  const sock = net.socket(over.at ?? '203.0.113.5', 4000);
  const h = host({
    socket: sock, identity, initsPerSecond: over.initsPerSecond,
    authorize: (key, said) => {
      asked++;
      const id = b64.encode(key);
      if (devices.has(id)) return { name: devices.get(id)! };
      if (said.s && secrets.delete(said.s)) { devices.set(id, said.n || 'phone'); return { name: said.n || 'phone' }; }
      return false;
    },
    onLink: (link, d) => links.push({ link, ...d })
  });
  const code = (withSecret = true) => {
    const s = b64.encode(crypto.getRandomValues(new Uint8Array(16)));
    if (withSecret) secrets.add(s);
    return encodeShareCode({ v: 1, n: 'Desk', p: 4000, c: [over.at ?? '203.0.113.5', '10.0.0.9'], k: b64.encode(identity.publicKey), ...(withSecret ? { s } : {}) });
  };
  return { h, identity, devices, secrets, links, code, sock, asked: () => asked };
}

const phone = (net: SimNet, addr = '198.51.100.7:5555') => {
  const [h, p] = addr.split(':');
  return { identity: generateKeyPair(), socket: net.socket(h, +p) };
};
const connect = async (p: ReturnType<typeof phone>, code: string, name = 'My phone') => {
  const r = join({ socket: p.socket, code, identity: p.identity, name });
  const settled = r.then((v) => v, (e) => e);
  await vi.advanceTimersByTimeAsync(7000);
  return settled as Promise<Link | Error>;
};

describe('a phone and a desktop', () => {
  it('pair with the code, and carry messages both ways, large ones included', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const p = phone(net);
    const link = await connect(p, d.code()) as Link;
    expect(link).not.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(100);
    expect(d.links).toHaveLength(1);
    expect(d.links[0].name).toBe('My phone');

    const got: string[] = [], back: string[] = [];
    d.links[0].link.onMessage((m) => { got.push(text(m)); d.links[0].link.send(bytes('echo:' + text(m).slice(0, 5))); });
    link.onMessage((m) => back.push(text(m)));
    link.send(bytes('hello'));
    const big = 'x'.repeat(500_000);
    link.send(bytes(big));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(got).toEqual(['hello', big]);
    expect(back).toEqual(['echo:hello', 'echo:xxxxx']);
  });

  it('recognise a paired device without the secret, and the secret works only once', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const p = phone(net);
    const first = d.code();
    expect(await connect(p, first)).not.toBeInstanceOf(Error);
    // The same code from a different device: the secret is spent.
    const q = phone(net, '198.51.100.8:6000');
    expect(await connect(q, first)).toBeInstanceOf(Error);
    // The first device, later, with a code that carries no secret.
    const p2 = { identity: p.identity, socket: net.socket('198.51.100.7', 5556) };
    expect(await connect(p2, d.code(false))).not.toBeInstanceOf(Error);
    // And a stranger with a secretless code is refused.
    expect(await connect(phone(net, '198.51.100.9:7000'), d.code(false))).toBeInstanceOf(Error);
  });

  it('get no answer at all if they are not accepted: the port shows nothing', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const stranger = phone(net);
    const err = await connect(stranger, d.code(false));
    expect(err).toBeInstanceOf(Error);
    expect(net.sent.filter((s) => s.from === d.sock.addr)).toEqual([]);
    expect(d.links).toHaveLength(0);
  });

  it('ignore junk, a first message made for another desktop, and a replay of a real one', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const attacker = net.socket('192.0.2.66', 1);
    for (const junk of [new Uint8Array(0), new Uint8Array([1]), new Uint8Array(200).fill(1), new Uint8Array(200).fill(3), crypto.getRandomValues(new Uint8Array(300))]) attacker.send(junk, '203.0.113.5', 4000);
    await vi.advanceTimersByTimeAsync(200);
    // A code with another desktop's key but this desktop's address: the first message is for someone else, and cannot be read here.
    const wrongKey = encodeShareCode({ v: 1, n: 'x', p: 4000, c: ['203.0.113.5'], k: b64.encode(generateKeyPair().publicKey), s: b64.encode(new Uint8Array(16)) });
    expect(await connect(phone(net), wrongKey)).toBeInstanceOf(Error);

    const p = phone(net);
    const link = await connect(p, d.code()) as Link;
    expect(link).not.toBeInstanceOf(Error);
    const init = net.sent.find((s) => s.from === p.socket.addr && s.data[0] === 1)!;
    // The attacker replays the recorded first message from their own address. It decrypts, but the secret was spent: no answer, no link.
    const before = net.sent.length;
    attacker.send(init.data, '203.0.113.5', 4000);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.sent.slice(before).filter((s) => s.from === d.sock.addr && s.to === attacker.addr)).toEqual([]);
    expect(d.links).toHaveLength(1);
  });

  it('survive loss, duplication and reordering of packets', async () => {
    const net = new SimNet(5);
    net.loss = 0.1; net.dupe = 0.1; net.maxDelay = 50;
    const d = desktop(net);
    const link = await connect(phone(net), d.code());
    expect(link).not.toBeInstanceOf(Error);
    const got: number[] = [];
    d.links[0].link.onMessage((m) => got.push(m.length));
    for (let i = 0; i < 20; i++) (link as Link).send(new Uint8Array(3000 + i));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(got).toEqual(Array.from({ length: 20 }, (_, i) => 3000 + i));
  });

  it('keep working when the phone changes address, because the key is what counts', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const p = phone(net);
    const link = await connect(p, d.code()) as Link;
    const fromPhone: string[] = [], fromHost: string[] = [];
    d.links[0].link.onMessage((m) => fromPhone.push(text(m)));
    link.onMessage((m) => fromHost.push(text(m)));
    net.move(p.socket.addr, '100.64.2.2:9999');
    link.send(bytes('from the new network'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fromPhone).toEqual(['from the new network']);
    expect(d.links[0].link.remote).toEqual({ host: '100.64.2.2', port: 9999 });
    d.links[0].link.send(bytes('and back'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fromHost).toEqual(['and back']);
  });

  it('do the key agreement for only a few first messages a second from one address', async () => {
    const net = new SimNet();
    const d = desktop(net, { initsPerSecond: 3 });
    const p = phone(net);
    const code = d.code(false);
    for (let i = 0; i < 20; i++) void join({ socket: p.socket, code, identity: p.identity, name: 'x', timeoutMs: 100 }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(500);
    // Each of the 20 made a different first message that the desktop could read; it looked at only as many as the limit.
    expect(d.asked()).toBeLessThanOrEqual(3);
    expect(d.asked()).toBeGreaterThan(0);
  });

  it('wait for a slow decision without starting a second link from the repeats of the first message', async () => {
    const net = new SimNet();
    const identity = generateKeyPair();
    let asked = 0;
    const links: unknown[] = [];
    host({ socket: net.socket('203.0.113.5', 4000), identity, authorize: () => { asked++; return new Promise((r) => setTimeout(() => r({ name: 'slow' }), 1200)); }, onLink: (l) => links.push(l) });
    const code = encodeShareCode({ v: 1, n: 'D', p: 4000, c: ['203.0.113.5'], k: b64.encode(identity.publicKey) });
    expect(await connect(phone(net), code)).not.toBeInstanceOf(Error);
    expect(asked).toBe(1);
    expect(links).toHaveLength(1);
  });

  it('can be ended from either side', async () => {
    const net = new SimNet();
    const d = desktop(net);
    const link = await connect(phone(net), d.code()) as Link;
    let closed = 0;
    d.links[0].link.onClose(() => closed++);
    d.h.drop(d.links[0].key);
    expect(closed).toBe(1);
    expect(d.h.links).toBe(0);
  });
});
