import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const file = join(__dirname, '../web/worker/sw.js');
const script = new Script(readFileSync(file, 'utf8'), { filename: file });

type Handler = (e: any) => void;
function load(clients: any[] = []) {
  const handlers: Record<string, Handler> = {};
  const self: any = {
    addEventListener: (t: string, h: Handler) => { handlers[t] = h; },
    skipWaiting: vi.fn(),
    clients: { matchAll: vi.fn(async () => clients), claim: vi.fn(async () => undefined), openWindow: vi.fn(async () => undefined) },
    registration: { scope: 'https://h.example/app/', showNotification: vi.fn(async () => undefined) }
  };
  // The worker is plain script code whose globals are `self`; run it in a context whose global is the fake.
  script.runInContext(createContext({ self, URL }));
  return { self, handlers };
}
/** Runs a handler and waits for whatever it passed to waitUntil. */
async function fire(h: Handler, e: any) {
  let p: Promise<unknown> = Promise.resolve();
  h({ ...e, waitUntil: (x: Promise<unknown>) => { p = x; } });
  await p;
}
const pushEvent = (data: unknown) => ({ data: { json: () => { if (data === 'bad') throw new Error('x'); return data; } } });
const client = (o: any = {}) => ({ visibilityState: 'hidden', focused: false, focus: vi.fn(async () => undefined), postMessage: vi.fn(), ...o });

describe('service worker', () => {
  let ctx: ReturnType<typeof load>;
  beforeEach(() => { ctx = load(); });

  it('takes over at once', async () => {
    ctx.handlers.install({});
    expect(ctx.self.skipWaiting).toHaveBeenCalled();
    await fire(ctx.handlers.activate, {});
    expect(ctx.self.clients.claim).toHaveBeenCalled();
  });

  it('shows a notification tagged by session and kind, carrying where to go', async () => {
    await fire(ctx.handlers.push, pushEvent({ title: 'Done', body: 'Finished', sessionId: 's1', kind: 'ready', silent: 1 }));
    expect(ctx.self.registration.showNotification).toHaveBeenCalledWith('Done', {
      body: 'Finished', silent: true, icon: 'https://h.example/app/apple-touch-icon.png', badge: 'https://h.example/app/favicon.svg',
      tag: 'helm-s1-ready', data: { sessionId: 's1', kind: 'ready' }
    });
  });

  it('is not silent unless asked', async () => {
    await fire(ctx.handlers.push, pushEvent({ title: 'T', sessionId: 's', kind: 'k' }));
    expect(ctx.self.registration.showNotification.mock.calls[0][1].silent).toBe(false);
  });

  it('ignores pushes that are not helm notifications', async () => {
    await fire(ctx.handlers.push, pushEvent('bad'));
    await fire(ctx.handlers.push, pushEvent({ body: 'no title' }));
    await fire(ctx.handlers.push, {});
    ctx.handlers.push({ data: null, waitUntil: () => { throw new Error('should not wait'); } });
    expect(ctx.self.registration.showNotification).not.toHaveBeenCalled();
  });

  it('stays quiet when helm is open, in view and focused', async () => {
    const c = load([client({ visibilityState: 'visible', focused: true })]);
    await fire(c.handlers.push, pushEvent({ title: 'T', sessionId: 's', kind: 'k' }));
    expect(c.self.registration.showNotification).not.toHaveBeenCalled();
    expect(c.self.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
  });

  it('still notifies when windows are open but hidden or unfocused', async () => {
    const c = load([client({ visibilityState: 'visible' }), client({ focused: true })]);
    await fire(c.handlers.push, pushEvent({ title: 'T', sessionId: 's', kind: 'k' }));
    expect(c.self.registration.showNotification).toHaveBeenCalledTimes(1);
  });

  describe('tapping a notification', () => {
    const tap = (data: any) => { const close = vi.fn(); return { close, e: { notification: { close, data } } }; };

    it('focuses an open window and tells it where to go', async () => {
      const w = client();
      const c = load([w, client()]);
      const { close, e } = tap({ sessionId: 's1', kind: 'ready' });
      await fire(c.handlers.notificationclick, e);
      expect(close).toHaveBeenCalled();
      expect(w.focus).toHaveBeenCalled();
      expect(w.postMessage).toHaveBeenCalledWith({ type: 'open', sessionId: 's1', kind: 'ready' });
      expect(c.self.clients.openWindow).not.toHaveBeenCalled();
    });

    it('opens the app at the session when no window is open', async () => {
      await fire(ctx.handlers.notificationclick, tap({ sessionId: 'a b', kind: 'ready&x' }).e);
      expect(ctx.self.clients.openWindow).toHaveBeenCalledWith('https://h.example/app/?open=a%20b&kind=ready%26x');
    });

    it('leaves the kind empty when there is none', async () => {
      await fire(ctx.handlers.notificationclick, tap({ sessionId: 's' }).e);
      expect(ctx.self.clients.openWindow).toHaveBeenCalledWith('https://h.example/app/?open=s&kind=');
    });

    it('opens the app itself for a notification without a session', async () => {
      await fire(ctx.handlers.notificationclick, tap(undefined).e);
      expect(ctx.self.clients.openWindow).toHaveBeenCalledWith('https://h.example/app/');
    });
  });
});
