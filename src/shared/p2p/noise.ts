import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { blake2s } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { concatBytes } from '@noble/hashes/utils.js';

/**
 * Noise_IK_25519_ChaChaPoly_BLAKE2s (https://noiseprotocol.org/noise.html), written out against the @noble primitives. IK is the pattern for
 * a client that already knows the server's static key: the client's first message is an encrypted proof of who it is, so a server can ignore
 * (not answer) anything that is not from someone it accepts. Nothing here touches the network.
 *
 *   <- s                      (the responder's static key is known beforehand)
 *   -> e, es, s, ss, payload
 *   <- e, ee, se, payload
 */
export interface KeyPair { secretKey: Uint8Array; publicKey: Uint8Array }
export const generateKeyPair = (): KeyPair => x25519.keygen();
export const publicKeyOf = (secretKey: Uint8Array): Uint8Array => x25519.getPublicKey(secretKey);

const NAME = new TextEncoder().encode('Noise_IK_25519_ChaChaPoly_BLAKE2s');
const EMPTY = new Uint8Array(0);
const hash = (...p: Uint8Array[]) => blake2s(concatBytes(...p));
const dh = (secret: Uint8Array, pub: Uint8Array) => x25519.getSharedSecret(secret, pub);

/** HKDF as Noise defines it, with two outputs. */
function hkdf2(ck: Uint8Array, ikm: Uint8Array): [Uint8Array, Uint8Array] {
  const temp = hmac(blake2s, ck, ikm);
  const o1 = hmac(blake2s, temp, Uint8Array.of(1));
  const o2 = hmac(blake2s, temp, concatBytes(o1, Uint8Array.of(2)));
  return [o1, o2];
}

/** ChaCha20-Poly1305 with a 64-bit counter in the last 8 bytes of the nonce, little endian, as Noise specifies. */
export function aead(key: Uint8Array, counter: number, aad: Uint8Array) {
  const nonce = new Uint8Array(12);
  new DataView(nonce.buffer).setUint32(4, counter % 2 ** 32, true);
  new DataView(nonce.buffer).setUint32(8, Math.floor(counter / 2 ** 32), true);
  return chacha20poly1305(key, nonce, aad);
}

export class Symmetric {
  ck: Uint8Array;
  h: Uint8Array;
  k: Uint8Array | null = null;
  n = 0;
  constructor(prologue: Uint8Array) {
    this.h = NAME.length <= 32 ? concatBytes(NAME, new Uint8Array(32 - NAME.length)) : hash(NAME);
    this.ck = this.h;
    this.mixHash(prologue);
  }
  /** A copy to try something on: a handshake message that turns out not to be valid must not change the real state. */
  clone(): Symmetric {
    const c = Object.create(Symmetric.prototype) as Symmetric;
    c.ck = this.ck; c.h = this.h; c.k = this.k; c.n = this.n;
    return c;
  }
  mixHash(d: Uint8Array) { this.h = hash(this.h, d); }
  mixKey(ikm: Uint8Array) { const [ck, k] = hkdf2(this.ck, ikm); this.ck = ck; this.k = k; this.n = 0; }
  encryptAndHash(pt: Uint8Array) {
    const ct = this.k ? aead(this.k, this.n++, this.h).encrypt(pt) : pt;
    this.mixHash(ct);
    return ct;
  }
  decryptAndHash(ct: Uint8Array) {
    const pt = this.k ? aead(this.k, this.n++, this.h).decrypt(ct) : ct;
    this.mixHash(ct);
    return pt;
  }
  split(): [Uint8Array, Uint8Array] { return hkdf2(this.ck, EMPTY); }
}

/** The two directions' keys once the handshake is done, from the point of view of whoever holds them. */
export interface TransportKeys { send: Uint8Array; recv: Uint8Array; /** Hash of the whole handshake, the same on both sides. */ handshakeHash: Uint8Array }

export function initiate(s: KeyPair, rs: Uint8Array, payload: Uint8Array, prologue: Uint8Array) {
  const sym = new Symmetric(prologue);
  sym.mixHash(rs);
  const e = generateKeyPair();
  sym.mixHash(e.publicKey);
  sym.mixKey(dh(e.secretKey, rs));
  const encS = sym.encryptAndHash(s.publicKey);
  sym.mixKey(dh(s.secretKey, rs));
  const body = sym.encryptAndHash(payload);
  const msg1 = concatBytes(e.publicKey, encS, body);
  return {
    msg1,
    /** Reads the responder's answer. Throws if it is not one. */
    finish(msg2: Uint8Array): { keys: TransportKeys; payload: Uint8Array } {
      if (msg2.length < 32 + 16) throw new Error('short');
      // On a copy: a damaged answer (or one forged by someone who guessed the index) must leave this able to read the real one.
      const t = sym.clone();
      const re = msg2.subarray(0, 32);
      t.mixHash(re);
      t.mixKey(dh(e.secretKey, re));
      t.mixKey(dh(s.secretKey, re));
      const out = t.decryptAndHash(msg2.subarray(32));
      const [k1, k2] = t.split();
      return { keys: { send: k1, recv: k2, handshakeHash: t.h }, payload: out };
    }
  };
}

/** Reads a first message. Throws if it is not valid for this key, which is what a stranger's packet does. */
export function respond(s: KeyPair, msg1: Uint8Array, prologue: Uint8Array) {
  if (msg1.length < 32 + 48 + 16) throw new Error('short');
  const sym = new Symmetric(prologue);
  sym.mixHash(s.publicKey);
  const re = msg1.subarray(0, 32);
  sym.mixHash(re);
  sym.mixKey(dh(s.secretKey, re));
  const rs = sym.decryptAndHash(msg1.subarray(32, 80));
  sym.mixKey(dh(s.secretKey, rs));
  const payload = sym.decryptAndHash(msg1.subarray(80));
  return {
    /** The initiator's static key: who this is. */
    remoteStatic: rs.slice(),
    payload,
    /** Accepts it: the answer to send, and the keys. */
    accept(answer: Uint8Array): { msg2: Uint8Array; keys: TransportKeys } {
      const e = generateKeyPair();
      sym.mixHash(e.publicKey);
      sym.mixKey(dh(e.secretKey, re));
      sym.mixKey(dh(e.secretKey, rs));
      const body = sym.encryptAndHash(answer);
      const [k1, k2] = sym.split();
      return { msg2: concatBytes(e.publicKey, body), keys: { send: k2, recv: k1, handshakeHash: sym.h } };
    }
  };
}
