import { generateKeyPair, publicKeyOf } from '../../src/shared/p2p/noise';
import type { KeyPair } from '../../src/shared/p2p/noise';
import { b64, decodeShareCode, encodeShareCode } from '../../src/shared/p2p/sharecode';

/**
 * The helm instances this phone knows. A `hosted` one is a server reached by URL (its own sign-in and cookies, as in the browser). A `desktop`
 * one is a computer reached directly: the saved share code with its one-time secret removed, and this phone's key for it.
 */
export type Instance =
  | { id: string; kind: 'hosted'; name: string; url: string }
  | { id: string; kind: 'desktop'; name: string; code: string; secretKey: string };

export interface Storage { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void> }
const KEY = 'helm.instances';
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

export class Instances {
  constructor(private storage: Storage) {}
  async list(): Promise<Instance[]> { try { return JSON.parse((await this.storage.get(KEY)) || '[]'); } catch { return []; } }
  private async put(all: Instance[]) { await this.storage.set(KEY, JSON.stringify(all)); }

  async addHosted(name: string, url: string): Promise<Instance> {
    const u = new URL(url.includes('://') ? url : 'https://' + url);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') throw new Error('A hosted helm must be reached over https.');
    const inst: Instance = { id: crypto.randomUUID(), kind: 'hosted', name: name || u.host, url: u.origin };
    await this.put([...(await this.list()), inst]);
    return inst;
  }

  /** A new computer, from the code it showed: nothing is saved until `finishDesktop`, once it has accepted this phone. */
  prepareDesktop(code: string): { name: string; identity: KeyPair; code: string } {
    const d = decodeShareCode(code);
    return { name: d.code.n, identity: generateKeyPair(), code: code.trim() };
  }

  /** Saves a computer that accepted this phone. The one-time secret is dropped from the code kept, and the key is this phone's for it. */
  async finishDesktop(p: { name: string; identity: KeyPair; code: string }): Promise<Instance> {
    const { code } = decodeShareCode(p.code);
    const { s: _spent, ...kept } = code;
    const inst: Instance = { id: crypto.randomUUID(), kind: 'desktop', name: p.name, code: encodeShareCode(kept), secretKey: hex(p.identity.secretKey) };
    await this.put([...(await this.list()), inst]);
    return inst;
  }

  /** The computer sent new addresses (its router gave it a new public one): keep them. */
  async updateAddresses(id: string, port: number, addresses: string[]) {
    const all = await this.list();
    const i = all.find((x) => x.id === id);
    if (i?.kind !== 'desktop') return;
    const { code } = decodeShareCode(i.code);
    i.code = encodeShareCode({ ...code, p: port, c: addresses.slice(0, 16) });
    await this.put(all);
  }

  async remove(id: string) { await this.put((await this.list()).filter((x) => x.id !== id)); }

  identityOf(i: Extract<Instance, { kind: 'desktop' }>): KeyPair {
    const secretKey = unhex(i.secretKey);
    return { secretKey, publicKey: publicKeyOf(secretKey) };
  }
}
export { b64 };
