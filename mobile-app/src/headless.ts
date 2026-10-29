import { Instances } from './instances';
import type { Storage } from './instances';
import { collect } from './notices';
import type { UdpSocket } from '../../src/shared/p2p/link';
import { fromBase64, toBase64 } from './native';

/**
 * Runs inside the hidden web view the operating system's background task starts (`collect.html`), with no app UI. The native side provides
 * `HelmHeadless`: the saved preferences, a UDP socket, a way to show a notification, and `done`. Its job is to call `collect()` and finish.
 */
interface HelmHeadless {
  getPref(key: string): string | null;
  setPref(key: string, value: string): void;
  udpBind(): number;
  udpSend(id: number, data: string, host: string, port: number): void;
  udpClose(id: number): void;
  notify(json: string): void;
  done(shown: number): void;
}
declare global { interface Window { HelmHeadless: HelmHeadless; __helmUdp?: (id: number, data: string, host: string, port: number) => void } }

const native = window.HelmHeadless;
const storage: Storage = { get: async (k) => native.getPref(k), set: async (k, v) => native.setPref(k, v) };

const sockets = new Map<number, (d: Uint8Array, h: string, p: number) => void>();
window.__helmUdp = (id, data, host, port) => sockets.get(id)?.(fromBase64(data), host, port);
const socket = (): UdpSocket => {
  const id = native.udpBind();
  return {
    send: (d, h, p) => native.udpSend(id, toBase64(d), h, p),
    onMessage: (f) => { sockets.set(id, f); },
    close: () => { sockets.delete(id); native.udpClose(id); }
  };
};

void (async () => {
  let shown = 0;
  try {
    const computers = (await new Instances(storage).list()).flatMap((i) => i.kind === 'desktop' ? [{ name: i.name, link: { code: i.code, identity: new Instances(storage).identityOf(i), name: 'Phone' } }] : []);
    shown = computers.length ? await collect(computers, socket, async (n) => native.notify(JSON.stringify(n)), storage, 2500) : 0;
  } finally { native.done(shown); }
})();
