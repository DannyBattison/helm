import type { HelmBridge, HelmEvents } from '@shared/types';
import type { ClientMessage, ServerMessage } from '../src/protocol';

type Pending = { resolve(v: unknown): void; reject(e: Error): void };

/** Things only the user's own computer can do; on a server they happen in the browser. */
const local: Record<string, (...a: any[]) => unknown> = {
  openExternal: (url: string) => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
  copyText: (t: string) => navigator.clipboard.writeText(t),
  chooseFolder: () => window.prompt('Folder on the server:') || null,
  openFolder: () => Promise.reject(new Error('Opening a folder is not available in the browser'))
};

const clientPlatform = () => (/Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux');

/**
 * The same `HelmBridge` Electron's preload provides, over a WebSocket. Reconnects by itself. Before sign-in the server only answers helm's
 * own sign-in screen; once that succeeds it tells this page to collect a cookie, so a reload does not mean signing in again.
 */
export function createBridge(url: string): HelmBridge & { ready: Promise<void> } {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const pending = new Map<number, Pending>();
  let ws: WebSocket;
  let nextId = 1;
  let retry = 500;
  let firstReady: () => void;
  const ready = new Promise<void>((r) => { firstReady = r; });
  let isReady = false;
  let queued: ClientMessage[] = [];

  const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((cb) => cb(payload));
  const post = (m: ClientMessage) => (isReady ? ws.send(JSON.stringify(m)) : queued.push(m));

  function connect(reconnect: boolean) {
    ws = new WebSocket(url);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMessage;
      if (m.t === 'ready') {
        isReady = true;
        retry = 500;
        firstReady();
        for (const q of queued) ws.send(JSON.stringify(q));
        queued = [];
        // Whatever happened while we were away: the UI replaces its state with a fresh copy.
        if (reconnect) void bridge.invoke('getState').then((s) => emit('state', s));
      } else if (m.t === 'result') {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (p) { if (m.ok === true) p.resolve(m.value); else p.reject(new Error(m.error)); }
      } else if (m.t === 'session') {
        void fetch('/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: m.claim }), credentials: 'same-origin' }).catch(() => undefined);
      } else if (m.t === 'event') emit(m.channel, m.payload);
    };
    ws.onclose = () => {
      isReady = false;
      for (const p of pending.values()) p.reject(new Error('Connection to the server was lost'));
      pending.clear();
      setTimeout(() => connect(true), retry);
      retry = Math.min(retry * 2, 10_000);
    };
  }
  connect(false);

  const bridge: HelmBridge & { ready: Promise<void> } = {
    ready,
    platform: clientPlatform(),
    windowControls: 'none',
    hosted: true,
    invoke(channel, ...args) {
      if (channel in local) return Promise.resolve(local[channel](...args));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        post({ t: 'call', id, name: channel, args });
      });
    },
    on<K extends keyof HelmEvents>(channel: K, cb: (p: HelmEvents[K]) => void) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(cb);
      return () => { set!.delete(cb); };
    }
  };
  return bridge;
}
