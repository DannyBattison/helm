import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeUdp } from '../src/core/p2p/udp';
import { bindingRequest } from '../src/core/p2p/stun';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); cleanups.splice(0).forEach((c) => c()); });

const peer = async (type: 'udp4' | 'udp6', host: string) => {
  const s = createSocket(type);
  const got: { d: Buffer; port: number; address: string }[] = [];
  s.on('message', (d, r) => got.push({ d, port: r.port, address: r.address }));
  await new Promise<void>((r) => s.bind(0, host, r));
  cleanups.push(() => s.close());
  return { s, got, port: s.address().port };
};
const sendTo = (s: Socket, data: Uint8Array, port: number, host: string) => new Promise<void>((r) => s.send(data, port, host, () => r()));

describe('NodeUdp', () => {
  it('hands helm packets to the link and STUN packets to onStun, never both', async () => {
    const stun: Uint8Array[] = [];
    const u = new NodeUdp((d) => stun.push(d));
    const link: { d: Uint8Array; h: string; p: number }[] = [];
    u.onMessage((d, h, p) => link.push({ d, h, p }));
    const port = await u.bind(0);
    expect(port).toBeGreaterThan(0);
    expect(u.port).toBe(port);
    cleanups.push(() => u.close());
    const other = await peer('udp4', '127.0.0.1');
    await sendTo(other.s, Uint8Array.of(1, 2, 3), port, '127.0.0.1');
    await sendTo(other.s, bindingRequest().packet, port, '127.0.0.1');
    await vi.waitFor(() => expect(link.length + stun.length).toBe(2));
    expect(link).toHaveLength(1);
    expect([...link[0].d]).toEqual([1, 2, 3]);
    expect(link[0]).toMatchObject({ h: '127.0.0.1', p: other.port });
    expect(stun).toHaveLength(1);
    expect(stun[0]).toHaveLength(20);
  });

  it('drops helm packets quietly when nobody is listening', async () => {
    const u = new NodeUdp(() => undefined);
    const port = await u.bind(0);
    cleanups.push(() => u.close());
    const other = await peer('udp4', '127.0.0.1');
    await sendTo(other.s, Uint8Array.of(1), port, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 50));
    // still alive afterwards
    const seen: number[] = [];
    u.onMessage((d) => seen.push(d[0]));
    await sendTo(other.s, Uint8Array.of(2), port, '127.0.0.1');
    await vi.waitFor(() => expect(seen).toEqual([2]));
  });

  it('sends to IPv4 hosts from the v4 socket and IPv6 hosts from the v6 socket, from the same port', async () => {
    const u = new NodeUdp(() => undefined);
    const port = await u.bind(0);
    cleanups.push(() => u.close());
    const four = await peer('udp4', '127.0.0.1');
    u.send(Uint8Array.of(4), '127.0.0.1', four.port);
    await vi.waitFor(() => expect(four.got).toHaveLength(1));
    expect(four.got[0].port).toBe(port);
    let six;
    try { six = await peer('udp6', '::1'); } catch { return; } // no IPv6 on this machine
    u.send(Uint8Array.of(6), '::1', six.port);
    await vi.waitFor(() => expect(six.got).toHaveLength(1));
    expect(six.got[0].port).toBe(port);
    // and IPv6 arrivals reach the link with the address as the sender wrote it
    const link: string[] = [];
    u.onMessage((_d, h) => link.push(h));
    await sendTo(six.s, Uint8Array.of(9), port, '::1');
    await vi.waitFor(() => expect(link).toEqual(['::1']));
  });

  it('is fine with IPv6 being unavailable: sends to IPv6 hosts are dropped', async () => {
    const real = (await import('node:dgram')).createSocket;
    vi.resetModules();
    vi.doMock('node:dgram', async (orig) => {
      const m: any = await orig();
      return { ...m, createSocket: (o: any) => {
        const s = real(o);
        if (o?.type === 'udp6') s.bind = (() => { queueMicrotask(() => s.emit('error', new Error('EAFNOSUPPORT'))); return s; }) as any;
        return s;
      } };
    });
    try {
      const { NodeUdp: Fake } = await import('../src/core/p2p/udp');
      const u = new Fake(() => undefined);
      await expect(u.bind(0)).resolves.toBeGreaterThan(0);
      cleanups.push(() => u.close());
      expect(() => u.send(Uint8Array.of(1), '::1', 9)).not.toThrow();
      const four = await peer('udp4', '127.0.0.1');
      u.send(Uint8Array.of(4), '127.0.0.1', four.port);
      await vi.waitFor(() => expect(four.got).toHaveLength(1));
    } finally { vi.doUnmock('node:dgram'); vi.resetModules(); }
  });

  it('rejects a bind to a port that is taken', async () => {
    const a = new NodeUdp(() => undefined);
    const port = await a.bind(0);
    cleanups.push(() => a.close());
    const b = new NodeUdp(() => undefined);
    await expect(b.bind(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
    b.close();
  });

  it('tolerates a send that throws (a closed socket)', async () => {
    const u = new NodeUdp(() => undefined);
    await u.bind(0);
    u.close();
    await new Promise((r) => setTimeout(r, 250));
    expect(() => u.send(Uint8Array.of(1), '127.0.0.1', 9)).not.toThrow();
  });

  it('closes after about 100 ms, so a goodbye sent just before still leaves', async () => {
    const u = new NodeUdp(() => undefined);
    await u.bind(0);
    const other = await peer('udp4', '127.0.0.1');
    const link: number[] = [];
    u.onMessage((d) => link.push(d[0]));
    u.send(Uint8Array.of(7), '127.0.0.1', other.port);
    u.close();
    // the goodbye gets out even though close() was already called
    await vi.waitFor(() => expect(other.got).toHaveLength(1));
    // the link is detached at once...
    await sendTo(other.s, Uint8Array.of(8), u.port, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 30));
    expect(link).toEqual([]);
    // ...and the port is released a moment later
    await new Promise((r) => setTimeout(r, 250));
    const again = new NodeUdp(() => undefined);
    await expect(again.bind(u.port)).resolves.toBe(u.port);
    again.close();
  });

  it('delays the real close by 100 ms', async () => {
    vi.useFakeTimers();
    const u = new NodeUdp(() => undefined);
    const spies = (u as any).v4 as Socket;
    const close = vi.spyOn(spies, 'close').mockImplementation((() => spies) as any);
    u.close();
    await vi.advanceTimersByTimeAsync(99);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledTimes(1);
    u.close(); // second close is harmless
    await vi.advanceTimersByTimeAsync(100);
  });
});
