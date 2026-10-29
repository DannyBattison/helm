import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Framer, Reliable } from '../src/shared/p2p/reliable';
import type { ReliableOptions } from '../src/shared/p2p/reliable';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const ack = (next: number, bits: bigint | number[] = 0n) => {
  const b = typeof bits === 'bigint' ? bits : bits.reduce((m, i) => m | (1n << BigInt(i - 1)), 0n);
  const out = new Uint8Array(13);
  const v = new DataView(out.buffer);
  out[0] = 1; v.setUint32(1, next); v.setUint32(5, Number(b >> 32n)); v.setUint32(9, Number(b & 0xffffffffn));
  return out;
};
const data = (seq: number, payload: number[] | Uint8Array = [seq & 255]) => {
  const out = new Uint8Array(5 + payload.length);
  out[0] = 0; new DataView(out.buffer).setUint32(1, seq); out.set(payload, 5);
  return out;
};
const seqOf = (s: Uint8Array) => new DataView(s.buffer, s.byteOffset).getUint32(1);
const readAck = (s: Uint8Array) => { const v = new DataView(s.buffer, s.byteOffset); return { next: v.getUint32(1), bits: (BigInt(v.getUint32(5)) << 32n) | BigInt(v.getUint32(9)) }; };

function make(o: Partial<ReliableOptions> = {}) {
  const sent: Uint8Array[] = [];
  const delivered: Uint8Array[] = [];
  const times: number[] = [];
  let dead = 0;
  const r = new Reliable({ send: (s) => { sent.push(s); times.push(Date.now()); }, deliver: (d) => delivered.push(d), dead: () => dead++, ...o });
  const dataSegs = () => sent.filter((s) => s[0] === 0);
  const acks = () => sent.filter((s) => s[0] === 1);
  return { r, sent, delivered, times, dead: () => dead, dataSegs, acks };
}

describe('writing', () => {
  it('cuts a write into segments of at most the mss, and counts what is not yet acknowledged', () => {
    const t = make({ mss: 1000 });
    t.r.write(new Uint8Array(2500).fill(7));
    expect(t.dataSegs().map((s) => s.length - 5)).toEqual([1000, 1000, 500]);
    expect(t.dataSegs().map(seqOf)).toEqual([0, 1, 2]);
    expect(t.r.pending).toBe(2500);
    t.r.receive(ack(2));
    expect(t.r.pending).toBe(500);
    t.r.receive(ack(3));
    expect(t.r.pending).toBe(0);
  });

  it('uses 1100 bytes by default', () => {
    const t = make();
    t.r.write(new Uint8Array(1101));
    expect(t.dataSegs().map((s) => s.length - 5)).toEqual([1100, 1]);
  });

  it('fills a segment from several small writes, in order', () => {
    const t = make({ mss: 500 });
    for (let i = 0; i < 4; i++) t.r.write(new Uint8Array(300).fill(i + 1));
    const all = t.dataSegs();
    expect(all.map((s) => s.length - 5)).toEqual([300, 300, 300, 300]);
    // Segments go out as soon as the window allows, so each write is its own here; queue them behind a full window to see them joined.
    const u = make({ mss: 500 });
    u.r.write(new Uint8Array(500 * 10));
    for (let i = 0; i < 4; i++) u.r.write(new Uint8Array(300).fill(i + 1));
    expect(u.dataSegs()).toHaveLength(10);
    u.r.receive(ack(10));
    const joined = u.dataSegs().slice(10);
    expect(joined.map((s) => s.length - 5)).toEqual([500, 500, 200]);
    expect([...joined[0].subarray(5, 305)].every((x) => x === 1)).toBe(true);
    expect([...joined[0].subarray(305)].every((x) => x === 2)).toBe(true);
    expect([...joined[1].subarray(5, 105)].every((x) => x === 2)).toBe(true);
    expect([...joined[1].subarray(105, 405)].every((x) => x === 3)).toBe(true);
    expect([...joined[2].subarray(5)].every((x) => x === 4)).toBe(true);
    expect(u.r.pending).toBe(5000 + 1200 - 5000);
  });

  it('ignores an empty write and a write after close', () => {
    const t = make();
    t.r.write(new Uint8Array(0));
    expect(t.sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    t.r.close();
    t.r.write(new Uint8Array(10));
    expect(t.sent).toHaveLength(0);
    expect(t.r.pending).toBe(0);
  });

  it('close stops the retransmit timer and drops everything, and a closed end ignores packets', () => {
    const t = make();
    t.r.write(new Uint8Array(10));
    expect(vi.getTimerCount()).toBe(1);
    t.r.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(t.r.pending).toBe(0);
    t.r.receive(data(0)); t.r.receive(ack(1));
    expect(t.delivered).toHaveLength(0);
    expect(t.acks()).toHaveLength(0);
    vi.advanceTimersByTime(60_000);
    expect(t.sent).toHaveLength(1);
    expect(t.dead()).toBe(0);
    t.r.close(); // twice is fine
  });
});

describe('receiving', () => {
  it('ignores segments that are too short or of an unknown kind, answering nothing', () => {
    const t = make();
    t.r.receive(new Uint8Array(0)); t.r.receive(new Uint8Array(4));
    t.r.receive(Uint8Array.of(9, 0, 0, 0, 0, 1)); t.r.receive(Uint8Array.of(2, 0, 0, 0, 0));
    expect(t.sent).toHaveLength(0);
    expect(t.delivered).toHaveLength(0);
  });

  it('ignores an ack that is too short to carry its bitmap', () => {
    const t = make();
    t.r.write(new Uint8Array(10));
    t.r.receive(ack(1).subarray(0, 12));
    expect(t.r.pending).toBe(10);
  });

  it('delivers in order and answers each segment with the next one it wants', () => {
    const t = make();
    t.r.receive(data(0, [1, 2])); t.r.receive(data(1, [3]));
    expect(t.delivered.map((d) => [...d])).toEqual([[1, 2], [3]]);
    expect(t.acks().map(readAck)).toEqual([{ next: 1, bits: 0n }, { next: 2, bits: 0n }]);
  });

  it('holds segments that arrive early and delivers them when the gap is filled', () => {
    const t = make();
    t.r.receive(data(2)); t.r.receive(data(1));
    expect(t.delivered).toHaveLength(0);
    expect(t.acks().map(readAck)).toEqual([{ next: 0, bits: 0b10n }, { next: 0, bits: 0b11n }]);
    t.r.receive(data(0));
    expect(t.delivered.map((d) => d[0])).toEqual([0, 1, 2]);
    expect(readAck(t.acks()[2])).toEqual({ next: 3, bits: 0n });
  });

  it('answers a duplicate again, but delivers it once', () => {
    const t = make();
    t.r.receive(data(0)); t.r.receive(data(0)); t.r.receive(data(3)); t.r.receive(data(3));
    expect(t.delivered).toHaveLength(1);
    expect(t.acks().map(readAck)).toEqual([{ next: 1, bits: 0n }, { next: 1, bits: 0n }, { next: 1, bits: 1n << 1n }, { next: 1, bits: 1n << 1n }]);
  });

  it('copies the payload, so the caller may reuse its buffer', () => {
    const t = make();
    const buf = data(1, [5, 5]);
    t.r.receive(buf);
    buf.fill(0);
    t.r.receive(data(0, [1]));
    expect([...t.delivered[1]]).toEqual([5, 5]);
  });

  it('reports the 64 segments after the next wanted in the bitmap, bit 0 being the first', () => {
    const t = make();
    for (const s of [1, 32, 33, 64, 65, 100]) t.r.receive(data(s));
    const last = readAck(t.acks().at(-1)!);
    expect(last.next).toBe(0);
    // Wanted is 0, so segment s is bit s-1 of 64: 1 -> 0, 32 -> 31, 33 -> 32, 64 -> 63. 65 and 100 are beyond the map.
    expect(last.bits).toBe((1n << 0n) | (1n << 31n) | (1n << 32n) | (1n << 63n));
    // Filling in 0 moves "wanted" to 2, and the map shifts with it.
    t.r.receive(data(0));
    expect(readAck(t.acks().at(-1)!)).toEqual({ next: 2, bits: (1n << 29n) | (1n << 30n) | (1n << 61n) | (1n << 62n) });
  });

  it('ignores segments too far ahead or already delivered, but still answers them', () => {
    const t = make();
    t.r.receive(data(0));
    t.r.receive(data(1 + 4096)); // MAX_AHEAD past the next wanted: not held
    t.r.receive(data(4096)); // the last one that is held
    t.r.receive(data(0, [9])); // behind: ignored
    expect(t.delivered).toHaveLength(1);
    expect(t.acks()).toHaveLength(4);
    expect(readAck(t.acks()[3])).toEqual({ next: 1, bits: 0n });
    // Fill the whole gap: only the held one comes out, the refused one never does.
    for (let s = 1; s < 4096; s++) t.r.receive(data(s));
    expect(t.delivered).toHaveLength(4097);
    expect(readAck(t.acks().at(-1)!).next).toBe(4097);
    t.r.receive(data(4097));
    expect(t.delivered).toHaveLength(4098);
  });
});

describe('sending: acknowledgements', () => {
  it('ignores an ack for what is already acknowledged, and one for nothing sent', () => {
    const t = make({ mss: 10 });
    t.r.receive(ack(0)); t.r.receive(ack(5, [3]));
    t.r.write(new Uint8Array(30));
    t.r.receive(ack(3));
    const n = t.sent.length;
    t.r.receive(ack(3)); t.r.receive(ack(1)); t.r.receive(ack(0));
    expect(t.sent.length).toBe(n);
    expect(t.r.pending).toBe(0);
  });

  it('keeps a segment that was selectively acknowledged out of the pending count only when the cumulative ack reaches it', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(40));
    t.r.receive(ack(0, [2]));
    expect(t.r.pending).toBe(40);
    t.r.receive(ack(0, [2])); // again: nothing changes
    expect(t.dataSegs()).toHaveLength(4);
    t.r.receive(ack(4));
    expect(t.r.pending).toBe(0);
  });

  it('does not resend a selectively acknowledged segment when the timer fires', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(30));
    t.r.receive(ack(0, [1, 2])); // 1 and 2 are held by the peer
    t.r.receive(ack(0, [1, 2]));
    const before = t.dataSegs().length;
    vi.advanceTimersByTime(1000);
    const resent = t.dataSegs().slice(before).map(seqOf);
    expect(resent).toEqual([0]);
  });
});

describe('sending: retransmission', () => {
  it('resends the oldest unacknowledged segments after the timeout, at most two, and backs off to the 2 second cap', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(50));
    t.times.length = 0;
    vi.advanceTimersByTime(999);
    expect(t.dataSegs()).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(t.dataSegs().slice(5).map(seqOf)).toEqual([0, 1]);
    vi.advanceTimersByTime(1999);
    expect(t.dataSegs()).toHaveLength(7); // doubled to 2000
    vi.advanceTimersByTime(1);
    expect(t.dataSegs()).toHaveLength(9);
    // And it stays at 2000 rather than growing, every 2 s until the peer is declared dead.
    t.times.length = 0;
    vi.advanceTimersByTime(20_000);
    const batches = [...new Set(t.times)];
    expect(batches).toHaveLength(10);
    expect(batches.slice(1).map((x, i) => x - batches[i]).every((g) => g === 2000)).toBe(true);
  });

  it('takes a round trip sample from a fresh ack to set the timeout, but not from a retransmitted segment (Karn)', () => {
    // Fresh: a 50 ms round trip gives srtt 50, rttvar 25, rto = max(100, 150) = 150 ms.
    const fresh = make({ mss: 10 });
    fresh.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(50);
    fresh.r.receive(ack(1));
    fresh.r.write(new Uint8Array(10));
    const n = fresh.dataSegs().length;
    vi.advanceTimersByTime(149);
    expect(fresh.dataSegs()).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(fresh.dataSegs()).toHaveLength(n + 1);

    // Retransmitted: the ack arrives 1100 ms after the first send; counting it would give a 2000 ms timeout, ignoring it leaves the default 1000.
    const karn = make({ mss: 10 });
    karn.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(1000); // times out, resends, rto doubles
    vi.advanceTimersByTime(100);
    karn.r.receive(ack(1));
    karn.r.write(new Uint8Array(10));
    const m = karn.dataSegs().length;
    vi.advanceTimersByTime(999);
    expect(karn.dataSegs()).toHaveLength(m);
    vi.advanceTimersByTime(1);
    expect(karn.dataSegs()).toHaveLength(m + 1);
  });

  it('does not take a round trip sample from a retransmitted segment that is selectively acknowledged either', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(20));
    vi.advanceTimersByTime(1000); // both resent
    vi.advanceTimersByTime(500);
    t.r.receive(ack(0, [1])); // seq 1 was retransmitted: no sample
    t.r.receive(ack(2));
    t.r.write(new Uint8Array(10));
    const n = t.dataSegs().length;
    vi.advanceTimersByTime(999);
    expect(t.dataSegs()).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(t.dataSegs()).toHaveLength(n + 1);
  });

  it('resends a segment at once when three later ones have been acknowledged, and not when only two have', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(50));
    t.r.receive(ack(0, [1, 2]));
    expect(t.dataSegs()).toHaveLength(5);
    t.r.receive(ack(0, [1, 2, 3]));
    expect(t.dataSegs().slice(5).map(seqOf)).toEqual([0]);
    // Only once: it is now a retransmission, and a further ack does not resend it again.
    t.r.receive(ack(0, [1, 2, 3, 4]));
    expect(t.dataSegs()).toHaveLength(6);
  });

  it('does not count acknowledgements beyond the segment, or the segment itself, as later ones', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(50));
    // The hole is seq 3; the three acknowledged ones (0..2 are cumulative, 4 is later): only one later, so no resend.
    t.r.receive(ack(3, [2]));
    expect(t.dataSegs()).toHaveLength(5);
  });

  it('resends a segment overtaken by a later one that has been acknowledged when it has been out longer than a round trip', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(10)); // seq 0 at t=0
    vi.advanceTimersByTime(900);
    t.r.write(new Uint8Array(10)); // seq 1 at t=900
    vi.advanceTimersByTime(100);
    t.r.receive(ack(0, [1])); // seq 1 acknowledged after 100 ms; seq 0 has been out for 1000
    expect(t.dataSegs().slice(2).map(seqOf)).toEqual([0]);
  });

  it('does not resend an older segment just because a later one is acknowledged quickly, if it is not late', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(1);
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(100);
    t.r.receive(ack(0, [1])); // round trip about 100 ms, seq 0 out for 101: within what a round trip allows
    expect(t.dataSegs()).toHaveLength(2);
  });

  it('does not resend a newer segment because an older one was acknowledged', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(800);
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(100);
    t.r.receive(ack(1)); // seq 0 acknowledged after 900 ms, seq 1 outstanding for 100 ms
    expect(t.dataSegs()).toHaveLength(2);
  });

  it('halves its window on a loss, so less goes out afterwards, and only once per window of data', () => {
    const lossy = make({ mss: 10 });
    lossy.r.write(new Uint8Array(400));
    expect(lossy.dataSegs()).toHaveLength(10); // initial window
    lossy.r.receive(ack(0, [1, 2, 3])); // seq 0 lost: window 10 -> 5
    expect(lossy.dataSegs()).toHaveLength(11); // the resend
    lossy.r.receive(ack(4)); // four acknowledged: 5 + 4/5; six in flight, window 5
    expect(lossy.dataSegs()).toHaveLength(11);
    // A second loss in the same window does not halve again.
    lossy.r.receive(ack(4, [1, 2, 3])); // seq 4 now looks lost, but it is the same flight
    expect(lossy.dataSegs()).toHaveLength(12);
    lossy.r.receive(ack(8));
    // window is still about 5, not 2: it sent new data once the flight shrank below it
    expect(lossy.dataSegs().length).toBeGreaterThan(12);

    const clean = make({ mss: 10 });
    clean.r.write(new Uint8Array(400));
    clean.r.receive(ack(4));
    expect(clean.dataSegs().length).toBeGreaterThan(14); // window grew by 4: 8 new segments
    expect(clean.dataSegs().length).toBe(10 + 8);
  });

  it('after a timeout shrinks the window and starts slow again', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(400));
    vi.advanceTimersByTime(1000);
    expect(t.dataSegs()).toHaveLength(12);
    t.r.receive(ack(10)); // everything so far arrives: window was 10 -> 5, grown by 10 in slow start up to ssthresh
    // ssthresh is 5 and the window is 5 so growth is additive: about 5 + 10/5 = 7 in flight at most
    const out = t.dataSegs().length - 12;
    expect(out).toBeLessThanOrEqual(7);
    expect(out).toBeGreaterThanOrEqual(5);
  });
});

describe('giving up', () => {
  it('declares the peer dead once, after 30 seconds without progress, and stops', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(29_999);
    expect(t.dead()).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(t.dead()).toBe(1);
    const n = t.sent.length;
    vi.advanceTimersByTime(120_000);
    expect(t.dead()).toBe(1);
    expect(t.sent).toHaveLength(n);
    expect(vi.getTimerCount()).toBe(0);
    expect(t.r.pending).toBe(0);
  });

  it('counts from the last progress, not from the first write', () => {
    const t = make({ mss: 10 });
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(20_000);
    t.r.receive(ack(1));
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(25_000);
    expect(t.dead()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(t.dead()).toBe(1);
  });

  it('works without a dead callback', () => {
    const r = new Reliable({ send: () => undefined, deliver: () => undefined });
    r.write(new Uint8Array(10));
    vi.advanceTimersByTime(60_000);
    expect(r.pending).toBe(0);
  });

  it('measures time with the now option', () => {
    let clock = 5_000;
    const t = make({ now: () => clock });
    t.r.write(new Uint8Array(10));
    vi.advanceTimersByTime(1000); // the timer fires, but by the custom clock no time has passed
    expect(t.dead()).toBe(0);
    clock += 31_000;
    vi.advanceTimersByTime(2000);
    expect(t.dead()).toBe(1);
  });
});

describe('framer', () => {
  it('delivers several messages from one chunk, and keeps a partial one for the next', () => {
    const got: number[] = [];
    const f = new Framer((m) => got.push(m.length));
    const a = Framer.frame(new Uint8Array(3)), b = Framer.frame(new Uint8Array(5));
    f.push(Uint8Array.of(...a, ...b.subarray(0, 6)));
    expect(got).toEqual([3]);
    f.push(b.subarray(6));
    expect(got).toEqual([3, 5]);
  });
  it('waits for a whole length prefix', () => {
    const got: number[] = [];
    const f = new Framer((m) => got.push(m.length));
    f.push(Uint8Array.of(0, 0)); f.push(Uint8Array.of(0)); expect(got).toEqual([]);
    f.push(Uint8Array.of(2, 9, 9));
    expect(got).toEqual([2]);
  });
  it('accepts a message of exactly the maximum and refuses one byte more', () => {
    const f = new Framer(() => undefined, 10);
    expect(() => f.push(Framer.frame(new Uint8Array(10)))).not.toThrow();
    expect(() => f.push(Framer.frame(new Uint8Array(11)).subarray(0, 4))).toThrow('Message too large');
  });
});
