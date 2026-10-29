import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Framer, Reliable } from '../src/shared/p2p/reliable';
import { SimNet } from './p2p-simnet';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/** Two ends joined by a SimNet. `a` writes; what `b` receives is collected. */
function pair(net: SimNet) {
  const got: Uint8Array[] = [];
  const A = net.socket('a', 1), B = net.socket('b', 1);
  let dead = 0;
  const a: Reliable = new Reliable({ send: (s) => A.send(s, 'b', 1), deliver: () => undefined, dead: () => dead++ });
  const b: Reliable = new Reliable({ send: (s) => B.send(s, 'a', 1), deliver: (d) => got.push(d) });
  A.onMessage((d) => a.receive(d));
  B.onMessage((d) => b.receive(d));
  return { a, b, got, dead: () => dead };
}
const same = (a: Uint8Array, b: Uint8Array) => Buffer.compare(a, b) === 0;
const join = (parts: Uint8Array[]) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { o.set(p, at); at += p.length; } return o; };
const payload = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 8)) & 255);

describe('reliable stream', () => {
  it('delivers a megabyte in order over a clean link', async () => {
    const net = new SimNet();
    const { a, got } = pair(net);
    const data = payload(1_000_000);
    a.write(data);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(same(join(got), data)).toBe(true);
  });

  it('delivers everything in order through loss, duplication and reordering', async () => {
    const net = new SimNet(7);
    net.loss = 0.05; net.dupe = 0.05; net.maxDelay = 60;
    const { a, got } = pair(net);
    const data = payload(400_000);
    a.write(data);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(same(join(got), data)).toBe(true);
  });

  it('still gets there on a very bad link', async () => {
    const net = new SimNet(11);
    net.loss = 0.2; net.dupe = 0.1; net.maxDelay = 100;
    const { a, got } = pair(net);
    const data = payload(100_000);
    a.write(data);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(same(join(got), data)).toBe(true);
  });

  it('backs off: heavy loss does not make it flood the link', async () => {
    const net = new SimNet(3);
    net.loss = 0.3;
    const { a } = pair(net);
    a.write(payload(200_000));
    await vi.advanceTimersByTimeAsync(60_000);
    // 200 KB is about 182 segments; a sender that ignored loss would send thousands of times that.
    const dataPackets = net.sent.filter((p) => p.from === 'a:1').length;
    expect(dataPackets).toBeLessThan(182 * 6);
  });

  it('keeps writing after a quiet spell, and in both directions', async () => {
    const net = new SimNet();
    const { a, b, got } = pair(net);
    a.write(payload(5000));
    await vi.advanceTimersByTimeAsync(60_000);
    a.write(payload(3000));
    b.write(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(join(got).length).toBe(8000);
  });

  it('gives up on a peer that goes silent', async () => {
    const net = new SimNet();
    net.loss = 1;
    const { a, dead } = pair(net);
    a.write(payload(5000));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dead()).toBe(1);
  });
});

describe('framer', () => {
  it('turns a byte stream, however it is chopped, back into messages', () => {
    const msgs: string[] = [];
    const f = new Framer((m) => msgs.push(new TextDecoder().decode(m)));
    const stream = join(['one', '', 'three three three'].map((s) => Framer.frame(new TextEncoder().encode(s))));
    for (let i = 0; i < stream.length; i += 3) f.push(stream.subarray(i, i + 3));
    expect(msgs).toEqual(['one', '', 'three three three']);
  });
  it('refuses an enormous message', () => {
    const f = new Framer(() => undefined, 100);
    expect(() => f.push(new Uint8Array([0, 0, 1, 0]))).toThrow();
  });
});
