import { describe, expect, it } from 'vitest';
import { generateKeyPair, initiate, respond } from '../src/shared/p2p/noise';

const pro = new TextEncoder().encode('test');
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const bytes = (s: string) => new TextEncoder().encode(s);

describe('Noise IK handshake', () => {
  it('gives both sides the same keys, and carries a payload each way', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const i = initiate(phone, host.publicKey, bytes('hello'), pro);
    const r = respond(host, i.msg1, pro);
    expect(text(r.payload)).toBe('hello');
    expect(r.remoteStatic).toEqual(phone.publicKey);
    const a = r.accept(bytes('welcome'));
    const done = i.finish(a.msg2);
    expect(text(done.payload)).toBe('welcome');
    expect(done.keys.send).toEqual(a.keys.recv);
    expect(done.keys.recv).toEqual(a.keys.send);
    expect(done.keys.handshakeHash).toEqual(a.keys.handshakeHash);
    expect(done.keys.send).not.toEqual(done.keys.recv);
  });

  it('refuses a first message made for another host, or with another prologue', () => {
    const host = generateKeyPair(), other = generateKeyPair(), phone = generateKeyPair();
    const msg1 = initiate(phone, other.publicKey, bytes('x'), pro).msg1;
    expect(() => respond(host, msg1, pro)).toThrow();
    const right = initiate(phone, host.publicKey, bytes('x'), pro).msg1;
    expect(() => respond(host, right, bytes('different'))).toThrow();
  });

  it('refuses a first message with any byte changed', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const msg1 = initiate(phone, host.publicKey, bytes('payload'), pro).msg1;
    for (const at of [0, 31, 32, 79, 80, msg1.length - 1]) {
      const bad = msg1.slice();
      bad[at] ^= 1;
      expect(() => respond(host, bad, pro), `byte ${at}`).toThrow();
    }
  });

  it('refuses an answer that did not come from the host, and one for a different first message', () => {
    const host = generateKeyPair(), phone = generateKeyPair(), imposter = generateKeyPair();
    const i = initiate(phone, host.publicKey, bytes('x'), pro);
    const forged = respond(imposter, initiate(phone, imposter.publicKey, bytes('x'), pro).msg1, pro).accept(bytes('')).msg2;
    expect(() => i.finish(forged)).toThrow();
    const real = respond(host, i.msg1, pro).accept(bytes('')).msg2;
    const j = initiate(phone, host.publicKey, bytes('x'), pro);
    expect(() => j.finish(real)).toThrow();
  });

  it('makes new keys every time', () => {
    const host = generateKeyPair(), phone = generateKeyPair();
    const keys = [0, 1].map(() => { const i = initiate(phone, host.publicKey, bytes(''), pro); return i.finish(respond(host, i.msg1, pro).accept(bytes('')).msg2).keys.send; });
    expect(keys[0]).not.toEqual(keys[1]);
  });
});
