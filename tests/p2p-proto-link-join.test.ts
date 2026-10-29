import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concatBytes } from '@noble/hashes/utils.js';
import { generateKeyPair, respond } from '../src/shared/p2p/noise';
import { join, PROBE_AT } from '../src/shared/p2p/link';
import type { Link } from '../src/shared/p2p/link';
import { b64, encodeShareCode } from '../src/shared/p2p/sharecode';
import { dataPacket, dec, enc, FakeSock, frameOf, open, PROLOGUE, rd32, segment, u32 } from './p2p-proto-harness';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const SECRET = new Uint8Array(16).fill(3);

/** A joiner with a hand-made host on the other end of the socket. */
function setup(opts: { secret?: boolean; token?: string; timeoutMs?: number; candidates?: string[] } = {}) {
  const hostKey = generateKeyPair();
  const sock = new FakeSock();
  const identity = generateKeyPair();
  const code = encodeShareCode({ v: 1, n: 'Desk', p: 4000, c: opts.candidates ?? ['203.0.113.5', '[2a00:1::5]:4001', 'desk.example:4002'], k: b64.encode(hostKey.publicKey), ...(opts.secret === false ? {} : { s: b64.encode(SECRET) }) });
  let result: Link | Error | undefined;
  const p = join({ socket: sock, code, identity, name: 'My phone', githubToken: opts.token, timeoutMs: opts.timeoutMs });
  p.then((l) => { result = l; }, (e) => { result = e; });
  const inits = () => sock.sent.filter((s) => s.data[0] === 1);
  /** What the host makes of the first probe. */
  const hear = () => {
    const first = inits()[0].data;
    const hs = respond(hostKey, first.subarray(5), PROLOGUE);
    return { hs, idx: rd32(first, 1), said: JSON.parse(dec(hs.payload)), first };
  };
  const answer = (h: ReturnType<typeof hear>, idxR = 777) => {
    const acc = h.hs.accept(new Uint8Array(0));
    return { acc, resp: concatBytes(Uint8Array.of(2), u32(h.idx), u32(idxR), acc.msg2), idxR };
  };
  return { sock, hostKey, identity, p, inits, hear, answer, result: () => result };
}
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('join: probing', () => {
  it('sends the first message to every address in the code at the probe times, and says who it is', async () => {
    const t = setup();
    await flush();
    expect(t.inits()).toHaveLength(3);
    expect(t.inits().map((s) => `${s.host}:${s.port}`)).toEqual(['203.0.113.5:4000', '2a00:1::5:4001', 'desk.example:4002']);
    expect(PROBE_AT).toEqual([0, 700, 1500, 2500]);
    for (let i = 1; i < PROBE_AT.length; i++) {
      await vi.advanceTimersByTimeAsync(PROBE_AT[i] - PROBE_AT[i - 1] - 1);
      expect(t.inits()).toHaveLength(3 * i);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.inits()).toHaveLength(3 * (i + 1));
    }
    await vi.advanceTimersByTimeAsync(3000);
    expect(t.inits()).toHaveLength(12);
    // every probe is the same message
    expect(new Set(t.inits().map((s) => Buffer.from(s.data).toString('hex'))).size).toBe(1);
    const h = t.hear();
    expect(h.said.n).toBe('My phone');
    expect(h.said.s).toBe(b64.encode(SECRET));
    expect(h.said.g).toBeUndefined();
    expect(h.hs.remoteStatic).toEqual(t.identity.publicKey);
  });

  it('leaves out the secret when the code has none, and adds a GitHub token when given one', async () => {
    const a = setup({ secret: false });
    await flush();
    expect(a.hear().said).toEqual({ n: 'My phone' });
    const b = setup({ token: 'gho_abc' });
    await flush();
    expect(b.hear().said).toEqual({ n: 'My phone', s: b64.encode(SECRET), g: 'gho_abc' });
  });

  it('throws at once for a code that cannot be read', () => {
    expect(() => join({ socket: new FakeSock(), code: 'nope', identity: generateKeyPair(), name: 'x' })).toThrow('not a helm share code');
  });

  it('stops probing once a host has answered', async () => {
    const t = setup();
    await flush();
    const h = t.hear();
    t.sock.deliver(t.answer(h).resp, '203.0.113.5', 4000);
    const link = await t.p;
    expect(link.remote).toEqual({ host: '203.0.113.5', port: 4000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.inits()).toHaveLength(3);
  });
});

describe('join: timing out', () => {
  it('gives up after 6 seconds with a message fit to show', async () => {
    const t = setup();
    await vi.advanceTimersByTimeAsync(5999);
    expect(t.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.result()).toBeInstanceOf(Error);
    expect((t.result() as Error).message).toMatch(/^Could not reach the computer\. Is helm running there, with remote connections on, and is the code current\?$/);
    const n = t.inits().length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.inits()).toHaveLength(n);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses timeoutMs when given, even a short one that cuts the probing off', async () => {
    const t = setup({ timeoutMs: 800 });
    await vi.advanceTimersByTimeAsync(799);
    expect(t.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.result()).toBeInstanceOf(Error);
    expect(t.inits()).toHaveLength(6); // probes at 0 and 700 only
  });

  it('waits longer when timeoutMs is longer', async () => {
    const t = setup({ timeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(t.result()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.result()).toBeInstanceOf(Error);
  });

  it('ignores an answer that arrives after it gave up', async () => {
    const t = setup({ timeoutMs: 1000 });
    await flush();
    const h = t.hear();
    await vi.advanceTimersByTimeAsync(1000);
    t.sock.deliver(t.answer(h).resp, '203.0.113.5', 4000);
    await flush();
    expect(t.result()).toBeInstanceOf(Error);
  });

  it('does not reject later once it has connected', async () => {
    const t = setup();
    await flush();
    t.sock.deliver(t.answer(t.hear()).resp, '203.0.113.5', 4000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.result()).not.toBeInstanceOf(Error);
  });
});

describe('join: which answers count', () => {
  it('takes an answer only from an address that was probed, port included', async () => {
    const t = setup();
    await flush();
    const { resp } = t.answer(t.hear());
    t.sock.deliver(resp, '192.0.2.1', 4000);
    t.sock.deliver(resp, '203.0.113.5', 4001);
    t.sock.deliver(resp, '203.0.113.6', 4000);
    t.sock.deliver(resp, 'other.example', 4002);
    await flush();
    expect(t.result()).toBeUndefined();
    t.sock.deliver(resp, 'desk.example', 4002);
    await flush();
    expect(t.result()).toBeDefined();
    expect((t.result() as Link).remote).toEqual({ host: 'desk.example', port: 4002 });
  });

  it('recognises a probed IPv6 address however the answer spells it', async () => {
    const t = setup();
    await flush();
    t.sock.deliver(t.answer(t.hear()).resp, '2A00:0001:0:0:0:0:0:0005', 4001);
    await flush();
    expect((t.result() as Link).remote).toEqual({ host: '2A00:0001:0:0:0:0:0:0005', port: 4001 });
  });

  it('recognises an IPv4 address the socket reports as mapped to IPv6', async () => {
    const t = setup();
    await flush();
    t.sock.deliver(t.answer(t.hear()).resp, '::ffff:203.0.113.5', 4000);
    await flush();
    expect(t.result()).toBeDefined();
  });

  it('ignores an answer to another message, one that is too short, and anything that is not an answer', async () => {
    const t = setup();
    await flush();
    const h = t.hear();
    const { resp } = t.answer(h);
    const other = resp.slice(); other.set(u32(h.idx + 1), 1);
    const wrongType = resp.slice(); wrongType[0] = 1;
    for (const bad of [other, wrongType, resp.subarray(0, 8), resp.subarray(0, 9), resp.subarray(0, 40), new Uint8Array(0), Uint8Array.of(2), dataPacket({ send: new Uint8Array(32), recv: new Uint8Array(32), handshakeHash: new Uint8Array(32) }, h.idx, 0, 0)]) t.sock.deliver(bad, '203.0.113.5', 4000);
    await flush();
    expect(t.result()).toBeUndefined();
    t.sock.deliver(resp, '203.0.113.5', 4000);
    await flush();
    expect(t.result()).toBeDefined();
  });

  it('does not connect on a damaged answer, and does not throw', async () => {
    const t = setup();
    await flush();
    const { resp } = t.answer(t.hear());
    const damaged = resp.slice(); damaged[damaged.length - 1] ^= 1;
    expect(() => t.sock.deliver(damaged, '203.0.113.5', 4000)).not.toThrow();
    await flush();
    expect(t.result()).toBeUndefined();
  });

  // Found as a bug and fixed: finish() used to change the handshake state before it checked the answer, so one damaged answer long enough
  // to be tried (>= 48 bytes after the indexes) made the real answer fail for good and the join time out.
  it('still connects when a damaged answer arrived before the real one', async () => {
    const t = setup();
    await flush();
    const { resp } = t.answer(t.hear());
    const damaged = resp.slice(); damaged[damaged.length - 1] ^= 1;
    t.sock.deliver(damaged, '203.0.113.5', 4000);
    t.sock.deliver(resp, '203.0.113.5', 4000);
    await flush();
    expect(t.result()).toBeDefined();
    expect(t.result()).not.toBeInstanceOf(Error);
  });
});

describe('join: the link afterwards', () => {
  async function connected() {
    const t = setup();
    await flush();
    const h = t.hear();
    const { acc, resp, idxR } = t.answer(h);
    t.sock.deliver(resp, '203.0.113.5', 4000);
    const link = await t.p;
    const msgs: string[] = [];
    link.onMessage((m) => msgs.push(dec(m)));
    return { ...t, h, acc, resp, idxR, link, msgs, say: (text: string, seq: number, ctr: number, idx = h.idx) => t.sock.deliver(dataPacket(acc.keys, idx, ctr, 0, segment(seq, frameOf(text))), '203.0.113.5', 4000) };
  }

  it('sends to the index the host chose, and decrypts with the keys agreed', async () => {
    const t = await connected();
    const n = t.sock.sent.length;
    t.link.send(enc('hi host'));
    const out = t.sock.sent.slice(n).map((s) => ({ ...open(s.data, t.acc.keys)!, host: s.host, port: s.port }));
    expect(out).toHaveLength(1);
    expect(out[0].idx).toBe(t.idxR);
    expect([out[0].host, out[0].port]).toEqual(['203.0.113.5', 4000]);
    expect(out[0].kind).toBe(0);
  });

  it('delivers data for its own index only', async () => {
    const t = await connected();
    t.say('wrong index', 0, 0, t.h.idx + 1);
    expect(t.msgs).toEqual([]);
    t.say('right', 0, 1);
    expect(t.msgs).toEqual(['right']);
  });

  it('treats a repeat of the answer after success as nothing: no second link, no data', async () => {
    const t = await connected();
    const n = t.sock.sent.length;
    t.sock.deliver(t.resp, '203.0.113.5', 4000);
    t.sock.deliver(t.resp, '203.0.113.5', 4000);
    t.say('still fine', 0, 0);
    expect(t.msgs).toEqual(['still fine']);
    expect(t.sock.sent.length).toBeGreaterThanOrEqual(n); // only acknowledgements
    expect(t.sock.sent.slice(n).every((s) => s.data[0] === 3)).toBe(true);
  });

  it('ignores a packet that is not DATA once connected, including probes answered late', async () => {
    const t = await connected();
    const n = t.sock.sent.length;
    t.sock.deliver(Uint8Array.of(1, 0, 0, 0, 0), '203.0.113.5', 4000);
    t.sock.deliver(new Uint8Array(0), '203.0.113.5', 4000);
    expect(t.sock.sent).toHaveLength(n);
  });

  it('follows the host if it moves, and says goodbye when closed', async () => {
    const t = await connected();
    t.sock.deliver(dataPacket(t.acc.keys, t.h.idx, 0, 0, segment(0, frameOf('moved'))), '198.18.0.1', 9);
    expect(t.link.remote).toEqual({ host: '198.18.0.1', port: 9 });
    const n = t.sock.sent.length;
    let closed = 0;
    t.link.onClose(() => closed++);
    t.link.close();
    const bye = t.sock.sent.slice(n).map((s) => open(s.data, t.acc.keys)!).filter((o) => o.kind === 2);
    expect(bye).toHaveLength(1);
    expect(closed).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes by itself after 75 seconds of silence from the host (keep-alives every 25 seconds in between)', async () => {
    const t = await connected();
    let closed = 0;
    t.link.onClose(() => closed++);
    const n = t.sock.sent.length;
    await vi.advanceTimersByTimeAsync(50_000);
    expect(closed).toBe(0);
    expect(t.sock.sent.slice(n).map((s) => open(s.data, t.acc.keys)!.kind)).toEqual([1, 1]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(closed).toBe(1);
  });
});
