import { concatBytes, randomBytes } from '@noble/hashes/utils.js';
import { aead, generateKeyPair, initiate, respond } from './noise';
import type { KeyPair, TransportKeys } from './noise';
import { Framer, Reliable } from './reliable';
import { b64, decodeShareCode } from './sharecode';
import type { Endpoint } from './sharecode';

/**
 * A link between a phone and a desktop over UDP: a Noise IK handshake, then encrypted packets carrying a reliable stream of messages.
 *
 * Packets (the first byte says which):
 *   1 INIT  [idxI u32][noise message 1]            joiner → host, sent to every address at once; this is also the probe
 *   2 RESP  [idxI u32][idxR u32][noise message 2]  host → joiner, only for an INIT it accepts
 *   3 DATA  [idx u32][counter u64][encrypted: kind u8, body]   kind 0 = a reliable segment, 1 = keep-alive, 2 = goodbye
 *
 * A host never answers a packet it cannot decrypt, or one from a device it does not accept, so the port shows nothing to a scan. After the
 * handshake a device is known by its key, not its address: a valid packet from a new address moves the link there (a phone changing network).
 */
export interface UdpSocket {
  send(data: Uint8Array, host: string, port: number): void;
  onMessage(cb: (data: Uint8Array, host: string, port: number) => void): void;
  close(): void;
}

export interface Link {
  send(message: Uint8Array): void;
  onMessage(cb: (m: Uint8Array) => void): void;
  onClose(cb: () => void): void;
  close(): void;
  readonly remote: Endpoint;
}

const PROLOGUE = new TextEncoder().encode('helm-p2p-1');
const INIT = 1;
const RESP = 2;
const DATA = 3;
const KEEPALIVE_MS = 25_000;
const DEAD_MS = 75_000;
export const PROBE_AT = [0, 700, 1500, 2500];

const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const rd32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const idxKey = (b: Uint8Array) => b64.encode(b);

/** One end of an established link. */
class Session implements Link {
  private counter = 0;
  private maxSeen = -1;
  private seen = new Set<number>();
  private rel: Reliable;
  private listeners: ((m: Uint8Array) => void)[] = [];
  private closers: (() => void)[] = [];
  private keep: ReturnType<typeof setInterval>;
  private lastRx = Date.now();
  closed = false;

  constructor(private keys: TransportKeys, readonly localIdx: number, private remoteIdx: number, public remote: Endpoint, private out: (pkt: Uint8Array, to: Endpoint) => void, private gone: (s: Session) => void) {
    const framer = new Framer((m) => this.listeners.forEach((l) => l(m)));
    this.rel = new Reliable({
      send: (seg) => this.transmit(0, seg),
      deliver: (d) => { try { framer.push(d); } catch { this.close(); } },
      dead: () => this.close()
    });
    this.keep = setInterval(() => {
      if (Date.now() - this.lastRx > DEAD_MS) return this.close();
      this.transmit(1, new Uint8Array(0));
    }, KEEPALIVE_MS);
    (this.keep as any).unref?.();
  }

  send(message: Uint8Array) { this.rel.write(Framer.frame(message)); }
  onMessage(cb: (m: Uint8Array) => void) { this.listeners.push(cb); }
  onClose(cb: () => void) { this.closers.push(cb); }
  close() {
    if (this.closed) return;
    // Tell the other end, once and without waiting: if the packet is lost it finds out from the silence instead.
    this.transmit(2, new Uint8Array(0));
    this.closed = true;
    clearInterval(this.keep);
    this.rel.close();
    this.gone(this);
    this.closers.forEach((c) => c());
  }

  private transmit(kind: number, body: Uint8Array) {
    if (this.closed) return;
    const ctr = this.counter++;
    const head = concatBytes(Uint8Array.of(DATA), u32(this.remoteIdx), u32(Math.floor(ctr / 2 ** 32)), u32(ctr % 2 ** 32));
    this.out(concatBytes(head, aead(this.keys.send, ctr, head).encrypt(concatBytes(Uint8Array.of(kind), body))), this.remote);
  }

  /** A DATA packet for this session. Returns false if it does not authenticate or is a replay. */
  receive(pkt: Uint8Array, from: Endpoint): boolean {
    if (this.closed || pkt.length < 1 + 4 + 8 + 16 + 1) return false;
    const ctr = rd32(pkt, 5) * 2 ** 32 + rd32(pkt, 9);
    if (ctr > this.maxSeen + 2048 * 4 && this.maxSeen >= 0) return false;
    if (ctr <= this.maxSeen - 2048 || this.seen.has(ctr)) return false;
    let plain: Uint8Array;
    try { plain = aead(this.keys.recv, ctr, pkt.subarray(0, 13)).decrypt(pkt.subarray(13)); } catch { return false; }
    this.seen.add(ctr);
    if (ctr > this.maxSeen) { this.maxSeen = ctr; for (const s of this.seen) if (s <= ctr - 2048) this.seen.delete(s); }
    this.lastRx = Date.now();
    // Authenticated, so the sender is who it says: follow it if it has moved.
    if (from.host !== this.remote.host || from.port !== this.remote.port) this.remote = from;
    if (plain[0] === 0) this.rel.receive(plain.subarray(1));
    else if (plain[0] === 2) this.close();
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------- the joiner
export interface JoinOptions {
  socket: UdpSocket;
  /** The share code text, or a decoded one. */
  code: string;
  /** This device's key; keep it, it is how the host recognises the device next time. */
  identity: KeyPair;
  /** This device's name, shown to the host. */
  name: string;
  /** Give up after this long. */
  timeoutMs?: number;
  /**
   * A GitHub access token for the person using this phone, sent (encrypted, to the host only) when pairing a new device so the host can
   * check it is the same GitHub user as the one signed in on the computer. It needs no scopes. Not needed for a device the host already knows.
   */
  githubToken?: string;
}

/** Probes every address in the code at once and resolves with the first host that answers. */
export function join(o: JoinOptions): Promise<Link> {
  const { endpoints, hostKey, secret } = decodeShareCode(o.code);
  const payload = new TextEncoder().encode(JSON.stringify({ n: o.name, ...(secret ? { s: b64.encode(secret) } : {}), ...(o.githubToken ? { g: o.githubToken } : {}) }));
  const hs = initiate(o.identity, hostKey, payload, PROLOGUE);
  const idx = randomBytes(4);
  const idxI = rd32(idx, 0);
  const init = concatBytes(Uint8Array.of(INIT), idx, hs.msg1);
  return new Promise((resolve, reject) => {
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => { done = true; timers.forEach(clearTimeout); };
    let session: Session | null = null;
    // The addresses that were probed are the only ones an answer may come from.
    const probed = new Set(endpoints.map((e) => `${e.host}:${e.port}`));
    for (const at of PROBE_AT) timers.push(setTimeout(() => { if (!done) for (const e of endpoints) o.socket.send(init, e.host, e.port); }, at));
    timers.push(setTimeout(() => { if (!done) { stop(); reject(new Error('Could not reach the computer. Is helm running there, with remote connections on, and is the code current?')); } }, o.timeoutMs ?? 6000));
    o.socket.onMessage((data, host, port) => {
      if (session) { if (data[0] === DATA && rd32(data, 1) === session.localIdx) session.receive(data, { host, port }); return; }
      if (done || data[0] !== RESP || data.length < 9 || rd32(data, 1) !== idxI || !probed.has(`${host}:${port}`)) return;
      try {
        const r = hs.finish(data.subarray(9));
        stop();
        done = true;
        session = new Session(r.keys, idxI, rd32(data, 5), { host, port }, (pkt, to) => o.socket.send(pkt, to.host, to.port), () => undefined);
        resolve(session);
      } catch { /* not an answer to our message: ignore it */ }
    });
  });
}

// ---------------------------------------------------------------------------------------------------- the host
export interface HostOptions {
  socket: UdpSocket;
  identity: KeyPair;
  /**
   * Decides whether to accept a device that sent a valid first message. `payload` is what it said about itself (`n` name, `s` secret, `g`
   * GitHub token). Return false and nothing is sent back: the device never learns that anything is listening. May take a while (it can ask
   * GitHub who the token belongs to); repeats of the same first message are ignored meanwhile.
   */
  authorize(deviceKey: Uint8Array, payload: { n?: string; s?: string; g?: string }): { name: string } | false | Promise<{ name: string } | false>;
  onLink(link: Link, device: { key: Uint8Array; name: string }): void;
  /** At most this many first messages a second from one address, and 4x that from all (each costs two key agreements). */
  initsPerSecond?: number;
}

export function host(o: HostOptions) {
  const sessions = new Map<number, Session>();
  const byDevice = new Map<string, Session>();
  const answered = new Map<string, { resp: Uint8Array; at: number; session: Session; addr: string }>();
  const buckets = new Map<string, { n: number; at: number }>();
  const deciding = new Set<string>();
  const limit = o.initsPerSecond ?? 5;
  let global = { n: 0, at: Date.now() };

  const allow = (key: string, max: number, b: { n: number; at: number }) => {
    const t = Date.now();
    if (t - b.at >= 1000) { b.n = 0; b.at = t; }
    return ++b.n <= max;
  };

  o.socket.onMessage((data, hostName, port) => {
    const from = { host: hostName, port };
    if (data[0] === DATA && data.length > 13) {
      const s = sessions.get(rd32(data, 1));
      if (s) s.receive(data, from);
      return;
    }
    if (data[0] !== INIT || data.length < 5 + 96) return;
    const addr = `${hostName}:${port}`;
    if (!allow('g', limit * 4, global)) return;
    let b = buckets.get(addr);
    if (!b) { if (buckets.size > 2000) buckets.clear(); buckets.set(addr, (b = { n: 0, at: Date.now() })); }
    if (!allow(addr, limit, b)) return;

    // A repeat of a first message we already answered (the joiner sends it several times): answer the same way, do not start another link.
    const msg1 = data.subarray(5);
    const dedupe = idxKey(data.subarray(1, 5)) + idxKey(msg1.subarray(0, 32));
    // Only to the address it came from: from anywhere else it is a replay, and gets no answer.
    const prior = answered.get(dedupe);
    if (prior) { if (!prior.session.closed && prior.addr === addr) o.socket.send(prior.resp, hostName, port); return; }
    let hs: ReturnType<typeof respond>;
    try { hs = respond(o.identity, msg1, PROLOGUE); } catch { return; }
    let said: { n?: string; s?: string; g?: string } = {};
    try { said = JSON.parse(new TextDecoder().decode(hs.payload)) || {}; } catch { return; }
    if (deciding.has(dedupe)) return;
    deciding.add(dedupe);
    void Promise.resolve(o.authorize(hs.remoteStatic, said)).catch(() => false as const).then((ok) => {
      deciding.delete(dedupe);
      if (ok) establish(ok, hs, data.slice(0, 5), from, dedupe);
    });
  });

  function establish(ok: { name: string }, hs: ReturnType<typeof respond>, data: Uint8Array, from: { host: string; port: number }, dedupe: string) {
    const hostName = from.host, port = from.port, addr = `${hostName}:${port}`;
    const accepted = hs.accept(new Uint8Array(0));
    let localIdx = rd32(randomBytes(4), 0);
    while (sessions.has(localIdx)) localIdx = rd32(randomBytes(4), 0);
    const deviceId = idxKey(hs.remoteStatic);
    byDevice.get(deviceId)?.close();
    const s = new Session(accepted.keys, localIdx, rd32(data, 1), from, (pkt, to) => o.socket.send(pkt, to.host, to.port), (x) => {
      sessions.delete(x.localIdx);
      if (byDevice.get(deviceId) === x) byDevice.delete(deviceId);
    });
    sessions.set(localIdx, s);
    byDevice.set(deviceId, s);
    const resp = concatBytes(Uint8Array.of(RESP), data.subarray(1, 5), u32(localIdx), accepted.msg2);
    answered.set(dedupe, { resp, at: Date.now(), session: s, addr });
    if (answered.size > 500) for (const [k, v] of answered) if (Date.now() - v.at > 30_000) answered.delete(k);
    o.socket.send(resp, hostName, port);
    o.onLink(s, { key: hs.remoteStatic, name: ok.name });
  }

  return {
    /** Ends every link. */
    close() { for (const s of [...sessions.values()]) s.close(); },
    /** Ends one device's link, if it has one. */
    drop(deviceKey: Uint8Array) { byDevice.get(idxKey(deviceKey))?.close(); },
    get links() { return sessions.size; }
  };
}

export { generateKeyPair, same };
