import { randomBytes } from 'node:crypto';

/** The pieces of STUN (RFC 5389) helm needs: ask a public server what address and port it sees a packet come from. */
const COOKIE = 0x2112a442;

/** A packet that is STUN rather than helm's own: the magic cookie at offset 4 and a length that adds up. A helm packet starts with 1, 2 or 3. */
export function isStun(b: Uint8Array): boolean {
  if (b.length < 20 || (b[0] & 0xc0) !== 0) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return v.getUint32(4) === COOKIE && v.getUint16(2) + 20 === b.length;
}

export function bindingRequest(): { packet: Uint8Array; id: string } {
  const packet = new Uint8Array(20);
  const v = new DataView(packet.buffer);
  v.setUint16(0, 0x0001);
  v.setUint32(4, COOKIE);
  const tx = randomBytes(12);
  packet.set(tx, 8);
  return { packet, id: tx.toString('hex') };
}

/** The address a binding response reports (XOR-MAPPED-ADDRESS, or the older MAPPED-ADDRESS), with the transaction it answers. */
export function parseBindingResponse(b: Uint8Array): { id: string; host: string; port: number } | null {
  if (!isStun(b)) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint16(0) !== 0x0101) return null;
  const id = Buffer.from(b.subarray(8, 20)).toString('hex');
  let found: { host: string; port: number } | null = null;
  for (let at = 20; at + 4 <= b.length;) {
    const type = v.getUint16(at), len = v.getUint16(at + 2), body = at + 4;
    if (body + len > b.length) return null;
    const xor = type === 0x0020;
    if ((xor || type === 0x0001) && len >= 8) {
      const family = b[body + 1];
      const port = v.getUint16(body + 2) ^ (xor ? COOKIE >>> 16 : 0);
      if (family === 1) {
        const a = [0, 1, 2, 3].map((i) => b[body + 4 + i] ^ (xor ? b[4 + i] : 0));
        const r = { host: a.join('.'), port };
        if (xor) return { id, ...r };
        found = found ?? r;
      } else if (family === 2 && len >= 20) {
        const mask = new Uint8Array(16);
        mask.set(b.subarray(4, 20));
        const a = Array.from({ length: 8 }, (_, i) => ((b[body + 4 + i * 2] ^ (xor ? mask[i * 2] : 0)) << 8 | (b[body + 5 + i * 2] ^ (xor ? mask[i * 2 + 1] : 0))).toString(16));
        const r = { host: a.join(':'), port };
        if (xor) return { id, ...r };
        found = found ?? r;
      }
    }
    at = body + len + ((4 - (len % 4)) % 4);
  }
  return found && { id, ...found };
}

/** Sends binding requests and matches answers. The caller feeds it every STUN packet that arrives on the socket the requests went out of. */
export class StunClient {
  private pending = new Map<string, (r: { host: string; port: number }) => void>();
  constructor(private send: (packet: Uint8Array, host: string, port: number) => void) {}

  /** Called with a packet for which `isStun` is true. */
  handle(b: Uint8Array) {
    const r = parseBindingResponse(b);
    if (r) this.pending.get(r.id)?.({ host: r.host, port: r.port });
  }

  /** What `server` sees this socket as. Asks up to three times, 2.5 s apart; null if it never answers. */
  async query(serverHost: string, serverPort: number, timeoutMs = 2500): Promise<{ host: string; port: number } | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { packet, id } = bindingRequest();
      const answer = new Promise<{ host: string; port: number } | null>((resolve) => {
        const t = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
        this.pending.set(id, (r) => { clearTimeout(t); this.pending.delete(id); resolve(r); });
      });
      this.send(packet, serverHost, serverPort);
      const r = await answer;
      if (r) return r;
    }
    return null;
  }
}
