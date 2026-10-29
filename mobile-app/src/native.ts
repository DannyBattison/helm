import { registerPlugin } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Preferences } from '@capacitor/preferences';
import type { UdpSocket } from '../../src/shared/p2p/link';
import type { Secrets } from './session';
import type { Storage } from './instances';

/**
 * The one native piece the protocol needs: a UDP socket. Implemented in Java for Android (`HelmUdpPlugin.java`) and Swift for iOS
 * (`HelmUdpPlugin.swift`). One socket carries IPv4 and IPv6; `host` is an address or a name.
 */
interface HelmUdpPlugin {
  /** Opens a socket on any free port. */
  bind(): Promise<{ id: number }>;
  send(o: { id: number; data: string; host: string; port: number }): Promise<void>;
  close(o: { id: number }): Promise<void>;
  addListener(event: 'message', cb: (m: { id: number; data: string; host: string; port: number }) => void): Promise<{ remove(): Promise<void> }>;
}
const HelmUdp = registerPlugin<HelmUdpPlugin>('HelmUdp');

export const toBase64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** A UDP socket for the link, over the native plugin. It is usable at once: what is sent before the socket is open waits for it. */
export function capacitorUdp(): UdpSocket {
  let cb: (d: Uint8Array, h: string, p: number) => void = () => undefined;
  let closed = false;
  const opened = HelmUdp.bind().then(async ({ id }) => {
    const sub = await HelmUdp.addListener('message', (m) => { if (m.id === id && !closed) cb(fromBase64(m.data), m.host, m.port); });
    return { id, sub };
  });
  opened.catch(() => undefined);
  return {
    send(data, host, port) { void opened.then(({ id }) => HelmUdp.send({ id, data: toBase64(data), host, port })).catch(() => undefined); },
    onMessage(f) { cb = f; },
    close() { closed = true; void opened.then(({ id, sub }) => { void sub.remove(); return HelmUdp.close({ id }); }).catch(() => undefined); }
  };
}

/** Where the instance list is kept: the app's preferences, which the background task reads too. */
export const preferences: Storage = {
  get: async (key) => (await Preferences.get({ key })).value,
  set: async (key, value) => { await Preferences.set({ key, value }); }
};

/** The Keychain / Keystore. Not synced to iCloud: this token belongs to this phone. */
export const secrets: Secrets = {
  get: async (key) => { await SecureStorage.setSynchronize(false); const v = await SecureStorage.get(key); return typeof v === 'string' ? v : null; },
  set: async (key, value) => { await SecureStorage.setSynchronize(false); await SecureStorage.set(key, value); },
  remove: async (key) => { await SecureStorage.setSynchronize(false); await SecureStorage.remove(key); }
};
