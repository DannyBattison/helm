// helm's service worker: it exists to show push notifications while the app is closed, and to take you to the session when one is tapped.
// Shared by every build that wants push (mobile-app, web-companion); each gets its own copy and scope. It caches nothing: the app always comes from the server.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let n = {};
  try { n = e.data ? e.data.json() : {}; } catch { /* not ours */ }
  if (!n.title) return;
  e.waitUntil((async () => {
    // When helm is open and in view, the page already shows what happened.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(n.title, {
      body: n.body, silent: !!n.silent, icon: new URL('apple-touch-icon.png', self.registration.scope).href, badge: new URL('favicon.svg', self.registration.scope).href,
      tag: `helm-${n.sessionId}-${n.kind}`, data: { sessionId: n.sessionId, kind: n.kind }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { sessionId, kind } = e.notification.data || {};
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = open[0];
    if (target) {
      await target.focus();
      target.postMessage({ type: 'open', sessionId, kind });
    } else if (sessionId) {
      await self.clients.openWindow(`${self.registration.scope}?open=${encodeURIComponent(sessionId)}&kind=${encodeURIComponent(kind || '')}`);
    } else await self.clients.openWindow(self.registration.scope);
  })());
});
