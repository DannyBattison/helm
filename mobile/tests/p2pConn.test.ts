import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  // A plain function, not vi.fn: vitest would hold the rejected promise it returns and report it as unhandled.
  const j: any = { calls: [] as any[], impl: null as any };
  j.join = (o: any) => { j.calls.push(o); return j.impl(o); };
  j.resolves = (v: any) => { j.impl = async () => v; };
  j.rejects = (e: Error) => { j.impl = async () => { throw e; }; };
  return j;
});
vi.mock('../../src/shared/p2p/link', () => ({ join: h.join }));

import { connectDesktop } from '../src/p2pConn';
import { generateKeyPair } from '../../src/shared/p2p/noise';

const enc = (m: unknown) => new TextEncoder().encode(typeof m === 'string' ? m : JSON.stringify(m));
const dec = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));

function fakeLink() {
  const l: any = { sent: [] as Uint8Array[], closed: 0, onmsg: null, onclose: null };
  l.send = (b: Uint8Array) => { l.sent.push(b); };
  l.onMessage = (f: any) => { l.onmsg = f; };
  l.onClose = (f: any) => { l.onclose = f; };
  l.close = () => { l.closed++; };
  return l;
}
const sock = () => { const s = { send: vi.fn(), onMessage: vi.fn(), close: vi.fn() }; return s; };
const d = { code: 'HELM1-x', identity: generateKeyPair(), name: 'Phone', githubToken: 'tok' };

beforeEach(() => h.calls.length = 0);

describe('connectDesktop', () => {
  it('joins with the link options and closes the socket when joining fails', async () => {
    const s = sock();
    h.rejects(new Error('refused'));
    await expect(connectDesktop(() => s as any, d)()).rejects.toThrow('refused');
    expect(s.close).toHaveBeenCalledOnce();
    expect(h.calls).toEqual([{ socket: s, code: 'HELM1-x', identity: d.identity, name: 'Phone', githubToken: 'tok' }]);
  });
  it('hands ordinary messages on, sends JSON, and ignores hello and garbage', async () => {
    const l = fakeLink();
    h.resolves(l);
    const conn = await connectDesktop(() => sock() as any, d)();
    const got: any[] = [];
    conn.onMessage((m) => got.push(m));
    l.onmsg(enc({ t: 'hello' }));
    l.onmsg(enc('not json'));
    l.onmsg(enc({ t: 'state', n: 1 }));
    expect(got).toEqual([{ t: 'state', n: 1 }]);
    conn.send({ t: 'ping' } as any);
    expect(dec(l.sent[0])).toEqual({ t: 'ping' });
    conn.close();
    expect(l.closed).toBe(1);
  });
  it('drops messages quietly before anyone listens', async () => {
    const l = fakeLink();
    h.resolves(l);
    await connectDesktop(() => sock() as any, d)();
    expect(() => l.onmsg(enc({ t: 'state' }))).not.toThrow();
  });
  it('reports new addresses to the candidates hook instead of the UI', async () => {
    const l = fakeLink();
    h.resolves(l);
    const candidates = vi.fn();
    const conn = await connectDesktop(() => sock() as any, d, { candidates })();
    const got: any[] = [];
    conn.onMessage((m) => got.push(m));
    l.onmsg(enc({ t: 'candidates', p: 4000, c: ['1.1.1.1'] }));
    expect(candidates).toHaveBeenCalledWith(4000, ['1.1.1.1']);
    expect(got).toEqual([]);
  });
  it('gives notices to the hook, whose ack sends {t:"ack",ids} back; missing items become []', async () => {
    const l = fakeLink();
    h.resolves(l);
    const notices = vi.fn((items: any[], ack: (ids: string[]) => void) => ack(items.map((i) => i.id)));
    const conn = await connectDesktop(() => sock() as any, d, { notices })();
    const got: any[] = [];
    conn.onMessage((m) => got.push(m));
    l.onmsg(enc({ t: 'notices', items: [{ id: 'n1' }, { id: 'n2' }] }));
    expect(dec(l.sent[0])).toEqual({ t: 'ack', ids: ['n1', 'n2'] });
    l.onmsg(enc({ t: 'notices' }));
    expect(notices.mock.calls[1][0]).toEqual([]);
    expect(dec(l.sent[1])).toEqual({ t: 'ack', ids: [] });
    expect(got).toEqual([]);
  });
  it('does not fail when candidates or notices arrive without hooks', async () => {
    const l = fakeLink();
    h.resolves(l);
    await connectDesktop(() => sock() as any, d)();
    expect(() => { l.onmsg(enc({ t: 'candidates', p: 1, c: [] })); l.onmsg(enc({ t: 'notices', items: [] })); }).not.toThrow();
  });
  it('closes the socket and tells the UI when the link closes', async () => {
    const l = fakeLink();
    const s = sock();
    h.resolves(l);
    const conn = await connectDesktop(() => s as any, d)();
    const closed = vi.fn();
    conn.onClose(closed);
    l.onclose();
    expect(s.close).toHaveBeenCalledOnce();
    expect(closed).toHaveBeenCalledOnce();
  });
});
