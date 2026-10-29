import { describe, expect, it, vi } from 'vitest';
import { StunClient, bindingRequest, isStun, parseBindingResponse } from '../src/core/p2p/stun';

const COOKIE = 0x2112a442;
type Attr = { type: number; body: Uint8Array };

/** A STUN message of `type` for transaction `tx` carrying `attrs`, each padded to 4 bytes as the RFC says. */
function message(tx: Uint8Array, attrs: Attr[], type = 0x0101): Uint8Array {
  const parts = attrs.map((a) => {
    const pad = (4 - (a.body.length % 4)) % 4;
    const b = new Uint8Array(4 + a.body.length + pad);
    const v = new DataView(b.buffer);
    v.setUint16(0, a.type); v.setUint16(2, a.body.length);
    b.set(a.body, 4);
    return b;
  });
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(20 + total);
  const v = new DataView(out.buffer);
  v.setUint16(0, type); v.setUint16(2, total); v.setUint32(4, COOKIE);
  out.set(tx, 8);
  let at = 20;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const cookieBytes = [0x21, 0x12, 0xa4, 0x42];
const tx = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
const idOf = (t: Uint8Array) => Buffer.from(t).toString('hex');

function v4Attr(type: number, host: string, port: number, xor: boolean): Attr {
  const body = new Uint8Array(8);
  body[1] = 1;
  new DataView(body.buffer).setUint16(2, xor ? port ^ 0x2112 : port);
  host.split('.').forEach((o, i) => { body[4 + i] = +o ^ (xor ? cookieBytes[i] : 0); });
  return { type, body };
}
/** `groups` are the eight 16-bit groups of the address. */
function v6Attr(type: number, groups: number[], port: number, xor: boolean): Attr {
  const body = new Uint8Array(20);
  body[1] = 2;
  const v = new DataView(body.buffer);
  v.setUint16(2, xor ? port ^ 0x2112 : port);
  const mask = [...cookieBytes, ...tx];
  groups.forEach((g, i) => {
    body[4 + i * 2] = (g >> 8) ^ (xor ? mask[i * 2] : 0);
    body[5 + i * 2] = (g & 255) ^ (xor ? mask[i * 2 + 1] : 0);
  });
  return { type, body };
}

describe('isStun', () => {
  it('needs the cookie, a first byte below 0x40 and a length that adds up', () => {
    const good = message(tx, [v4Attr(0x20, '1.2.3.4', 5, true)]);
    expect(isStun(good)).toBe(true);
    const wrongLength = good.slice(); wrongLength[3] += 4;
    expect(isStun(wrongLength)).toBe(false);
    expect(isStun(good.subarray(0, good.length - 1))).toBe(false);
    const wrongCookie = good.slice(); wrongCookie[4] ^= 1;
    expect(isStun(wrongCookie)).toBe(false);
    const helmLike = good.slice(); helmLike[0] = 0x80;
    expect(isStun(helmLike)).toBe(false);
  });
  it('works on a view into a larger buffer', () => {
    const good = message(tx, [v4Attr(0x20, '1.2.3.4', 5, true)]);
    const big = new Uint8Array(100); big.set(good, 33);
    expect(isStun(big.subarray(33, 33 + good.length))).toBe(true);
  });
});

describe('parseBindingResponse', () => {
  it('reads an IPv4 XOR-MAPPED-ADDRESS', () => {
    expect(parseBindingResponse(message(tx, [v4Attr(0x20, '203.0.113.9', 41234, true)]))).toEqual({ id: idOf(tx), host: '203.0.113.9', port: 41234 });
  });
  it('reads an IPv6 XOR-MAPPED-ADDRESS, XORed with the cookie and the transaction id', () => {
    const groups = [0x2001, 0xdb8, 0, 0, 0, 0, 0xabc, 0x1];
    expect(parseBindingResponse(message(tx, [v6Attr(0x20, groups, 9999, true)]))).toEqual({ id: idOf(tx), host: '2001:db8:0:0:0:0:abc:1', port: 9999 });
  });
  it('reads the older MAPPED-ADDRESS in both families', () => {
    expect(parseBindingResponse(message(tx, [v4Attr(0x01, '198.51.100.7', 3478, false)]))).toEqual({ id: idOf(tx), host: '198.51.100.7', port: 3478 });
    expect(parseBindingResponse(message(tx, [v6Attr(0x01, [0x2001, 0xdb8, 1, 2, 3, 4, 5, 6], 80, false)]))).toEqual({ id: idOf(tx), host: '2001:db8:1:2:3:4:5:6', port: 80 });
  });
  it('prefers the XOR address over a plain one, wherever it comes', () => {
    const plain = v4Attr(0x01, '10.0.0.1', 1, false), xor = v4Attr(0x20, '203.0.113.9', 2, true);
    expect(parseBindingResponse(message(tx, [plain, xor]))).toMatchObject({ host: '203.0.113.9', port: 2 });
    expect(parseBindingResponse(message(tx, [xor, plain]))).toMatchObject({ host: '203.0.113.9', port: 2 });
  });
  it('keeps the first plain address when there is no XOR one', () => {
    expect(parseBindingResponse(message(tx, [v4Attr(0x01, '10.0.0.1', 1, false), v4Attr(0x01, '10.0.0.2', 2, false)]))).toMatchObject({ host: '10.0.0.1' });
    expect(parseBindingResponse(message(tx, [v6Attr(0x01, [1, 0, 0, 0, 0, 0, 0, 1], 1, false), v6Attr(0x01, [2, 0, 0, 0, 0, 0, 0, 2], 2, false)]))).toMatchObject({ host: '1:0:0:0:0:0:0:1' });
  });
  it('steps over other attributes, including ones whose length needs padding', () => {
    const software = { type: 0x8022, body: new TextEncoder().encode('abcde') }; // 5 bytes, 3 of padding
    expect(parseBindingResponse(message(tx, [software, v4Attr(0x20, '203.0.113.9', 7, true)]))).toMatchObject({ host: '203.0.113.9', port: 7 });
  });
  it('ignores an address attribute that is too short or of an unknown family', () => {
    const short = { type: 0x20, body: new Uint8Array(4) };
    const unknown = v4Attr(0x20, '1.1.1.1', 1, true); unknown.body[1] = 9;
    const shortV6 = v6Attr(0x20, [1, 2, 3, 4, 5, 6, 7, 8], 1, true); shortV6.body = shortV6.body.subarray(0, 12);
    expect(parseBindingResponse(message(tx, [short]))).toBeNull();
    expect(parseBindingResponse(message(tx, [unknown]))).toBeNull();
    expect(parseBindingResponse(message(tx, [shortV6]))).toBeNull();
    // ...and carries on to a good one after it.
    expect(parseBindingResponse(message(tx, [short, v4Attr(0x20, '9.9.9.9', 9, true)]))).toMatchObject({ host: '9.9.9.9' });
  });
  it('gives up on an attribute that claims to run past the end', () => {
    const m = message(tx, [v4Attr(0x20, '203.0.113.9', 7, true)]);
    m[23] = 200; // length of the first attribute
    expect(parseBindingResponse(m)).toBeNull();
  });
  it('answers null for no attributes, errors, requests and garbage', () => {
    expect(parseBindingResponse(message(tx, []))).toBeNull();
    expect(parseBindingResponse(message(tx, [v4Attr(0x20, '1.2.3.4', 5, true)], 0x0111))).toBeNull(); // binding error response
    expect(parseBindingResponse(message(tx, [v4Attr(0x20, '1.2.3.4', 5, true)], 0x0001))).toBeNull(); // a request
    expect(parseBindingResponse(new Uint8Array(30).fill(7))).toBeNull();
    expect(parseBindingResponse(new Uint8Array(0))).toBeNull();
  });
  it('ignores a trailing fragment too small to be an attribute header', () => {
    const m = message(tx, [v4Attr(0x20, '1.2.3.4', 5, true)]);
    const withTail = new Uint8Array(m.length + 2); withTail.set(m); new DataView(withTail.buffer).setUint16(2, 12 + 2);
    expect(parseBindingResponse(withTail)).toMatchObject({ host: '1.2.3.4' });
  });
});

describe('bindingRequest', () => {
  it('makes a fresh 20-byte request with its id', () => {
    const a = bindingRequest(), b = bindingRequest();
    expect(a.packet).toHaveLength(20);
    expect(isStun(a.packet)).toBe(true);
    expect(idOf(a.packet.subarray(8, 20))).toBe(a.id);
    expect(a.id).not.toBe(b.id);
  });
});

describe('StunClient', () => {
  /** A client whose "network" answers with `reply(requestNumber, id)`: undefined means silence. */
  function client(reply: (n: number, id: string, c: StunClient) => void) {
    let n = 0;
    const sent: { host: string; port: number; id: string }[] = [];
    const c: StunClient = new StunClient((packet, host, port) => {
      const id = idOf(packet.subarray(8, 20));
      sent.push({ host, port, id });
      reply(n++, id, c);
    });
    return { c, sent };
  }
  const answer = (c: StunClient, id: string, host: string, port: number) => c.handle(message(Uint8Array.from(Buffer.from(id, 'hex')), [v4Attr(0x20, host, port, true)]));

  it('asks the server and returns what it saw', async () => {
    const { c, sent } = client((_n, id, c) => queueMicrotask(() => answer(c, id, '203.0.113.9', 4000)));
    expect(await c.query('192.0.2.1', 3478)).toEqual({ host: '203.0.113.9', port: 4000 });
    expect(sent).toMatchObject([{ host: '192.0.2.1', port: 3478 }]);
  });

  it('asks again when a request goes unanswered, with a fresh transaction each time', async () => {
    const { c, sent } = client((n, id, c) => { if (n === 2) queueMicrotask(() => answer(c, id, '203.0.113.9', 1)); });
    expect(await c.query('192.0.2.1', 3478, 20)).toEqual({ host: '203.0.113.9', port: 1 });
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((s) => s.id)).size).toBe(3);
  });

  it('gives up with null after three attempts', async () => {
    const { c, sent } = client(() => undefined);
    expect(await c.query('192.0.2.1', 3478, 10)).toBeNull();
    expect(sent).toHaveLength(3);
  });

  it('waits the default 2.5 s per attempt', async () => {
    vi.useFakeTimers();
    try {
      const { c, sent } = client(() => undefined);
      const p = c.query('192.0.2.1', 3478);
      await vi.advanceTimersByTimeAsync(2499);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await p).toBeNull();
      expect(sent).toHaveLength(3);
    } finally { vi.useRealTimers(); }
  });

  it('ignores answers to transactions it did not ask, garbage, and error responses', async () => {
    const { c } = client((_n, id, c) => queueMicrotask(() => {
      answer(c, '00'.repeat(12), '6.6.6.6', 6); // someone else's transaction
      c.handle(new Uint8Array(40)); // not STUN at all
      c.handle(message(Uint8Array.from(Buffer.from(id, 'hex')), [v4Attr(0x20, '7.7.7.7', 7, true)], 0x0111)); // an error for ours
      answer(c, id, '203.0.113.9', 4000);
    }));
    expect(await c.query('192.0.2.1', 3478)).toEqual({ host: '203.0.113.9', port: 4000 });
  });

  it('does not match a late answer to an earlier attempt against a later one', async () => {
    let first = '';
    const { c, sent } = client((n, id, c) => {
      if (n === 0) first = id;
      // The second request is answered with the first one's id (too late for it), then really.
      if (n === 1) queueMicrotask(() => { answer(c, first, '6.6.6.6', 6); answer(c, id, '203.0.113.9', 2); });
    });
    expect(await c.query('192.0.2.1', 3478, 20)).toEqual({ host: '203.0.113.9', port: 2 });
    expect(sent).toHaveLength(2);
  });
});
