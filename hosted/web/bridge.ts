import type { HelmBridge, HelmEvents } from '@shared/types';
import type { ClientMessage, ServerMessage } from '../src/protocol';

type Pending = { resolve(v: unknown): void; reject(e: Error): void };

/** Things only the user's own computer can do; on a server they happen in the browser. */
const local: Record<string, (...a: any[]) => unknown> = {
  openExternal: (url: string) => { if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); },
  copyText: (t: string) => navigator.clipboard.writeText(t),
  readClipboard: () => navigator.clipboard.readText().catch(() => ''),
  chooseFolder: () => window.prompt('Folder on the server:') || null,
  openFolder: () => Promise.reject(new Error('Opening a folder is not available in the browser'))
};

/** Hands a file the server made to the browser, as a download. */
function download({ name, text }: HelmEvents['download']) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const clientPlatform = () => (typeof navigator === 'undefined' ? 'linux' : /Mac/i.test(navigator.platform) ? 'darwin' : /Win/i.test(navigator.platform) ? 'win32' : 'linux');

export type WebBridge = HelmBridge & { ready: Promise<void>; /** Goes to a session, as tapping its notification does. Waits for the UI to be listening. */ open(sessionId: string, kind: string): void };

/** One live connection to whatever runs helm: a WebSocket to a hosted server, or an encrypted UDP link to a desktop app. */
export interface Conn {
  send(m: ClientMessage): void;
  /** Called with every message that is not the connection's own housekeeping. */
  onMessage(cb: (m: ServerMessage) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/**
 * The same `HelmBridge` Electron's preload provides, over any connection. `connect` opens one and resolves when it is usable; this reconnects
 * by itself with a growing wait, holds calls made while there is no connection, fails the ones in flight when it drops, and asks for a fresh
 * copy of the state when it is back, since events were missed.
 */
export function createConnectionBridge(connect: () => Promise<Conn>, extra: Record<string, (...a: any[]) => unknown> = {}): WebBridge {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const pending = new Map<number, Pending>();
  let conn: Conn | null = null;
  let nextId = 1;
  let retry = 500;
  let firstReady: () => void;
  const ready = new Promise<void>((r) => { firstReady = r; });
  let queued: ClientMessage[] = [];

  const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((cb) => cb(payload));
  const post = (m: ClientMessage) => (conn ? conn.send(m) : queued.push(m));

  async function open(reconnect: boolean) {
    let c: Conn;
    try { c = await connect(); } catch { setTimeout(() => void open(true), retry); retry = Math.min(retry * 2, 10_000); return; }
    conn = c;
    retry = 500;
    c.onMessage((m: any) => {
      if (m.t === 'result') {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (p) { if (m.ok === true) p.resolve(m.value); else p.reject(new Error(m.error)); }
      } else if (m.t === 'event') {
        if (m.channel === 'download') download(m.payload as HelmEvents['download']);
        else emit(m.channel, m.payload);
      }
    });
    c.onClose(() => {
      if (conn !== c) return;
      conn = null;
      for (const p of pending.values()) p.reject(new Error('Connection to the server was lost'));
      pending.clear();
      setTimeout(() => void open(true), retry);
      retry = Math.min(retry * 2, 10_000);
    });
    firstReady();
    for (const q of queued) c.send(q);
    queued = [];
    // Whatever happened while we were away: the UI replaces its state with a fresh copy.
    if (reconnect) void bridge.invoke('getState').then((s) => emit('state', s));
  }
  void open(false);

  const bridge: WebBridge = {
    ready,
    open(id, kind) {
      const go = () => emit('navigate', { screen: 'session', id, tab: kind === 'ready' ? 'changes' : 'conversation' });
      // The UI subscribes a moment after it loads; a tap that launched the app arrives before that.
      let tries = 0;
      const wait = () => (listeners.get('navigate')?.size ? go() : tries++ < 100 && setTimeout(wait, 100));
      wait();
    },
    platform: clientPlatform(),
    windowControls: 'none',
    hosted: true,
    invoke(channel, ...args) {
      if (channel in local) return Promise.resolve(local[channel](...args));
      if (channel in extra) return Promise.resolve(extra[channel](...args));
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

/**
 * To a hosted server: a WebSocket at `url`. Before sign-in the server only answers helm's own sign-in screen; once that succeeds it tells
 * this page to collect a cookie, so a reload does not mean signing in again.
 */
export function createBridge(url: string): WebBridge {
  return createConnectionBridge(() => new Promise<Conn>((resolve, reject) => {
    const ws = new WebSocket(url);
    let cb: (m: ServerMessage) => void = () => undefined;
    let closed = () => undefined as void;
    let isReady = false;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMessage;
      if (m.t === 'ready') {
        isReady = true;
        resolve({ send: (x) => ws.send(JSON.stringify(x)), onMessage: (f) => { cb = f; }, onClose: (f) => { closed = f; }, close: () => ws.close() });
      } else if (m.t === 'session') {
        void fetch('/auth/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim: m.claim }), credentials: 'same-origin' }).catch(() => undefined);
      } else cb(m);
    };
    ws.onclose = () => { if (isReady) closed(); else reject(new Error('closed')); };
  }));
}
