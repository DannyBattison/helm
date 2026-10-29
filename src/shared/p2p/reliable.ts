/**
 * An ordered, reliable byte stream over datagrams that may be lost, duplicated or reordered: what TCP gives, for one connection, carried
 * inside whatever packets the caller sends. Segments are numbered; the receiver answers every segment with the next number it wants plus a
 * 64-bit map of what it already holds beyond that (selective acknowledgement). The sender keeps a window that grows while things arrive and
 * halves when a loss shows (slow start and additive increase, as in TCP Reno), times retransmissions from a smoothed round trip (RFC 6298)
 * and gives up on a peer that has acknowledged nothing for 30 seconds. It does not decide how the datagrams travel or are protected.
 */
export interface ReliableOptions {
  /** Hands the caller a segment to send in one datagram. */
  send(segment: Uint8Array): void;
  /** Bytes, in order, as they arrive. */
  deliver(data: Uint8Array): void;
  /** Nothing has been acknowledged for too long. */
  dead?(): void;
  /** Payload bytes per segment. Default 1100, small enough for the smallest IPv6 datagram once headers and encryption are added. */
  mss?: number;
  now?(): number;
}

const DATA = 0;
const ACK = 1;
const MIN_RTO = 100;
const MAX_RTO = 2000;
const DEAD_AFTER = 30_000;
const MAX_AHEAD = 4096;

interface Flight { seq: number; data: Uint8Array; sentAt: number; retransmitted: boolean; sacked: boolean }

export class Reliable {
  private mss: number;
  private now: () => number;
  // sending
  private queue: Uint8Array[] = [];
  private queued = 0;
  private nextSeq = 0;
  private flights = new Map<number, Flight>();
  private una = 0;
  private cwnd = 10;
  private ssthresh = 256;
  private recover = -1;
  private srtt = 0;
  private rttvar = 0;
  private rto = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastProgress: number;
  // receiving
  private expected = 0;
  private ahead = new Map<number, Uint8Array>();
  private closed = false;

  constructor(private o: ReliableOptions) {
    this.mss = o.mss ?? 1100;
    this.now = o.now ?? Date.now;
    this.lastProgress = this.now();
  }

  /** Bytes written but not yet acknowledged. */
  get pending() { return this.queued + [...this.flights.values()].reduce((n, f) => n + f.data.length, 0); }

  write(data: Uint8Array) {
    if (this.closed || !data.length) return;
    this.queue.push(data);
    this.queued += data.length;
    this.pump();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flights.clear();
    this.queue = [];
    this.ahead.clear();
  }

  receive(seg: Uint8Array) {
    if (this.closed || seg.length < 5) return;
    const v = new DataView(seg.buffer, seg.byteOffset, seg.byteLength);
    const seq = v.getUint32(1);
    if (seg[0] === DATA) this.onData(seq, seg.subarray(5));
    else if (seg[0] === ACK && seg.length >= 13) this.onAck(seq, v.getUint32(5), v.getUint32(9));
  }

  // ------------------------------------------------------------ receiving
  private onData(seq: number, payload: Uint8Array) {
    if (seq >= this.expected && seq < this.expected + MAX_AHEAD && !this.ahead.has(seq)) {
      this.ahead.set(seq, payload.slice());
      for (let p = this.ahead.get(this.expected); p; p = this.ahead.get(this.expected)) {
        this.ahead.delete(this.expected++);
        this.o.deliver(p);
      }
    }
    // Every segment is answered, a duplicate included: its ack may have been the one that was lost.
    let bits = 0n;
    for (let i = 1; i <= 64; i++) if (this.ahead.has(this.expected + i)) bits |= 1n << BigInt(i - 1);
    const ack = new Uint8Array(13);
    const v = new DataView(ack.buffer);
    ack[0] = ACK;
    v.setUint32(1, this.expected);
    v.setUint32(5, Number(bits >> 32n));
    v.setUint32(9, Number(bits & 0xffffffffn));
    this.o.send(ack);
  }

  // ------------------------------------------------------------ sending
  private pump() {
    if (this.closed) return;
    while (this.flights.size < Math.floor(this.cwnd) && this.queued > 0) {
      const data = this.take(this.mss);
      const f: Flight = { seq: this.nextSeq++, data, sentAt: this.now(), retransmitted: false, sacked: false };
      this.flights.set(f.seq, f);
      this.transmit(f);
    }
    this.arm();
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(Math.min(n, this.queued));
    let at = 0;
    while (at < out.length) {
      const head = this.queue[0];
      const k = Math.min(head.length, out.length - at);
      out.set(head.subarray(0, k), at);
      at += k;
      if (k === head.length) this.queue.shift(); else this.queue[0] = head.subarray(k);
    }
    this.queued -= out.length;
    return out;
  }

  private transmit(f: Flight) {
    const seg = new Uint8Array(5 + f.data.length);
    seg[0] = DATA;
    new DataView(seg.buffer).setUint32(1, f.seq);
    seg.set(f.data, 5);
    this.o.send(seg);
  }

  private onAck(next: number, hi: number, lo: number) {
    const t = this.now();
    let progressed = false;
    // When the newest segment this ack covers was sent: anything sent before it and still missing was overtaken.
    let newest = -1;
    for (const [seq, f] of this.flights) {
      if (seq < next) {
        // A retransmitted segment's ack could be for either send, so it teaches nothing about the round trip (Karn).
        if (!f.retransmitted) { this.sample(t - f.sentAt); newest = Math.max(newest, f.sentAt); }
        this.flights.delete(seq);
        progressed = true;
        this.cwnd += this.cwnd < this.ssthresh ? 1 : 1 / this.cwnd;
      }
    }
    const bits = (BigInt(hi) << 32n) | BigInt(lo);
    let highest = -1;
    for (let i = 1; i <= 64; i++) {
      if (!(bits & (1n << BigInt(i - 1)))) continue;
      const f = this.flights.get(next + i);
      if (f && !f.sacked) { f.sacked = true; progressed = true; if (!f.retransmitted) { this.sample(t - f.sentAt); newest = Math.max(newest, f.sentAt); } }
      highest = next + i;
    }
    this.una = next;
    if (progressed) { this.lastProgress = t; this.rto = Math.min(MAX_RTO, Math.max(MIN_RTO, this.srtt + 4 * this.rttvar || 1000)); }
    // A segment is lost, not late, when three later ones have been acknowledged, or when a later one has and it has been out longer than a
    // round trip should take (so a small window, which never gets three, still recovers without waiting for the timer).
    let lost = false;
    for (const f of this.flights.values()) {
      if (f.sacked || f.retransmitted) continue;
      let later = 0;
      for (let i = 1; i <= 64; i++) if (bits & (1n << BigInt(i - 1)) && next + i > f.seq) later++;
      const overtaken = f.sentAt < newest && this.srtt > 0 && t - f.sentAt > this.srtt * 1.25 + this.rttvar;
      if ((later >= 3 && f.seq < highest) || overtaken) { f.retransmitted = true; f.sentAt = t; this.transmit(f); lost = true; }
    }
    if (lost && this.nextSeq > this.recover) {
      this.ssthresh = Math.max(2, this.cwnd / 2);
      this.cwnd = this.ssthresh;
      this.recover = this.nextSeq;
    }
    this.pump();
  }

  private sample(rtt: number) {
    if (this.srtt === 0) { this.srtt = rtt; this.rttvar = rtt / 2; }
    else { this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - rtt); this.srtt = 0.875 * this.srtt + 0.125 * rtt; }
  }

  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.closed || !this.flights.size) return;
    this.timer = setTimeout(() => this.expire(), this.rto);
    (this.timer as any).unref?.();
  }

  private expire() {
    this.timer = null;
    if (this.closed || !this.flights.size) return;
    const t = this.now();
    if (t - this.lastProgress > DEAD_AFTER) { this.close(); this.o.dead?.(); return; }
    // The oldest unacknowledged segments again, a smaller window, and a longer wait before the next try.
    for (const f of [...this.flights.values()].filter((x) => !x.sacked).slice(0, 2)) { f.retransmitted = true; f.sentAt = t; this.transmit(f); }
    this.ssthresh = Math.max(2, this.cwnd / 2);
    this.cwnd = Math.max(2, this.ssthresh);
    this.recover = this.nextSeq;
    this.rto = Math.min(MAX_RTO, this.rto * 2);
    this.arm();
  }
}

/** Messages on a byte stream: a 4-byte length, then that many bytes. */
export class Framer {
  private chunks: Uint8Array[] = [];
  private have = 0;
  private need = -1;
  constructor(private onMessage: (m: Uint8Array) => void, private max = 256 * 1024 * 1024) {}
  static frame(msg: Uint8Array): Uint8Array {
    const out = new Uint8Array(4 + msg.length);
    new DataView(out.buffer).setUint32(0, msg.length);
    out.set(msg, 4);
    return out;
  }
  /** Takes `n` bytes off the front, copying each byte once. */
  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let at = 0;
    while (at < n) {
      const head = this.chunks[0];
      const k = Math.min(head.length, n - at);
      out.set(head.subarray(0, k), at);
      at += k;
      if (k === head.length) this.chunks.shift(); else this.chunks[0] = head.subarray(k);
    }
    this.have -= n;
    return out;
  }
  push(chunk: Uint8Array) {
    this.chunks.push(chunk);
    this.have += chunk.length;
    for (;;) {
      if (this.need < 0) {
        if (this.have < 4) return;
        this.need = new DataView(this.take(4).buffer).getUint32(0);
        if (this.need > this.max) throw new Error('Message too large');
      }
      if (this.have < this.need) return;
      const msg = this.take(this.need);
      this.need = -1;
      this.onMessage(msg);
    }
  }
}
