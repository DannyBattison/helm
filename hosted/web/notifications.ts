import type { HelmEvents } from '@shared/types';
import type { WebBridge } from './bridge';

export interface NotifyOptions {
  /** Also receive notifications with the app closed, through a service worker and the server's Web Push. */
  push?: boolean;
}

/** Shows a notification from the server unless this tab is being looked at. Needs permission, which a browser only grants after a click. */
function showHere(n: HelmEvents['notify'], bridge: WebBridge) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.hasFocus()) return;
  // The tag makes several open tabs show one notification between them.
  const note = new Notification(n.title, { body: n.body, silent: n.silent, tag: `helm-${n.sessionId}-${n.kind}`, icon: new URL('apple-touch-icon.png', location.href).href });
  note.onclick = () => { window.focus(); bridge.open(n.sessionId, n.kind); note.close(); };
}

const key = (b64: string) => {
  const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const post = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });

/** Registers the worker and gives the server this device's push address. True if the server now has it. */
async function enrol(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  const k = await fetch('/push/key', { credentials: 'same-origin' });
  if (!k.ok) return false;
  const { key: pub } = await k.json();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(pub) }));
  return (await post('/push/subscribe', sub.toJSON())).ok;
}

/**
 * Notifications for a browser tab or an installed app: shown by the page while it is open and out of focus, and, with `push`, by the worker
 * when it is closed. A tapped notification takes you to its session. Permission is asked on the first click, which browsers require (iOS ignores pointerdown and touchstart for this).
 */
export function setupNotifications(bridge: WebBridge, opts: NotifyOptions = {}) {
  let pushing = false;
  let last = 0;
  const enable = () => { if (opts.push && !pushing && Date.now() - last > 30_000) { last = Date.now(); void enrol().then((ok) => { pushing = ok; }, () => undefined); } };
  // Signing in happens after the page loads, and the server only hands out its key to someone signed in: try again as state arrives.
  if (opts.push) bridge.on('state', () => { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') enable(); });
  bridge.on('notify', (n) => { if (!pushing) showHere(n, bridge); });

  if (typeof Notification !== 'undefined') {
    if (Notification.permission === 'granted') enable();
    else if (Notification.permission === 'default') addEventListener('click', () => { void Notification.requestPermission().then(enable); }, { once: true });
  }
  if (opts.push && 'serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') bridge.open(e.data.sessionId, e.data.kind); });
  }
  const q = new URLSearchParams(location.search);
  if (q.get('open')) { bridge.open(q.get('open')!, q.get('kind') || ''); history.replaceState(null, '', location.pathname); }
}
