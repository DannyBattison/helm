/**
 * The share code: everything a phone needs to find and recognise a desktop. Text, so it pastes and scans; `HELM1-` then base64url of JSON
 * `{ v: 1, n: name, p: port, c: [address…], k: host key, s?: one-time secret }`. An address is `ip`, `[v6]`, `ip:port`, `[v6]:port` or a
 * host name; a bare one uses `p`. The secret lets one new device pair; a code without it only works for devices that already did.
 */
export const PREFIX = 'HELM1-';
const MAX_CANDIDATES = 16;

export interface ShareCode {
  v: 1;
  /** The desktop's display name. */
  n: string;
  /** The tunnel port; candidates without their own port use this. */
  p: number;
  /** Addresses to try, best first. */
  c: string[];
  /** The desktop's public key, base64url. */
  k: string;
  /** One-time pairing secret, base64url. Absent when only already-paired devices should connect. */
  s?: string;
}

export const b64 = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
};

export function encodeShareCode(code: ShareCode): string {
  return PREFIX + b64.encode(new TextEncoder().encode(JSON.stringify(code)));
}

export interface Endpoint { host: string; port: number }

/** `ip`, `[v6]`, `ip:port`, `[v6]:port`, `name` or `name:port`. */
export function parseEndpoint(text: string, defaultPort: number): Endpoint | null {
  const t = text.trim();
  let host = t;
  let port = defaultPort;
  const v6 = /^\[([0-9a-fA-F:.%a-zA-Z]+)\](?::(\d+))?$/.exec(t);
  if (v6) { host = v6[1]; if (v6[2]) port = +v6[2]; }
  else if (/^[^:]+:\d+$/.test(t)) { host = t.slice(0, t.lastIndexOf(':')); port = +t.slice(t.lastIndexOf(':') + 1); }
  else if (t.includes(':')) return null;
  if (!host || host.length > 253 || !/^[A-Za-z0-9.:%_-]+$/.test(host)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host, port };
}

/** Reads a share code. Throws a message fit to show a person. An address that cannot be read is skipped, so a newer code still works. */
export function decodeShareCode(text: string): { code: ShareCode; endpoints: Endpoint[]; hostKey: Uint8Array; secret?: Uint8Array } {
  const t = text.trim();
  if (!t.startsWith(PREFIX)) throw new Error('That is not a helm share code.');
  let j: any;
  try { j = JSON.parse(new TextDecoder().decode(b64.decode(t.slice(PREFIX.length)))); } catch { throw new Error('That share code is damaged.'); }
  if (j?.v !== 1) throw new Error('That share code is from a different version of helm.');
  if (typeof j.p !== 'number' || !Array.isArray(j.c) || typeof j.k !== 'string' || typeof j.n !== 'string') throw new Error('That share code is damaged.');
  let hostKey: Uint8Array;
  let secret: Uint8Array | undefined;
  try { hostKey = b64.decode(j.k); secret = j.s === undefined ? undefined : b64.decode(j.s); } catch { throw new Error('That share code is damaged.'); }
  if (hostKey.length !== 32 || (secret && secret.length !== 16)) throw new Error('That share code is damaged.');
  const endpoints = j.c.slice(0, MAX_CANDIDATES).map((c: unknown) => (typeof c === 'string' ? parseEndpoint(c, j.p) : null)).filter(Boolean) as Endpoint[];
  if (!endpoints.length) throw new Error('That share code has no address to connect to.');
  return { code: j as ShareCode, endpoints, hostKey, secret };
}
