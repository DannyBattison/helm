import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '../src/shared/p2p/noise';
import { Framer } from '../src/shared/p2p/reliable';
import { sameHost } from '../src/shared/p2p/link';
import { acksTo, dataPacket, dec, enc, frameOf, mkHost, mkPhone, pair, rd32, received, segment, u32 } from './p2p-proto-harness';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const flush = () => vi.advanceTimersByTimeAsync(0);

/** A host with one phone already linked. */
async function linked(over: Parameters<typeof mkHost>[0] = {}) {
  const t = mkHost(over);
  const p = mkPhone(t.identity);
  await pair(t, p, flush);
  const link = t.links[0].link;
  const msgs: string[] = [];
  link.onMessage((m) => msgs.push(dec(m)));
  const closed = { n: 0 };
  link.onClose(() => closed.n++);
  let ctr = 0;
  /** Sends a message as reliable segment `seq` from the phone. */
  const say = (text: string, seq: number, c = ctr++, from = p.at) => t.sock.deliver(dataPacket(p.keys!, p.hostIdx, c, 0, segment(seq, frameOf(text))), from.host, from.port);
  return { t, p, link, msgs, closed, say, next: () => ctr };
}

describe('sameHost', () => {
  it.each([
    ['1.2.3.4', '1.2.3.4'], ['EXAMPLE.com', 'example.com'], ['::', '0:0:0:0:0:0:0:0'], ['::1', '0:0:0:0:0:0:0:1'], ['1::', '1:0:0:0:0:0:0:0'],
    ['2a00:1::5', '2a00:1:0:0:0:0:0:5'], ['2A00:0001::0005', '2a00:1:0:0:0:0:0:5'], ['[2a00:1::5]', '2a00:1:0:0:0:0:0:5'], ['1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8'],
    ['::ffff:10.0.0.1', '10.0.0.1'], ['::FFFF:10.0.0.1', '10.0.0.1'], ['[::ffff:10.0.0.1]', '10.0.0.1']
  ])('%s is %s', (input, want) => {
    expect(sameHost(input)).toBe(want);
  });
  it('keeps a mapped address with hex groups apart from IPv4, and different addresses different', () => {
    expect(sameHost('::ffff:a00:1')).toBe('0:0:0:0:0:ffff:a00:1');
    expect(sameHost('2a00:1::5')).not.toBe(sameHost('2a00:1::6'));
    expect(sameHost('1::2')).not.toBe(sameHost('1:2::'));
    expect(sameHost('a.example')).not.toBe(sameHost('b.example'));
  });
});

describe('host: first messages', () => {
  it('links a device that is accepted, naming it, and answers with its own index', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity, undefined, undefined, { n: 'Pixel' });
    const resp = (await pair(t, p, flush))!;
    expect(resp[0]).toBe(2);
    expect(rd32(resp, 1)).toBe(p.idx);
    expect(t.links).toHaveLength(1);
    expect(t.links[0].name).toBe('Pixel');
    expect(t.links[0].key).toEqual(p.key.publicKey);
    expect(t.h.links).toBe(1);
    expect(t.links[0].link.remote).toEqual(p.at);
  });

  it('passes the payload to authorize', async () => {
    const seen: unknown[] = [];
    const t = mkHost({ authorize: (k: Uint8Array, said: unknown) => { seen.push(said); return false; } });
    await pair(t, mkPhone(t.identity, undefined, undefined, { n: 'x', s: 'secret', g: 'tok' }), flush);
    expect(seen).toEqual([{ n: 'x', s: 'secret', g: 'tok' }]);
  });

  it('ignores what is too short to be a first message, or of a kind it does not take', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity);
    const good = p.init;
    for (const bad of [good.subarray(0, 100), good.subarray(0, 5), new Uint8Array(0), Uint8Array.of(1)]) t.sock.deliver(bad, '1.1.1.1', 1);
    const other = good.slice(); other[0] = 9; t.sock.deliver(other, '1.1.1.1', 1);
    const resp = good.slice(); resp[0] = 2; t.sock.deliver(resp, '1.1.1.1', 1);
    await flush();
    expect(t.asked()).toBe(0);
    expect(t.sock.sent).toHaveLength(0);
    // the shortest first message that is long enough is read (and refused here only because it is not a real handshake)
    t.sock.deliver(good, '1.1.1.1', 1);
    await flush();
    expect(t.asked()).toBe(1);
  });

  it('says nothing to a first message it cannot read, or whose payload is not JSON', async () => {
    const t = mkHost();
    t.sock.deliver(new Uint8Array(200).fill(1), '1.1.1.1', 1);
    const key = generateKeyPair();
    // a valid handshake whose payload is not JSON
    const { initiate } = await import('../src/shared/p2p/noise');
    const hs = initiate(key, t.identity.publicKey, enc('not json'), enc('helm-p2p-1'));
    const raw = new Uint8Array([1, 0, 0, 0, 7, ...hs.msg1]);
    t.sock.deliver(raw, '1.1.1.1', 2);
    // JSON null reads as an empty payload
    const hs2 = initiate(key, t.identity.publicKey, enc('null'), enc('helm-p2p-1'));
    t.sock.deliver(new Uint8Array([1, 0, 0, 0, 8, ...hs2.msg1]), '1.1.1.1', 3);
    await flush();
    expect(t.asked()).toBe(1);
    expect(t.sock.sent.filter((s) => s.host !== '1.1.1.1' || s.port !== 3)).toHaveLength(0);
  });

  it('sends nothing when authorize says no, says no later, rejects, or the answer is false from a promise', async () => {
    for (const authorize of [() => false, () => Promise.resolve(false), () => Promise.reject(new Error('github down'))]) {
      const t = mkHost({ authorize });
      const p = mkPhone(t.identity);
      expect(await pair(t, p, flush)).toBeNull();
      expect(t.sock.sent).toHaveLength(0);
      expect(t.links).toHaveLength(0);
      expect(t.h.links).toBe(0);
    }
  });

  it('can be asked again after authorize rejected or refused (a repeat is not stuck as "deciding")', async () => {
    let n = 0;
    const t = mkHost({ authorize: () => (++n === 1 ? Promise.reject(new Error('down')) : { name: 'ok' }) });
    const p = mkPhone(t.identity);
    expect(await pair(t, p, flush)).toBeNull();
    expect(await pair(t, p, flush)).not.toBeNull();
    expect(t.links[0].name).toBe('ok');
  });

  // Found as a bug and fixed: authorize throwing synchronously used to escape the socket callback and leave the first message marked as
  // "deciding" forever. A throw is treated like a rejection: refuse, stay running, and allow a later retry.
  it('refuses and stays usable when authorize throws synchronously', async () => {
    let n = 0;
    const t = mkHost({ authorize: () => { if (++n === 1) throw new Error('boom'); return { name: 'ok' }; } });
    const p = mkPhone(t.identity);
    expect(() => t.sock.deliver(p.init, p.at.host, p.at.port)).not.toThrow();
    await flush();
    expect(await pair(t, p, flush)).not.toBeNull();
  });

  it('does not start a second link while the first message is still being decided', async () => {
    let release!: (v: { name: string }) => void;
    const t = mkHost({ authorize: () => new Promise((r) => { release = r; }) });
    const p = mkPhone(t.identity);
    t.sock.deliver(p.init, p.at.host, p.at.port);
    t.sock.deliver(p.init, p.at.host, p.at.port);
    await flush();
    expect(t.asked()).toBe(1);
    release({ name: 'late' });
    await flush();
    expect(t.links).toHaveLength(1);
  });
});

describe('host: repeats of an answered first message', () => {
  it('re-sends the same answer to the same address, without a second link or another decision', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity);
    const first = (await pair(t, p, flush))!;
    for (let i = 0; i < 3; i++) { t.sock.deliver(p.init, p.at.host, p.at.port); await flush(); }
    const resps = t.sock.sent.filter((s) => s.data[0] === 2);
    expect(resps).toHaveLength(4);
    expect(resps.every((r) => r.host === p.at.host && r.port === p.at.port && Buffer.compare(r.data, first) === 0)).toBe(true);
    expect(t.asked()).toBe(1);
    expect(t.links).toHaveLength(1);
  });

  it('gives a replay from another address nothing at all', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity);
    await pair(t, p, flush);
    const n = t.sock.sent.length;
    t.sock.deliver(p.init, '192.0.2.66', 1);
    t.sock.deliver(p.init, p.at.host, p.at.port + 1);
    await flush();
    expect(t.sock.sent).toHaveLength(n);
    expect(t.asked()).toBe(1);
  });

  it('does not answer a repeat once the link has ended, and does not start a new one', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity);
    await pair(t, p, flush);
    t.h.drop(p.key.publicKey);
    const n = t.sock.sent.length;
    t.sock.deliver(p.init, p.at.host, p.at.port);
    await flush();
    expect(t.sock.sent).toHaveLength(n);
    expect(t.links).toHaveLength(1);
    expect(t.h.links).toBe(0);
  });

  it('treats the same message with another index as a new first message', async () => {
    const t = mkHost();
    const p = mkPhone(t.identity);
    await pair(t, p, flush);
    const other = p.init.slice(); other.set(u32(p.idx + 50), 1);
    t.sock.deliver(other, p.at.host, p.at.port);
    await flush();
    expect(t.asked()).toBe(2);
    expect(t.links).toHaveLength(2);
  });
});

describe('host: rate limits', () => {
  it('reads only initsPerSecond first messages a second from one address, and more after the second is up', async () => {
    const t = mkHost({ initsPerSecond: 2, authorize: () => false });
    for (let i = 0; i < 6; i++) t.sock.deliver(mkPhone(t.identity).init, '1.1.1.1', 1);
    await flush();
    expect(t.asked()).toBe(2);
    await vi.advanceTimersByTimeAsync(999);
    t.sock.deliver(mkPhone(t.identity).init, '1.1.1.1', 1);
    await flush();
    expect(t.asked()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    t.sock.deliver(mkPhone(t.identity).init, '1.1.1.1', 1);
    await flush();
    expect(t.asked()).toBe(3);
  });

  it('counts addresses separately by port, and defaults to 5 a second', async () => {
    const t = mkHost({ authorize: () => false });
    for (let i = 0; i < 8; i++) t.sock.deliver(mkPhone(t.identity).init, '1.1.1.1', 1);
    expect(t.asked()).toBe(5);
    await flush();
    for (let i = 0; i < 3; i++) t.sock.deliver(mkPhone(t.identity).init, '1.1.1.1', 2);
    expect(t.asked()).toBe(8);
  });

  it('allows four times that from all addresses together', async () => {
    const t = mkHost({ initsPerSecond: 2, authorize: () => false });
    for (let i = 0; i < 20; i++) t.sock.deliver(mkPhone(t.identity).init, `10.0.0.${i}`, 1);
    await flush();
    expect(t.asked()).toBe(8);
    await vi.advanceTimersByTimeAsync(1000);
    for (let i = 0; i < 20; i++) t.sock.deliver(mkPhone(t.identity).init, `10.0.1.${i}`, 1);
    await flush();
    expect(t.asked()).toBe(16);
  });

  it('applies the limit to repeats of an answered message too', async () => {
    const t = mkHost({ initsPerSecond: 2 });
    const p = mkPhone(t.identity);
    await pair(t, p, flush); // 1st
    const count = () => t.sock.sent.filter((s) => s.data[0] === 2).length;
    t.sock.deliver(p.init, p.at.host, p.at.port); // 2nd
    t.sock.deliver(p.init, p.at.host, p.at.port); // refused
    expect(count()).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    t.sock.deliver(p.init, p.at.host, p.at.port);
    expect(count()).toBe(3);
  });

  it('spends the shared allowance on replays from other addresses too', async () => {
    const t = mkHost({ initsPerSecond: 2 });
    const p = mkPhone(t.identity);
    await pair(t, p, flush); // 1 of 8
    for (let i = 0; i < 7; i++) t.sock.deliver(p.init, `192.0.2.${i}`, 1);
    const count = () => t.sock.sent.filter((s) => s.data[0] === 2).length;
    await vi.advanceTimersByTimeAsync(0);
    expect(count()).toBe(1);
    // the phone itself is within its own allowance (2) but the shared one (8) is used up
    t.sock.deliver(p.init, p.at.host, p.at.port);
    expect(count()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    t.sock.deliver(p.init, p.at.host, p.at.port);
    expect(count()).toBe(2);
  });

  it('forgets the per-address counts once it holds more than 2000 of them, so memory stays bounded', async () => {
    const t = mkHost({ initsPerSecond: 700 });
    const p = mkPhone(t.identity);
    await pair(t, p, flush);
    const count = () => t.sock.sent.filter((s) => s.data[0] === 2).length;
    for (let i = 1; i < 700; i++) t.sock.deliver(p.init, p.at.host, p.at.port);
    expect(count()).toBe(700);
    t.sock.deliver(p.init, p.at.host, p.at.port); // its 701st in the second: refused
    expect(count()).toBe(700);
    // 2001 other addresses replay the message (cheap: nothing is answered), which pushes the table over 2000 entries
    for (let i = 0; i < 2001; i++) t.sock.deliver(p.init, `10.${i >> 8}.${i & 255}.1`, 9);
    expect(count()).toBe(700);
    t.sock.deliver(p.init, p.at.host, p.at.port); // its count was forgotten with the rest
    expect(count()).toBe(701);
  });

  it('forgets answered messages older than 30 seconds once it holds more than 500', { timeout: 60_000 }, async () => {
    const t = mkHost({ initsPerSecond: 1e6 });
    const key = generateKeyPair();
    const base = mkPhone(t.identity, key);
    const make = (idx: number) => { const x = base.init.slice(); x.set(u32(idx), 1); return x; };
    for (let i = 0; i < 300; i++) t.sock.deliver(make(i), '9.9.9.9', 1);
    await flush();
    await vi.advanceTimersByTimeAsync(31_000);
    for (let i = 300; i < 501; i++) { t.sock.deliver(make(i), '9.9.9.9', 1); }
    await flush();
    expect(t.asked()).toBe(501);
    // Every earlier link was replaced by the next, so a repeat of a remembered message gets nothing...
    const resps = () => t.sock.sent.filter((s) => s.data[0] === 2).length;
    const n = resps();
    t.sock.deliver(make(400), '9.9.9.9', 1);
    await flush();
    expect(resps()).toBe(n);
    expect(t.asked()).toBe(501);
    // ...while a message that was forgotten is read as new, and linked.
    t.sock.deliver(make(0), '9.9.9.9', 1);
    await flush();
    expect(t.asked()).toBe(502);
    expect(resps()).toBe(n + 1);
  });
});

describe('host: devices and links', () => {
  it('replaces and closes the old link when the same device connects again', async () => {
    const t = mkHost();
    const key = generateKeyPair();
    const a = mkPhone(t.identity, key);
    await pair(t, a, flush);
    let closed = 0;
    t.links[0].link.onClose(() => closed++);
    const b = mkPhone(t.identity, key, { host: '198.51.100.8', port: 6000 });
    const since = t.sock.sent.length;
    await pair(t, b, flush);
    expect(closed).toBe(1);
    expect(t.h.links).toBe(1);
    // the old end was told
    expect(received(t, a, since).filter((o) => o.kind === 2)).toHaveLength(1);
    // the old index no longer reaches anything, the new one does
    const msgs: string[] = [];
    t.links[1].link.onMessage((m) => msgs.push(dec(m)));
    t.sock.deliver(dataPacket(a.keys!, a.hostIdx, 0, 0, segment(0, frameOf('old'))), a.at.host, a.at.port);
    t.sock.deliver(dataPacket(b.keys!, b.hostIdx, 0, 0, segment(0, frameOf('new'))), b.at.host, b.at.port);
    expect(msgs).toEqual(['new']);
    // and dropping by key reaches the new one
    t.h.drop(key.publicKey);
    expect(t.h.links).toBe(0);
  });

  it('keeps links of different devices side by side; drop ends one, close ends all, and both are harmless when repeated', async () => {
    const t = mkHost();
    const a = mkPhone(t.identity), b = mkPhone(t.identity, undefined, { host: '198.51.100.8', port: 1 });
    await pair(t, a, flush); await pair(t, b, flush);
    expect(a.hostIdx).not.toBe(b.hostIdx);
    expect(t.h.links).toBe(2);
    const closes = [0, 0];
    t.links.forEach((l, i) => l.link.onClose(() => closes[i]++));
    t.h.drop(generateKeyPair().publicKey);
    expect(t.h.links).toBe(2);
    t.h.drop(a.key.publicKey);
    expect(closes).toEqual([1, 0]);
    expect(t.h.links).toBe(1);
    t.h.drop(a.key.publicKey);
    t.h.close();
    t.h.close();
    expect(closes).toEqual([1, 1]);
    expect(t.h.links).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a packet for an index it does not have, or one too short to be data', async () => {
    const { t, p, msgs, say } = await linked();
    const n = t.sock.sent.length;
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx + 1, 0, 0, segment(0, frameOf('x'))), p.at.host, p.at.port);
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx, 0, 0, segment(0, frameOf('x'))).subarray(0, 13), p.at.host, p.at.port);
    t.sock.deliver(Uint8Array.of(3, 0, 0, 0, 0), p.at.host, p.at.port);
    expect(t.sock.sent).toHaveLength(n);
    // shorter than the smallest real packet (header 13 + tag 16 + kind 1) but long enough to be looked up
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx, 0, 0, segment(0, frameOf('x'))).subarray(0, 29), p.at.host, p.at.port);
    expect(t.sock.sent).toHaveLength(n);
    expect(msgs).toEqual([]);
    say('real', 0);
    expect(msgs).toEqual(['real']);
  });
});

describe('session: messages', () => {
  it('delivers messages from the phone in order and acknowledges them', async () => {
    const { t, p, msgs, say } = await linked();
    const since = t.sock.sent.length;
    say('b', 1); say('a', 0); say('c', 2);
    expect(msgs).toEqual(['a', 'b', 'c']);
    expect(acksTo(t, p, since).map((o) => rd32(o.body, 1))).toEqual([0, 2, 3]);
  });

  it('sends messages to the phone as framed segments, each packet with a new counter', async () => {
    const { t, p, link } = await linked();
    const since = t.sock.sent.length;
    link.send(enc('hello')); link.send(enc('world'));
    const out = received(t, p, since).filter((o) => o.kind === 0 && o.body[0] === 0);
    expect(out.map((o) => o.idx)).toEqual([p.idx, p.idx]);
    expect(out[1].ctr).toBeGreaterThan(out[0].ctr);
    const f = new Framer((m) => got.push(dec(m)));
    const got: string[] = [];
    for (const o of out) f.push(o.body.subarray(5));
    expect(got).toEqual(['hello', 'world']);
  });

  it('tells every listener, and the same message again to a late one only from then on', async () => {
    const { link, say } = await linked();
    const a: string[] = [], b: string[] = [];
    link.onMessage((m) => a.push(dec(m)));
    say('one', 0);
    link.onMessage((m) => b.push(dec(m)));
    say('two', 1);
    expect(a).toEqual(['one', 'two']);
    expect(b).toEqual(['two']);
  });
});

describe('session: replay protection', () => {
  it('accepts a packet once; the same counter again is not processed (and not acknowledged)', async () => {
    const { t, p, msgs, say } = await linked();
    const since = t.sock.sent.length;
    const pkt = dataPacket(p.keys!, p.hostIdx, 7, 0, segment(0, frameOf('x')));
    t.sock.deliver(pkt, p.at.host, p.at.port);
    t.sock.deliver(pkt, p.at.host, p.at.port);
    expect(msgs).toEqual(['x']);
    expect(acksTo(t, p, since)).toHaveLength(1);
    // the same segment under a fresh counter is a retransmission by the phone: acknowledged again
    say('x', 0, 8);
    expect(acksTo(t, p, since)).toHaveLength(2);
    expect(msgs).toEqual(['x']);
  });

  it('accepts counters out of order inside the window, once each', async () => {
    const { t, p, say } = await linked();
    const since = t.sock.sent.length;
    say('a', 0, 10); say('b', 1, 5); say('b', 1, 5); say('c', 2, 11); say('b', 1, 10);
    expect(acksTo(t, p, since)).toHaveLength(3);
  });

  it('rejects a counter more than 2048 behind the newest, and accepts one exactly at the edge', async () => {
    const { t, p, say } = await linked();
    say('a', 0, 5000);
    const since = t.sock.sent.length;
    say('x', 1, 5000 - 2048); // too old
    expect(acksTo(t, p, since)).toHaveLength(0);
    say('x', 1, 5000 - 2047);
    expect(acksTo(t, p, since)).toHaveLength(1);
  });

  it('rejects a counter more than 8192 ahead of the newest, and accepts one exactly at the edge', async () => {
    const { t, p, say } = await linked();
    say('a', 0, 100);
    const since = t.sock.sent.length;
    say('x', 1, 100 + 8193);
    expect(acksTo(t, p, since)).toHaveLength(0);
    say('x', 1, 100 + 8192);
    expect(acksTo(t, p, since)).toHaveLength(1);
    // the window moved with it: 100 is now far behind
    say('y', 2, 101);
    expect(acksTo(t, p, since)).toHaveLength(1);
  });

  it('takes any counter first, including one above 2^32', async () => {
    const { t, p, msgs, say } = await linked();
    say('big', 0, 2 ** 32 + 77);
    say('next', 1, 2 ** 32 + 78);
    say('old', 2, 77);
    expect(msgs).toEqual(['big', 'next']);
    void t; void p;
  });

  it('does not let a replay of an old packet through after the window has moved on and forgotten it', async () => {
    const { msgs, t, p, say } = await linked();
    const first = dataPacket(p.keys!, p.hostIdx, 1, 0, segment(0, frameOf('once')));
    t.sock.deliver(first, p.at.host, p.at.port);
    for (let c = 2; c < 3000; c += 500) say('filler', 0, c);
    t.sock.deliver(first, p.at.host, p.at.port);
    expect(msgs).toEqual(['once']);
  });

  it('rejects a damaged packet without remembering its counter', async () => {
    const { t, p, msgs, closed } = await linked();
    const since = t.sock.sent.length;
    const good = dataPacket(p.keys!, p.hostIdx, 3, 0, segment(0, frameOf('x')));
    for (const at of [13, 20, good.length - 1]) { const bad = good.slice(); bad[at] ^= 1; t.sock.deliver(bad, p.at.host, p.at.port); }
    const head = good.slice(); head[12] ^= 1; // the counter is part of what is authenticated
    t.sock.deliver(head, p.at.host, p.at.port);
    expect(acksTo(t, p, since)).toHaveLength(0);
    expect(msgs).toEqual([]);
    t.sock.deliver(good, p.at.host, p.at.port);
    expect(msgs).toEqual(['x']);
    expect(closed.n).toBe(0);
  });

  it('rejects a packet made with another key', async () => {
    const { t, p, msgs } = await linked();
    const other = mkPhone(t.identity);
    await pair(t, other, flush);
    t.sock.deliver(dataPacket(other.keys!, p.hostIdx, 0, 0, segment(0, frameOf('x'))), p.at.host, p.at.port);
    expect(msgs).toEqual([]);
  });
});

describe('session: roaming', () => {
  it('follows an authenticated packet to its new address, host or port, and replies there', async () => {
    const { t, p, link, say } = await linked();
    say('a', 0, 0, { host: '100.64.0.9', port: 4444 });
    expect(link.remote).toEqual({ host: '100.64.0.9', port: 4444 });
    let n = t.sock.sent.length;
    link.send(enc('to the new place'));
    expect(t.sock.sent.slice(n).every((s) => s.host === '100.64.0.9' && s.port === 4444)).toBe(true);
    expect(t.sock.sent.length).toBeGreaterThan(n);
    say('b', 1, 1, { host: '100.64.0.9', port: 4445 });
    expect(link.remote.port).toBe(4445);
    n = t.sock.sent.length;
    link.send(enc('again'));
    expect(t.sock.sent[n].port).toBe(4445);
    void p;
  });

  it('does not move for a packet that fails to authenticate or repeats an old one', async () => {
    const { t, p, link, say } = await linked();
    say('a', 0, 0);
    const bad = dataPacket(p.keys!, p.hostIdx, 1, 0, segment(1, frameOf('b'))); bad[bad.length - 1] ^= 1;
    t.sock.deliver(bad, '203.0.113.99', 1);
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx, 0, 0, segment(1, frameOf('b'))), '203.0.113.99', 1);
    expect(link.remote).toEqual(p.at);
  });
});

describe('session: keep-alive and silence', () => {
  it('sends a keep-alive every 25 seconds while the phone is quiet, then closes the link after 75 seconds of silence', async () => {
    const { t, p, closed } = await linked();
    const since = t.sock.sent.length;
    await vi.advanceTimersByTimeAsync(24_999);
    expect(received(t, p, since)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(received(t, p, since).map((o) => o.kind)).toEqual([1]);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(received(t, p, since).map((o) => o.kind)).toEqual([1, 1]);
    expect(closed.n).toBe(0); // 50 s of silence: still waiting
    await vi.advanceTimersByTimeAsync(25_000);
    expect(closed.n).toBe(1); // 75 s: over the limit, on the tick that finds it
    expect(received(t, p, since).map((o) => o.kind)).toEqual([1, 1, 2]); // the last thing it says is goodbye
    expect(t.h.links).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(closed.n).toBe(1);
  });

  it('stays up as long as it hears the phone, whatever it sends (keep-alives included)', async () => {
    const { t, p, closed } = await linked();
    for (let i = 1; i <= 12; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      t.sock.deliver(dataPacket(p.keys!, p.hostIdx, i, 1), p.at.host, p.at.port);
    }
    expect(closed.n).toBe(0);
    expect(t.h.links).toBe(1);
  });
});

describe('session: closing', () => {
  it('says goodbye once, tells listeners once, and then ignores everything', async () => {
    const { t, p, link, closed, msgs, say } = await linked();
    const second = { n: 0 };
    link.onClose(() => second.n++);
    const since = t.sock.sent.length;
    link.close(); link.close();
    expect(closed.n).toBe(1);
    expect(second.n).toBe(1);
    expect(received(t, p, since).map((o) => o.kind)).toEqual([2]);
    expect(t.h.links).toBe(0);
    const n = t.sock.sent.length;
    link.send(enc('after'));
    say('late', 0, 50);
    expect(t.sock.sent).toHaveLength(n);
    expect(msgs).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes when the phone says goodbye, replying with its own, once', async () => {
    const { t, p, closed } = await linked();
    const since = t.sock.sent.length;
    const bye = dataPacket(p.keys!, p.hostIdx, 4, 2);
    t.sock.deliver(bye, p.at.host, p.at.port);
    t.sock.deliver(bye, p.at.host, p.at.port);
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx, 5, 2), p.at.host, p.at.port);
    expect(closed.n).toBe(1);
    expect(received(t, p, since).filter((o) => o.kind === 2)).toHaveLength(1);
    expect(t.h.links).toBe(0);
  });

  it('ignores a goodbye that does not authenticate', async () => {
    const { t, p, closed } = await linked();
    const bye = dataPacket(p.keys!, p.hostIdx, 4, 2); bye[bye.length - 1] ^= 1;
    t.sock.deliver(bye, p.at.host, p.at.port);
    expect(closed.n).toBe(0);
  });

  it('closes on a message too large to accept', async () => {
    const { t, p, closed, msgs } = await linked();
    t.sock.deliver(dataPacket(p.keys!, p.hostIdx, 0, 0, segment(0, Uint8Array.of(0xff, 0xff, 0xff, 0xff))), p.at.host, p.at.port);
    expect(closed.n).toBe(1);
    expect(msgs).toEqual([]);
    expect(t.h.links).toBe(0);
  });

  it('closes when the phone stops acknowledging what it sends for 30 seconds', async () => {
    const { t, p, link, closed } = await linked();
    link.send(enc('anyone there?'));
    // keep the link alive from the phone's side, but never acknowledge
    for (let i = 1; i <= 7; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      t.sock.deliver(dataPacket(p.keys!, p.hostIdx, i, 1), p.at.host, p.at.port);
    }
    expect(closed.n).toBe(1);
    expect(t.h.links).toBe(0);
  });
});
