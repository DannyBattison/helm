import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const plugin = {
    nextId: 7,
    sent: [] as any[], closed: [] as number[], removed: 0,
    listeners: [] as ((m: any) => void)[],
    release: null as null | (() => void),
    gate: null as null | Promise<void>,
    bind: vi.fn(async () => { if (plugin.gate) await plugin.gate; return { id: plugin.nextId }; }),
    send: vi.fn(async (o: any) => { plugin.sent.push(o); }),
    close: vi.fn(async (o: any) => { plugin.closed.push(o.id); }),
    addListener: vi.fn(async (_e: string, cb: any) => { plugin.listeners.push(cb); return { remove: async () => { plugin.removed++; } }; })
  };
  const prefs = new Map<string, string>();
  const secure = { sync: vi.fn(async () => undefined), store: new Map<string, unknown>() };
  return { plugin, prefs, secure };
});
vi.mock('@capacitor/core', () => ({ registerPlugin: () => h.plugin }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { get: async ({ key }: any) => ({ value: h.prefs.get(key) ?? null }), set: async ({ key, value }: any) => { h.prefs.set(key, value); } } }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: { setSynchronize: h.secure.sync, get: async (k: string) => h.secure.store.get(k) ?? null, set: async (k: string, v: unknown) => { h.secure.store.set(k, v); }, remove: async (k: string) => { h.secure.store.delete(k); } } }));

import { capacitorUdp, fromBase64, preferences, secrets, toBase64 } from '../src/native';

beforeEach(() => { h.plugin.sent.length = 0; h.plugin.closed.length = 0; h.plugin.listeners.length = 0; h.plugin.removed = 0; h.plugin.gate = null; h.prefs.clear(); h.secure.store.clear(); h.secure.sync.mockClear(); });
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('base64', () => {
  it('round-trips small and large buffers', () => {
    const small = Uint8Array.from([0, 1, 2, 254, 255]);
    expect(Array.from(fromBase64(toBase64(small)))).toEqual(Array.from(small));
    const big = Uint8Array.from({ length: 0x8000 * 3 + 17 }, (_, i) => (i * 7) & 255);
    expect(Buffer.from(fromBase64(toBase64(big))).equals(Buffer.from(big))).toBe(true);
    expect(toBase64(Uint8Array.from([104, 105]))).toBe('aGk=');
  });
});

describe('capacitorUdp', () => {
  it('queues sends until the socket is bound, then sends them encoded in order', async () => {
    let open!: () => void;
    h.plugin.gate = new Promise<void>((r) => { open = r; });
    const u = capacitorUdp();
    u.send(Uint8Array.from([1]), 'a.example', 10);
    u.send(Uint8Array.from([2]), 'b.example', 11);
    await tick();
    expect(h.plugin.sent).toEqual([]);
    open();
    await tick();
    expect(h.plugin.sent).toEqual([
      { id: 7, data: toBase64(Uint8Array.from([1])), host: 'a.example', port: 10 },
      { id: 7, data: toBase64(Uint8Array.from([2])), host: 'b.example', port: 11 }
    ]);
  });
  it('delivers only the messages for its own socket id', async () => {
    h.plugin.nextId = 3;
    const u = capacitorUdp();
    const got: any[] = [];
    u.onMessage((d, host, port) => got.push([Array.from(d), host, port]));
    await tick();
    const fire = h.plugin.listeners[0];
    fire({ id: 3, data: toBase64(Uint8Array.from([9, 8])), host: '1.2.3.4', port: 5 });
    fire({ id: 4, data: toBase64(Uint8Array.from([1])), host: '1.2.3.4', port: 5 });
    expect(got).toEqual([[[9, 8], '1.2.3.4', 5]]);
  });
  it('ignores messages before a handler is set', async () => {
    capacitorUdp();
    await tick();
    expect(() => h.plugin.listeners[0]({ id: 7, data: toBase64(Uint8Array.from([1])), host: 'h', port: 1 })).not.toThrow();
  });
  it('close removes the listener, closes the socket and stops delivery', async () => {
    h.plugin.nextId = 5;
    const u = capacitorUdp();
    const got: unknown[] = [];
    u.onMessage((d) => got.push(d));
    await tick();
    u.close();
    await tick();
    expect(h.plugin.removed).toBe(1);
    expect(h.plugin.closed).toEqual([5]);
    h.plugin.listeners[0]({ id: 5, data: toBase64(Uint8Array.from([1])), host: 'h', port: 1 });
    expect(got).toEqual([]);
  });
  it('survives a socket that cannot be opened', async () => {
    h.plugin.bind.mockRejectedValueOnce(new Error('no socket'));
    const u = capacitorUdp();
    u.send(Uint8Array.from([1]), 'h', 1);
    u.close();
    await tick();
    expect(h.plugin.sent).toEqual([]);
  });
});

describe('preferences', () => {
  it('reads null for a missing key and returns what was set', async () => {
    expect(await preferences.get('k')).toBeNull();
    await preferences.set('k', 'v');
    expect(await preferences.get('k')).toBe('v');
  });
});

describe('secrets', () => {
  it('turns off iCloud sync before every operation', async () => {
    await secrets.set('a', 'b');
    expect(await secrets.get('a')).toBe('b');
    await secrets.remove('a');
    expect(await secrets.get('a')).toBeNull();
    expect(h.secure.sync).toHaveBeenCalledTimes(4);
    expect(h.secure.sync).toHaveBeenCalledWith(false);
  });
  it('reads non-string values as null', async () => {
    h.secure.store.set('n', { not: 'a string' });
    expect(await secrets.get('n')).toBeNull();
  });
});
