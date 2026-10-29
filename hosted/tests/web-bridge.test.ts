// @vitest-environment jsdom
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridge, createConnectionBridge, type Conn } from '../web/bridge';

class FakeConn implements Conn {
  sent: any[] = [];
  msg: (m: any) => void = () => undefined;
  closed: () => void = () => undefined;
  close = vi.fn();
  send(m: any) { this.sent.push(m); }
  onMessage(cb: (m: any) => void) { this.msg = cb; }
  onClose(cb: () => void) { this.closed = cb; }
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('connection bridge', () => {
  it('queues calls made before a connection and flushes them on connect', async () => {
    const conn = new FakeConn();
    let go: (c: Conn) => void = () => undefined;
    const b = createConnectionBridge(() => new Promise<Conn>((r) => { go = r; }));
    const p = b.invoke('listSessions', 1, 2);
    go(conn);
    await b.ready;
    expect(conn.sent).toEqual([{ t: 'call', id: 1, name: 'listSessions', args: [1, 2] }]);
    conn.msg({ t: 'result', id: 1, ok: true, value: 'fine' });
    await expect(p).resolves.toBe('fine');
    const q = b.invoke('other');
    expect(conn.sent[1]).toMatchObject({ id: 2, name: 'other', args: [] });
    conn.msg({ t: 'result', id: 2, ok: false, error: 'boom' });
    await expect(q).rejects.toThrow('boom');
    conn.msg({ t: 'result', id: 99, ok: true, value: 1 }); // unknown id: ignored
  });

  it('does not report an unhandled rejection when the connection drops again while the state is being refreshed', async () => {
    const unhandled: unknown[] = [];
    const on = (e: unknown) => { unhandled.push(e); };
    process.on('unhandledRejection', on);
    try {
      const a = new FakeConn(), b2 = new FakeConn();
      const queue = [a, b2];
      const b = createConnectionBridge(async () => queue.shift()!);
      await b.ready;
      a.closed();                       // drop: it reconnects after the wait
      await vi.advanceTimersByTimeAsync(600);
      expect(b2.sent.map((m) => m.name)).toEqual(['getState']);
      b2.closed();                      // dropped again before the state came back
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    } finally { process.off('unhandledRejection', on); }
    expect(unhandled).toEqual([]);
  });

  it('delivers events to listeners until unsubscribed', async () => {
    const conn = new FakeConn();
    const b = createConnectionBridge(async () => conn);
    await b.ready;
    const a = vi.fn(), c = vi.fn();
    const off = b.on('notify' as any, a);
    b.on('notify' as any, c);
    conn.msg({ t: 'event', channel: 'notify', payload: { n: 1 } });
    off();
    conn.msg({ t: 'event', channel: 'notify', payload: { n: 2 } });
    conn.msg({ t: 'event', channel: 'nobody-listens', payload: 3 });
    expect(a.mock.calls).toEqual([[{ n: 1 }]]);
    expect(c).toHaveBeenCalledTimes(2);
  });

  it('rejects in-flight calls when the connection drops, then reconnects and re-asks for state', async () => {
    const conns = [new FakeConn(), new FakeConn()];
    const connect = vi.fn(async () => conns.shift()!);
    const first = conns[0], second = conns[1];
    const b = createConnectionBridge(connect);
    await b.ready;
    const state = vi.fn();
    b.on('state' as any, state);
    const inflight = b.invoke('slow');
    first.closed();
    await expect(inflight).rejects.toThrow('Connection to the server was lost');
    first.closed(); // a second close of a dead connection does nothing
    expect(connect).toHaveBeenCalledTimes(1);
    const queued = b.invoke('whileAway');
    await vi.advanceTimersByTimeAsync(500);
    expect(connect).toHaveBeenCalledTimes(2);
    // queued call and the getState refresh go out on the new connection
    expect(second.sent.map((m) => m.name)).toEqual(['whileAway', 'getState']);
    second.msg({ t: 'result', id: second.sent[1].id, ok: true, value: { fresh: true } });
    await flush();
    expect(state).toHaveBeenCalledWith({ fresh: true });
    second.msg({ t: 'result', id: second.sent[0].id, ok: true, value: null });
    await queued;
  });

  it('waits longer after each failed attempt, up to 10 seconds', async () => {
    const connect = vi.fn(async () => { throw new Error('down'); });
    createConnectionBridge(connect);
    await flush();
    expect(connect).toHaveBeenCalledTimes(1);
    const waits = [500, 1000, 2000, 4000, 8000, 10_000, 10_000];
    for (let i = 0; i < waits.length; i++) {
      await vi.advanceTimersByTimeAsync(waits[i] - 1);
      expect(connect).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(connect).toHaveBeenCalledTimes(i + 2);
    }
  });

  it('starts the wait over after a successful connection', async () => {
    const a = new FakeConn();
    let n = 0;
    const connect = vi.fn(async () => { n++; if (n === 1) throw new Error('x'); if (n === 2) return a; throw new Error('x'); });
    createConnectionBridge(connect);
    await vi.advanceTimersByTimeAsync(500); // second attempt succeeds
    expect(connect).toHaveBeenCalledTimes(2);
    a.msg({ t: 'result', id: a.sent[0].id, ok: true, value: {} }); // the state refresh
    a.closed();
    await vi.advanceTimersByTimeAsync(499);
    expect(connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(connect).toHaveBeenCalledTimes(3);
  });

  it('answers extra and local handlers without the server', async () => {
    const connect = vi.fn(async () => new FakeConn());
    const extra = { mine: vi.fn((x: number) => x + 1) };
    const b = createConnectionBridge(connect, extra);
    await expect(b.invoke('mine' as any, 1)).resolves.toBe(2);
    expect(b.hosted).toBe(true);
    expect(b.windowControls).toBe('none');
  });

  describe('local handlers', () => {
    const make = () => createConnectionBridge(async () => new FakeConn());

    it('opens only https links, in a new tab without opener', async () => {
      const open = vi.fn();
      vi.stubGlobal('open', open);
      const b = make();
      await b.invoke('openExternal' as any, 'https://example.com/a');
      await b.invoke('openExternal' as any, 'http://example.com');
      await b.invoke('openExternal' as any, 'javascript:alert(1)');
      expect(open.mock.calls).toEqual([['https://example.com/a', '_blank', 'noopener,noreferrer']]);
    });

    it('copies and reads the clipboard, reading as empty when refused', async () => {
      const writeText = vi.fn(async () => undefined);
      const readText = vi.fn(async () => 'pasted');
      vi.stubGlobal('navigator', { ...navigator, platform: 'Linux', clipboard: { writeText, readText } });
      const b = make();
      await b.invoke('copyText' as any, 'hi');
      expect(writeText).toHaveBeenCalledWith('hi');
      await expect(b.invoke('readClipboard' as any)).resolves.toBe('pasted');
      readText.mockRejectedValueOnce(new Error('denied'));
      await expect(b.invoke('readClipboard' as any)).resolves.toBe('');
    });

    it('asks for a folder name on the server, null when cancelled', async () => {
      const prompt = vi.fn().mockReturnValueOnce('/srv/x').mockReturnValueOnce('');
      vi.stubGlobal('prompt', prompt);
      const b = make();
      await expect(b.invoke('chooseFolder' as any)).resolves.toBe('/srv/x');
      await expect(b.invoke('chooseFolder' as any)).resolves.toBeNull();
    });

    it('cannot open a folder', async () => {
      await expect(make().invoke('openFolder' as any)).rejects.toThrow('not available in the browser');
    });
  });

  it('turns a download event into a text file link, and releases it later', async () => {
    const conn = new FakeConn();
    const b = createConnectionBridge(async () => conn);
    await b.ready;
    const create = vi.fn(() => 'blob:abc');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('r.md'); expect(this.href).toBe('blob:abc'); });
    const listener = vi.fn();
    b.on('download' as any, listener);
    conn.msg({ t: 'event', channel: 'download', payload: { name: 'r.md', text: '# hi' } });
    expect(click).toHaveBeenCalledTimes(1);
    const blob = (create.mock.calls[0] as any[])[0] as Blob;
    expect(await blob.text()).toBe('# hi');
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(listener).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(revoke).toHaveBeenCalledWith('blob:abc');
  });

  describe('open()', () => {
    it('waits for a navigate listener, then goes to the conversation tab', async () => {
      const b = createConnectionBridge(async () => new FakeConn());
      b.open('s1', 'input');
      await vi.advanceTimersByTimeAsync(350);
      const nav = vi.fn();
      b.on('navigate' as any, nav);
      expect(nav).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(nav).toHaveBeenCalledWith({ screen: 'session', id: 's1', tab: 'conversation' });
    });

    it('picks the changes tab for a ready session, immediately when already listening', () => {
      const b = createConnectionBridge(async () => new FakeConn());
      const nav = vi.fn();
      b.on('navigate' as any, nav);
      b.open('s2', 'ready');
      expect(nav).toHaveBeenCalledWith({ screen: 'session', id: 's2', tab: 'changes' });
    });

    it('gives up after about ten seconds without a listener', async () => {
      const b = createConnectionBridge(async () => new FakeConn());
      b.open('s', 'ready');
      await vi.advanceTimersByTimeAsync(11_000);
      const nav = vi.fn();
      b.on('navigate' as any, nav);
      await vi.advanceTimersByTimeAsync(1000);
      expect(nav).not.toHaveBeenCalled();
    });
  });

  describe('platform', () => {
    const platformFor = (p: string) => { vi.stubGlobal('navigator', { platform: p }); return createConnectionBridge(async () => new FakeConn()).platform; };
    it('maps navigator.platform to darwin, win32 or linux', () => {
      expect(platformFor('MacIntel')).toBe('darwin');
      expect(platformFor('Win32')).toBe('win32');
      expect(platformFor('Linux armv8l')).toBe('linux');
      expect(platformFor('iPhone')).toBe('linux');
    });
    it('is linux with no navigator', () => {
      delete (globalThis as any).navigator;
      expect(createConnectionBridge(async () => new FakeConn()).platform).toBe('linux');
    });
  });
});

class FakeWS {
  static all: FakeWS[] = [];
  onmessage: (e: { data: string }) => void = () => undefined;
  onclose: () => void = () => undefined;
  sent: string[] = [];
  close = vi.fn(() => this.onclose());
  constructor(public url: string) { FakeWS.all.push(this); }
  send(s: string) { this.sent.push(s); }
  say(m: unknown) { this.onmessage({ data: JSON.stringify(m) }); }
}

describe('createBridge over a WebSocket', () => {
  beforeEach(() => { FakeWS.all = []; vi.stubGlobal('WebSocket', FakeWS); });

  it('is usable on the ready message, and speaks JSON both ways', async () => {
    const b = createBridge('ws://h/ws');
    await flush();
    const ws = FakeWS.all[0];
    expect(ws.url).toBe('ws://h/ws');
    const call = b.invoke('hello', 'x');
    ws.say({ t: 'ready' });
    await b.ready;
    expect(JSON.parse(ws.sent[0])).toEqual({ t: 'call', id: 1, name: 'hello', args: ['x'] });
    ws.say({ t: 'result', id: 1, ok: true, value: 7 });
    await expect(call).resolves.toBe(7);
    const got = vi.fn();
    b.on('ping' as any, got);
    ws.say({ t: 'event', channel: 'ping', payload: 1 });
    expect(got).toHaveBeenCalledWith(1);
  });

  it('claims a session cookie when the server issues one, ignoring a failed claim', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    createBridge('ws://h/ws');
    FakeWS.all[0].say({ t: 'session', claim: 'tok' });
    expect(fetchMock).toHaveBeenCalledWith('/auth/claim', expect.objectContaining({ method: 'POST', body: JSON.stringify({ claim: 'tok' }), credentials: 'same-origin' }));
    await flush();
  });

  it('retries when the socket closes before ready', async () => {
    const b = createBridge('ws://h/ws');
    await flush();
    FakeWS.all[0].onclose();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1].say({ t: 'ready' });
    await b.ready;
  });

  it('reconnects after a close once ready, rejecting calls in flight', async () => {
    const b = createBridge('ws://h/ws');
    FakeWS.all[0].say({ t: 'ready' });
    await b.ready;
    const p = b.invoke('x');
    FakeWS.all[0].onclose();
    await expect(p).rejects.toThrow('lost');
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWS.all).toHaveLength(2);
  });
});
