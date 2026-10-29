import { concatBytes } from '@noble/hashes/utils.js';
import { aead, generateKeyPair, initiate } from '../src/shared/p2p/noise';
import type { KeyPair, TransportKeys } from '../src/shared/p2p/noise';
import { host } from '../src/shared/p2p/link';
import type { Link, UdpSocket } from '../src/shared/p2p/link';
import { Framer } from '../src/shared/p2p/reliable';

export const PROLOGUE = new TextEncoder().encode('helm-p2p-1');
export const enc = (s: string) => new TextEncoder().encode(s);
export const dec = (b: Uint8Array) => new TextDecoder().decode(b);
export const u32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
export const rd32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at);

/** A socket that records what is sent and lets a test hand it datagrams. */
export class FakeSock implements UdpSocket {
  sent: { data: Uint8Array; host: string; port: number }[] = [];
  cb: ((d: Uint8Array, h: string, p: number) => void) | null = null;
  closed = false;
  send(data: Uint8Array, host: string, port: number) { this.sent.push({ data: data.slice(), host, port }); }
  onMessage(cb: (d: Uint8Array, h: string, p: number) => void) { this.cb = cb; }
  close() { this.closed = true; }
  deliver(data: Uint8Array, host: string, port: number) { this.cb!(data, host, port); }
}

/** One decrypted DATA packet. */
export interface Opened { idx: number; ctr: number; kind: number; body: Uint8Array; to: string }

export function open(pkt: Uint8Array, keys: TransportKeys): Opened | null {
  if (pkt[0] !== 3) return null;
  const ctr = rd32(pkt, 5) * 2 ** 32 + rd32(pkt, 9);
  const plain = aead(keys.recv, ctr, pkt.subarray(0, 13)).decrypt(pkt.subarray(13));
  return { idx: rd32(pkt, 1), ctr, kind: plain[0], body: plain.subarray(1), to: '' };
}

/** A DATA packet as the far end of a link would build it. */
export function dataPacket(keys: TransportKeys, toIdx: number, ctr: number, kind: number, body: Uint8Array = new Uint8Array(0)) {
  const head = concatBytes(Uint8Array.of(3), u32(toIdx), u32(Math.floor(ctr / 2 ** 32)), u32(ctr % 2 ** 32));
  return concatBytes(head, aead(keys.send, ctr, head).encrypt(concatBytes(Uint8Array.of(kind), body)));
}

/** A reliable-stream segment carrying `payload` as sequence number `seq`. */
export const segment = (seq: number, payload: Uint8Array) => concatBytes(Uint8Array.of(0), u32(seq), payload);
export const frameOf = (text: string) => Framer.frame(enc(text));

export function mkHost(over: { initsPerSecond?: number; authorize?: (key: Uint8Array, said: any) => any } = {}) {
  const sock = new FakeSock();
  const identity = generateKeyPair();
  const links: { link: Link; name: string; key: Uint8Array }[] = [];
  let asked = 0;
  const h = host({
    socket: sock, identity, initsPerSecond: over.initsPerSecond,
    authorize: (key, said) => { asked++; return over.authorize ? over.authorize(key, said) : { name: said.n ?? 'phone' }; },
    onLink: (link, d) => links.push({ link, ...d })
  });
  return { sock, identity, links, h, asked: () => asked };
}

let nextIdx = 1000;
/** The phone's side of a handshake, done by hand so a test controls every packet. */
export function mkPhone(identity: KeyPair, key = generateKeyPair(), at = { host: '198.51.100.7', port: 5555 }, said: object = { n: 'phone' }) {
  const idx = nextIdx++;
  const hs = initiate(key, identity.publicKey, enc(JSON.stringify(said)), PROLOGUE);
  const init = concatBytes(Uint8Array.of(1), u32(idx), hs.msg1);
  return { key, idx, at, init, hs, keys: null as TransportKeys | null, hostIdx: 0 };
}
export type Phone = ReturnType<typeof mkPhone>;

/** Sends the INIT and finishes the handshake from the RESP the host sent back. */
export async function pair(t: ReturnType<typeof mkHost>, p: Phone, flush: () => Promise<unknown>) {
  const before = t.sock.sent.length;
  t.sock.deliver(p.init, p.at.host, p.at.port);
  await flush();
  const resp = t.sock.sent.slice(before).find((s) => s.data[0] === 2 && s.host === p.at.host && s.port === p.at.port);
  if (!resp) return null;
  const r = p.hs.finish(resp.data.subarray(9));
  p.keys = r.keys;
  p.hostIdx = rd32(resp.data, 5);
  return resp.data;
}

/** Everything the host sent to this phone's address as DATA, decrypted. */
export const received = (t: ReturnType<typeof mkHost>, p: Phone, since = 0) =>
  t.sock.sent.slice(since).filter((s) => s.data[0] === 3).map((s) => ({ ...open(s.data, p.keys!)!, to: `${s.host}:${s.port}` }));
export const acksTo = (t: ReturnType<typeof mkHost>, p: Phone, since = 0) => received(t, p, since).filter((o) => o.kind === 0 && o.body[0] === 1);
