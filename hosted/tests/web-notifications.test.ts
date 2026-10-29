// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupNotifications } from '../web/notifications';
import { phoneLayout } from '../web/layout';

function fakeBridge() {
  const handlers: Record<string, (p: any) => void> = {};
  return { handlers, on: vi.fn((c: string, cb: (p: any) => void) => { handlers[c] = cb; return () => undefined; }), open: vi.fn() } as any;
}
const note = { kind: 'ready', title: 'Done', body: 'It finished', silent: false, sessionId: 's1' };

let permission = 'granted';
let focused = false;
const instances: any[] = [];
class FakeNotification {
  static get permission() { return permission; }
  static requestPermission = vi.fn(async () => { permission = 'granted'; return 'granted'; });
  onclick: (() => void) | null = null;
  close = vi.fn();
  constructor(public title: string, public opts: any) { instances.push(this); }
}

beforeEach(() => {
  permission = 'granted'; focused = false; instances.length = 0;
  FakeNotification.requestPermission.mockClear();
  vi.stubGlobal('Notification', FakeNotification);
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
});
afterEach(() => {
  // Consume any first-click listener a test left on window, without granting anything.
  FakeNotification.requestPermission.mockImplementation(async () => 'denied');
  permission = 'denied';
  window.dispatchEvent(new Event('pointerdown'));
  FakeNotification.requestPermission.mockImplementation(async () => { permission = 'granted'; return 'granted'; });
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

describe('page notifications', () => {
  it('shows a notification when unfocused and permitted, tagged per session and kind', () => {
    const b = fakeBridge();
    setupNotifications(b);
    b.handlers.notify(note);
    expect(instances).toHaveLength(1);
    expect(instances[0].title).toBe('Done');
    expect(instances[0].opts).toMatchObject({ body: 'It finished', silent: false, tag: 'helm-s1-ready' });
    expect(instances[0].opts.icon).toMatch(/apple-touch-icon\.png$/);
  });

  it('stays quiet while the tab is focused or permission is not granted', () => {
    const b = fakeBridge();
    setupNotifications(b);
    focused = true;
    b.handlers.notify(note);
    focused = false;
    permission = 'denied';
    b.handlers.notify(note);
    expect(instances).toHaveLength(0);
  });

  it('stays quiet when the browser has no Notification', () => {
    vi.stubGlobal('Notification', undefined);
    delete (globalThis as any).Notification;
    const b = fakeBridge();
    expect(() => setupNotifications(b)).not.toThrow();
    b.handlers.notify(note);
  });

  it('tapping it focuses the window, goes to the session and closes the notification', () => {
    const b = fakeBridge();
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    setupNotifications(b);
    b.handlers.notify(note);
    instances[0].onclick();
    expect(focus).toHaveBeenCalled();
    expect(b.open).toHaveBeenCalledWith('s1', 'ready');
    expect(instances[0].close).toHaveBeenCalled();
  });

  it('asks for permission on the first click only', async () => {
    permission = 'default';
    setupNotifications(fakeBridge());
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pointerdown'));
    window.dispatchEvent(new Event('pointerdown'));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('does not ask once denied', () => {
    permission = 'denied';
    setupNotifications(fakeBridge());
    window.dispatchEvent(new Event('pointerdown'));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });
});

describe('opening from the address bar', () => {
  it('goes to the session in ?open= and clears the query', () => {
    history.replaceState(null, '', '/app?open=s%201&kind=ready');
    const b = fakeBridge();
    setupNotifications(b);
    expect(b.open).toHaveBeenCalledWith('s 1', 'ready');
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/app');
  });

  it('defaults the kind to empty and does nothing without ?open=', () => {
    history.replaceState(null, '', '/?open=s2');
    const b = fakeBridge();
    setupNotifications(b);
    expect(b.open).toHaveBeenCalledWith('s2', '');
    const c = fakeBridge();
    setupNotifications(c);
    expect(c.open).not.toHaveBeenCalled();
  });
});

describe('push', () => {
  let sub: any, reg: any, sw: any, fetchMock: any, swMessage: ((e: any) => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    sub = { toJSON: () => ({ endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } }) };
    reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => sub) } };
    swMessage = undefined;
    sw = { register: vi.fn(async () => reg), ready: Promise.resolve(reg), addEventListener: vi.fn((_t: string, cb: any) => { swMessage = cb; }) };
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
    vi.stubGlobal('PushManager', class {});
    (window as any).PushManager = class {};
    fetchMock = vi.fn(async (path: string, init?: any) => path === '/push/key' ? { ok: true, json: async () => ({ key: 'AQAB_-' }) } : { ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { delete (navigator as any).serviceWorker; delete (window as any).PushManager; });

  it('registers the worker, subscribes with the server key and gives the server the subscription', async () => {
    setupNotifications(fakeBridge(), { push: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledWith('./sw.js', { scope: './' });
    const args = reg.pushManager.subscribe.mock.calls[0][0];
    expect(args.userVisibleOnly).toBe(true);
    expect(Array.from(args.applicationServerKey)).toEqual([1, 0, 1, 255]); // base64url "AQAB_-"
    const post = fetchMock.mock.calls.find((c: any[]) => c[0] === '/push/subscribe');
    expect(post[1]).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(JSON.parse(post[1].body)).toEqual({ endpoint: 'https://push/1', keys: { p256dh: 'p', auth: 'a' } });
  });

  it('reuses an existing subscription', async () => {
    reg.pushManager.getSubscription.mockResolvedValue(sub);
    setupNotifications(fakeBridge(), { push: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/push/subscribe', expect.anything());
  });

  it('page notifications stop once pushing, since the worker shows them', async () => {
    const b = fakeBridge();
    setupNotifications(b, { push: true });
    await vi.advanceTimersByTimeAsync(0);
    b.handlers.notify(note);
    expect(instances).toHaveLength(0);
  });

  it('does not enrol without push option, permission, or browser support', async () => {
    setupNotifications(fakeBridge());
    permission = 'denied';
    setupNotifications(fakeBridge(), { push: true });
    permission = 'granted';
    delete (window as any).PushManager;
    setupNotifications(fakeBridge(), { push: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).not.toHaveBeenCalled();
  });

  it('keeps trying as state arrives when the server refuses the key, no more than every 30 seconds', async () => {
    fetchMock.mockImplementation(async (path: string) => path === '/push/key' ? { ok: false } : { ok: true });
    const b = fakeBridge();
    setupNotifications(b, { push: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(1);
    b.handlers.state({});
    await vi.advanceTimersByTimeAsync(29_000);
    b.handlers.state({});
    expect(sw.register).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_500);
    b.handlers.state({});
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(2);
    // once the server accepts, it stops
    fetchMock.mockImplementation(async (path: string) => path === '/push/key' ? { ok: true, json: async () => ({ key: 'AA' }) } : { ok: true });
    await vi.advanceTimersByTimeAsync(31_000);
    b.handlers.state({});
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(31_000);
    b.handlers.state({});
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(3);
  });

  it('does not enrol on state without permission', async () => {
    permission = 'default';
    const b = fakeBridge();
    setupNotifications(b, { push: true });
    b.handlers.state({});
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).not.toHaveBeenCalled();
  });

  it('survives enrolment failing', async () => {
    sw.register.mockRejectedValue(new Error('no'));
    setupNotifications(fakeBridge(), { push: true });
    await vi.advanceTimersByTimeAsync(0);
  });

  it('enrols after permission is granted by the first click', async () => {
    permission = 'default';
    setupNotifications(fakeBridge(), { push: true });
    window.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(0);
    expect(sw.register).toHaveBeenCalledTimes(1);
  });

  it('opens the session when the worker says a notification was tapped', () => {
    const b = fakeBridge();
    setupNotifications(b, { push: true });
    swMessage!({ data: { type: 'open', sessionId: 's9', kind: 'input' } });
    swMessage!({ data: { type: 'other' } });
    swMessage!({ data: null });
    expect(b.open).toHaveBeenCalledTimes(1);
    expect(b.open).toHaveBeenCalledWith('s9', 'input');
  });

  it('does not listen to the worker without the push option', () => {
    setupNotifications(fakeBridge());
    expect(sw.addEventListener).not.toHaveBeenCalled();
  });
});

describe('phoneLayout', () => {
  const setup = (coarse: boolean, w: number, h: number) => {
    document.head.innerHTML = '<meta name="viewport" content="width=device-width">';
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }));
    vi.stubGlobal('screen', { width: w, height: h });
  };
  const content = () => document.querySelector('meta[name=viewport]')!.getAttribute('content');

  it('narrows the viewport on a tablet', () => {
    setup(true, 820, 1180);
    phoneLayout();
    expect(content()).toContain('width=500');
    expect(content()).toContain('viewport-fit=cover');
  });

  it('takes a custom width', () => {
    setup(true, 1024, 768);
    phoneLayout(420);
    expect(content()).toContain('width=420,');
  });

  it('leaves a real phone alone, even held wide', () => {
    setup(true, 390, 844);
    phoneLayout();
    setup(true, 844, 390);
    phoneLayout();
    expect(content()).toBe('width=device-width');
  });

  it('leaves a mouse-driven screen alone', () => {
    setup(false, 1920, 1080);
    phoneLayout();
    expect(content()).toBe('width=device-width');
  });

  it('tolerates a page without a viewport tag', () => {
    setup(true, 820, 1180);
    document.head.innerHTML = '';
    expect(() => phoneLayout()).not.toThrow();
  });
});
