import { describe, expect, it } from 'vitest';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { aead, generateKeyPair, initiate, publicKeyOf, respond, Symmetric } from '../src/shared/p2p/noise';
import { b64, decodeShareCode, encodeShareCode, parseEndpoint, PREFIX } from '../src/shared/p2p/sharecode';
import { qrModules, qrSvg } from '../src/shared/qr';
import { dispatch } from '../src/core/dispatch';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const P = enc('prologue');

describe('noise IK', () => {
  const handshake = (payload = 'hi', answer = 'ok') => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const i = initiate(phone, host.publicKey, enc(payload), P);
    const r = respond(host, i.msg1, P);
    const acc = r.accept(enc(answer));
    const fin = i.finish(acc.msg2);
    return { host, phone, i, r, acc, fin };
  };

  it('carries both payloads, reveals the initiator key, and agrees on keys and the handshake hash', () => {
    const { phone, r, acc, fin } = handshake('hello', 'world');
    expect(dec(r.payload)).toBe('hello');
    expect(dec(fin.payload)).toBe('world');
    expect(r.remoteStatic).toEqual(phone.publicKey);
    expect(fin.keys.send).toEqual(acc.keys.recv);
    expect(fin.keys.recv).toEqual(acc.keys.send);
    expect(fin.keys.send).not.toEqual(fin.keys.recv);
    expect(fin.keys.handshakeHash).toEqual(acc.keys.handshakeHash);
    expect(fin.keys.handshakeHash).toHaveLength(32);
  });

  it('gives different keys for every handshake', () => {
    expect(handshake().fin.keys.send).not.toEqual(handshake().fin.keys.send);
  });

  it('refuses a different prologue', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const i = initiate(phone, host.publicKey, enc('x'), P);
    expect(() => respond(host, i.msg1, enc('other'))).toThrow();
  });

  it('refuses a first message made for another key, or tampered with anywhere', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const { msg1 } = initiate(phone, host.publicKey, enc('x'), P);
    expect(() => respond(generateKeyPair(), msg1, P)).toThrow();
    for (const at of [0, 40, 85, msg1.length - 1]) {
      const bad = msg1.slice(); bad[at] ^= 1;
      expect(() => respond(host, bad, P)).toThrow();
    }
  });

  it('rejects malformed message lengths', () => {
    const host = generateKeyPair();
    expect(() => respond(host, new Uint8Array(95), P)).toThrow('short');
    const { i, acc } = handshake();
    expect(() => i.finish(new Uint8Array(47))).toThrow('short');
    const bad = acc.msg2.slice(); bad[bad.length - 1] ^= 1;
    expect(() => i.finish(bad)).toThrow();
    // an empty payload is the shortest legal first message and answer
    const h = handshake('', '');
    expect(h.r.payload).toHaveLength(0);
    expect(h.fin.payload).toHaveLength(0);
  });

  it('does not let an answer from someone who lacks the host key finish the handshake', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const i = initiate(phone, host.publicKey, enc('x'), P);
    const imposter = generateKeyPair();
    // The imposter cannot read msg1, so the best it can do is answer a handshake of its own.
    const other = initiate(generateKeyPair(), imposter.publicKey, enc('y'), P);
    const forged = respond(imposter, other.msg1, P).accept(new Uint8Array(0));
    expect(() => i.finish(forged.msg2)).toThrow();
  });

  it('publicKeyOf derives the public half of a key pair', () => {
    const k = generateKeyPair();
    expect(publicKeyOf(k.secretKey)).toEqual(k.publicKey);
    expect(k.publicKey).toHaveLength(32);
  });
});

describe('aead counter', () => {
  const key = new Uint8Array(32).fill(7);
  const aad = enc('aad');
  it('puts the 64-bit counter in the last 8 nonce bytes, little endian, including above 2^32', () => {
    for (const ctr of [0, 1, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 5, 3 * 2 ** 32 + 9]) {
      const nonce = new Uint8Array(12);
      new DataView(nonce.buffer).setBigUint64(4, BigInt(ctr), true);
      const ct = aead(key, ctr, aad).encrypt(enc('data'));
      expect(chacha20poly1305(key, nonce, aad).decrypt(ct)).toEqual(enc('data'));
    }
  });
  it('treats counters 5 and 2^32+5 as different nonces, and checks the associated data', () => {
    const ct = aead(key, 2 ** 32 + 5, aad).encrypt(enc('data'));
    expect(() => aead(key, 5, aad).decrypt(ct)).toThrow();
    expect(() => aead(key, 2 ** 32 + 5, enc('other')).decrypt(ct)).toThrow();
    expect(dec(aead(key, 2 ** 32 + 5, aad).decrypt(ct))).toBe('data');
  });
});

describe('noise symmetric state before any key', () => {
  it('passes data through unencrypted but still mixes it into the hash', () => {
    const a = new Symmetric(P), b = new Symmetric(P);
    const h0 = a.h;
    const ct = a.encryptAndHash(enc('plain'));
    expect(dec(ct)).toBe('plain');
    expect(a.h).toEqual(blake2s(concatBytes(h0, enc('plain'))));
    expect(dec(b.decryptAndHash(ct))).toBe('plain');
    expect(b.h).toEqual(a.h);
    expect(a.k).toBeNull();
  });
  it('encrypts once a key is mixed in, with the hash as associated data and a counter that restarts at a new key', () => {
    const a = new Symmetric(P), b = new Symmetric(P);
    a.mixKey(enc('ikm')); b.mixKey(enc('ikm'));
    const c1 = a.encryptAndHash(enc('one')), c2 = a.encryptAndHash(enc('one'));
    expect(c1).not.toEqual(c2);
    expect(dec(b.decryptAndHash(c1))).toBe('one');
    expect(dec(b.decryptAndHash(c2))).toBe('one');
    expect(a.n).toBe(2);
    a.mixKey(enc('more'));
    expect(a.n).toBe(0);
    expect(() => b.decryptAndHash(a.encryptAndHash(enc('x')))).toThrow();
  });
});

describe('endpoints', () => {
  it.each([
    ['1.2.3.4', 99, { host: '1.2.3.4', port: 99 }],
    [' 1.2.3.4:5 ', 99, { host: '1.2.3.4', port: 5 }],
    ['[2a00:1::5]', 99, { host: '2a00:1::5', port: 99 }],
    ['[2a00:1::5]:7', 99, { host: '2a00:1::5', port: 7 }],
    ['[fe80::1%eth0]:7', 99, { host: 'fe80::1%eth0', port: 7 }],
    ['[::ffff:1.2.3.4]', 1, { host: '::ffff:1.2.3.4', port: 1 }],
    ['my-host.local', 99, { host: 'my-host.local', port: 99 }],
    ['my-host.local:65535', 99, { host: 'my-host.local', port: 65535 }]
  ])('reads %s', (text, port, want) => { expect(parseEndpoint(text, port)).toEqual(want); });

  it.each([
    ['', 1], ['1.2.3.4:0', 1], ['1.2.3.4:65536', 1], ['1.2.3.4:99999999999999999999', 1], ['2a00:1::5', 1], ['a:b:c', 1], ['[2a00::5]:0', 1],
    ['[2a00::5', 1], ['[]', 1], ['bad host', 1], ['bad/host', 1], ['a'.repeat(254), 1], [':80', 1], ['1.2.3.4', 0], ['1.2.3.4', 70000], ['1.2.3.4', 1.5]
  ])('refuses %j (default %j)', (text, port) => { expect(parseEndpoint(text, port)).toBeNull(); });

  it('accepts a 253 character name', () => { expect(parseEndpoint('a'.repeat(253), 1)?.host).toHaveLength(253); });
});

describe('share codes', () => {
  const key = b64.encode(generateKeyPair().publicKey);
  const raw = (j: unknown) => PREFIX + b64.encode(enc(typeof j === 'string' ? j : JSON.stringify(j)));
  const base = { v: 1, n: 'Desk', p: 4000, c: ['1.2.3.4'], k: key };

  it('round-trips, with and without a secret', () => {
    const s = new Uint8Array(16).fill(9);
    const withS = decodeShareCode(encodeShareCode({ ...base, v: 1, s: b64.encode(s) }));
    expect(withS.secret).toEqual(s);
    expect(withS.endpoints).toEqual([{ host: '1.2.3.4', port: 4000 }]);
    expect(withS.hostKey).toHaveLength(32);
    expect(withS.code.n).toBe('Desk');
    expect(decodeShareCode('  ' + encodeShareCode({ ...base, v: 1 }) + '\n').secret).toBeUndefined();
  });

  it('b64 round trips every byte value and refuses non base64url text', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (let n = 0; n < 8; n++) expect(b64.decode(b64.encode(all.subarray(n)))).toEqual(all.subarray(n));
    expect(b64.encode(Uint8Array.of(251, 255))).toBe('-_8');
    expect(() => b64.decode('a+b')).toThrow('Not base64url');
    expect(() => b64.decode('ab=c')).toThrow();
  });

  it('caps the candidates at 16 and skips ones it cannot read, including non-strings', () => {
    const c: unknown[] = [5, null, 'bad host', '1.1.1.1:0', {}, ...Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`)];
    const d = decodeShareCode(raw({ ...base, c }));
    // 16 are looked at, the first five are unusable, so 11 remain
    expect(d.endpoints).toHaveLength(11);
    expect(d.endpoints[0].host).toBe('10.0.0.0');
    expect(d.endpoints[10].host).toBe('10.0.0.10');
    const many = decodeShareCode(raw({ ...base, c: Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`) }));
    expect(many.endpoints).toHaveLength(16);
  });

  it('gives a message fit to show for each kind of bad code', () => {
    const damaged = 'That share code is damaged.';
    expect(() => decodeShareCode('hello')).toThrow('not a helm share code');
    expect(() => decodeShareCode('')).toThrow('not a helm share code');
    expect(() => decodeShareCode(PREFIX + '!!!')).toThrow(damaged);
    expect(() => decodeShareCode(raw('{not json'))).toThrow(damaged);
    expect(() => decodeShareCode(raw('null'))).toThrow('different version');
    expect(() => decodeShareCode(raw({ ...base, v: 2 }))).toThrow('different version');
    expect(() => decodeShareCode(raw({ ...base, p: '4000' }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, c: 'x' }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, k: 5 }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, n: 5 }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, k: '!!' }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, s: '!!' }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, k: b64.encode(new Uint8Array(31)) }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, k: b64.encode(new Uint8Array(33)) }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, s: b64.encode(new Uint8Array(15)) }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, s: b64.encode(new Uint8Array(17)) }))).toThrow(damaged);
    expect(() => decodeShareCode(raw({ ...base, c: [] }))).toThrow('no address');
    expect(() => decodeShareCode(raw({ ...base, c: ['bad host', 7] }))).toThrow('no address');
  });
});

describe('qr', () => {
  /** Reads the SVG's path commands back into a grid of modules, offset by the quiet zone. */
  function render(svg: string) {
    const size = +/viewBox="0 0 (\d+) \d+"/.exec(svg)![1];
    const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    const d = /<path d="([^"]*)"/.exec(svg)![1];
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      expect(m[3]).toBe(m[4]);
      for (let i = 0; i < +m[3]; i++) grid[+m[2]][+m[1] + i] = true;
    }
    return { size, grid };
  }

  it('is square, and grows with the data', () => {
    const small = qrModules('hi'), big = qrModules('x'.repeat(500));
    expect(small.length).toBe(21);
    expect(small.every((r) => r.length === 21)).toBe(true);
    expect(big.length).toBeGreaterThan(small.length);
    expect((big.length - 17) % 4).toBe(0);
    expect(qrModules('hi')).toEqual(small);
    expect(qrModules('hello')).not.toEqual(qrModules('world'));
  });

  it('has the three finder patterns in the corners', () => {
    const m = qrModules('hello');
    const n = m.length;
    for (const [oy, ox] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        expect(m[oy][ox + i]).toBe(true); expect(m[oy + 6][ox + i]).toBe(true);
        expect(m[oy + i][ox]).toBe(true); expect(m[oy + i][ox + 6]).toBe(true);
      }
      expect(m[oy + 3][ox + 3]).toBe(true);
      expect(m[oy + 1][ox + 1]).toBe(false);
    }
  });

  it('throws when the data is too long for any code', () => {
    expect(() => qrModules('x'.repeat(3000))).toThrow();
    expect(() => qrModules('x'.repeat(2000))).not.toThrow();
  });

  it.each([undefined, 0, 1, 4, 7])('draws exactly the modules in the svg, with quiet zone %s', (quiet) => {
    const text = encodeShareCode({ v: 1, n: 'Desk', p: 4000, c: ['1.2.3.4', '[2a00::1]:99'], k: b64.encode(new Uint8Array(32)) });
    const m = qrModules(text);
    const q = quiet ?? 4;
    const svg = quiet === undefined ? qrSvg(text) : qrSvg(text, quiet);
    const { size, grid } = render(svg);
    expect(size).toBe(m.length + 2 * q);
    expect(svg).toContain(`<rect width="${size}" height="${size}" fill="#fff"/>`);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const inside = y >= q && x >= q && y < q + m.length && x < q + m.length;
      expect(grid[y][x]).toBe(inside ? m[y - q][x - q] : false);
    }
  });
});

describe('dispatch', () => {
  const api: Record<string, unknown> = { add: (a: number, b = 10) => a + b, boom: () => { throw new Error('bad'); }, later: async () => 'x', rejects: async () => { throw new Error('nope'); }, data: 5, chooseFolder: () => '/x', copyText: () => 1 };

  it('calls the function with the arguments and returns its result, awaiting a promise', async () => {
    expect(await dispatch(api, 'add', [1, 2])).toBe(3);
    expect(await dispatch(api, 'later', [])).toBe('x');
  });
  it('turns null arguments into undefined so defaults apply, and leaves other falsy values alone', async () => {
    expect(await dispatch(api, 'add', [1, null])).toBe(11);
    expect(await dispatch(api, 'add', [1, 0])).toBe(1);
    const seen: unknown[] = [];
    await dispatch({ f: (...a: unknown[]) => seen.push(...a) }, 'f', [null, '', false, undefined]);
    expect(seen).toEqual([undefined, '', false, undefined]);
  });
  it('propagates thrown errors and rejections', async () => {
    await expect(dispatch(api, 'boom', [])).rejects.toThrow('bad');
    await expect(dispatch(api, 'rejects', [])).rejects.toThrow('nope');
  });
  it('refuses names that are not the api\'s own functions', async () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'missing', 'data']) await expect(dispatch(api, name, [])).rejects.toThrow(`Unknown call: ${name}`);
    for (const name of [5, null, undefined, {}, ['add']]) await expect(dispatch(api, name, [])).rejects.toThrow('Unknown call');
    await expect(dispatch(api, 'x'.repeat(200), [])).rejects.toThrow(`Unknown call: ${'x'.repeat(60)}`);
    await expect(dispatch(api, 'x'.repeat(200), [])).rejects.not.toThrow('x'.repeat(61));
  });
  it('refuses the calls that belong to the user\'s computer', async () => {
    await expect(dispatch(api, 'chooseFolder', [])).rejects.toThrow('chooseFolder is done by the browser, not the server');
    await expect(dispatch(api, 'copyText', ['x'])).rejects.toThrow('done by the browser');
  });
  it('refuses arguments that are not a list', async () => {
    for (const args of [undefined, null, 'ab', { length: 1 }, 5]) await expect(dispatch(api, 'add', args)).rejects.toThrow('Arguments must be a list');
  });
  it('does not look through a prototype chain', async () => {
    const child = Object.create({ inherited: () => 1 });
    await expect(dispatch(child, 'inherited', [])).rejects.toThrow('Unknown call');
  });
});
