import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '../../src/shared/p2p/noise';

const h = vi.hoisted(() => ({ collect: vi.fn(), bound: 0 }));
vi.mock('../src/notices', () => ({ collect: h.collect }));
vi.mock('../src/native', () => ({
  toBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  fromBase64: (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
}));

const key = generateKeyPair();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const settle = () => new Promise((r) => setTimeout(r, 20));

function fake(instances: unknown[] | string | null) {
  const prefs = new Map<string, string>();
  if (instances !== null) prefs.set('helm.instances', typeof instances === 'string' ? instances : JSON.stringify(instances));
  const n = { getPref: vi.fn((k: string) => prefs.get(k) ?? null), setPref: vi.fn((k: string, v: string) => { prefs.set(k, v); }), udpBind: vi.fn(() => ++h.bound), udpSend: vi.fn(), udpClose: vi.fn(), notify: vi.fn(), done: vi.fn() };
  (globalThis as any).window = { HelmHeadless: n } as any;
  return n;
}
const desktop = { id: 'd1', kind: 'desktop', name: 'Desk', code: 'HELM1-code', secretKey: hex(key.secretKey) };
const hosted = { id: 'h1', kind: 'hosted', name: 'H', url: 'https://h.example' };

beforeEach(() => { vi.resetModules(); h.collect.mockReset(); h.bound = 0; });

describe('headless background task', () => {
  it('collects from the desktop instances only and reports how many were shown', async () => {
    const n = fake([desktop, hosted]);
    h.collect.mockImplementation(async (computers: any[]) => { expect(computers).toHaveLength(1); return 3; });
    await import('../src/headless');
    await settle();
    const [computers, , , storage, settle_] = h.collect.mock.calls[0];
    expect(computers[0]).toMatchObject({ id: 'd1', name: 'Desk', link: { code: 'HELM1-code', name: 'Phone' } });
    expect(Array.from(computers[0].link.identity.secretKey)).toEqual(Array.from(key.secretKey));
    expect(Array.from(computers[0].link.identity.publicKey)).toEqual(Array.from(key.publicKey));
    expect(settle_).toBe(2500);
    await storage.set('x', 'y');
    expect(n.setPref).toHaveBeenCalledWith('x', 'y');
    expect(await storage.get('x')).toBe('y');
    expect(n.done).toHaveBeenCalledExactlyOnceWith(3);
  });
  it('shows each notice as JSON through the native notifier', async () => {
    const n = fake([desktop]);
    h.collect.mockImplementation(async (_c: any, _s: any, show: any) => { await show({ id: '1', title: 'T' }); return 1; });
    await import('../src/headless');
    await settle();
    expect(n.notify).toHaveBeenCalledWith(JSON.stringify({ id: '1', title: 'T' }));
    expect(n.done).toHaveBeenCalledWith(1);
  });
  it('still calls done(0) with no desktop instances, and does not collect', async () => {
    const n = fake([hosted]);
    await import('../src/headless');
    await settle();
    expect(h.collect).not.toHaveBeenCalled();
    expect(n.done).toHaveBeenCalledExactlyOnceWith(0);
  });
  it('calls done(0) when nothing is saved at all', async () => {
    const n = fake(null);
    await import('../src/headless');
    await settle();
    expect(n.done).toHaveBeenCalledExactlyOnceWith(0);
  });
  it('always calls done even when collecting throws', async () => {
    const n = fake([desktop]);
    h.collect.mockRejectedValue(new Error('boom'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    await import('../src/headless');
    await settle();
    process.off('unhandledRejection', unhandled);
    expect(n.done).toHaveBeenCalledExactlyOnceWith(0);
  });
  it('gives each socket its own id and routes datagrams to the right one', async () => {
    const n = fake([desktop]);
    const got: string[] = [];
    h.collect.mockImplementation(async (_c: any, socket: any) => {
      const a = socket(), b = socket();
      a.onMessage((d: Uint8Array, host: string, port: number) => got.push(`a:${Buffer.from(d).toString()}@${host}:${port}`));
      b.onMessage((d: Uint8Array) => got.push(`b:${Buffer.from(d).toString()}`));
      a.send(Uint8Array.from([104, 105]), 'h', 9);
      const hook = (globalThis as any).window.__helmUdp;
      hook(1, Buffer.from('one').toString('base64'), '1.1.1.1', 5);
      hook(2, Buffer.from('two').toString('base64'), '2.2.2.2', 6);
      hook(99, Buffer.from('lost').toString('base64'), '3.3.3.3', 7);
      a.close();
      hook(1, Buffer.from('late').toString('base64'), '1.1.1.1', 5);
      return 0;
    });
    await import('../src/headless');
    await settle();
    expect(got).toEqual(['a:one@1.1.1.1:5', 'b:two']);
    expect(n.udpSend).toHaveBeenCalledWith(1, 'aGk=', 'h', 9);
    expect(n.udpClose).toHaveBeenCalledWith(1);
  });
});
