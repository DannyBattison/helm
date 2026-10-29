import { createSocket } from 'node:dgram';
import type { Socket } from 'node:dgram';
import type { UdpSocket } from '../../shared/p2p/link';
import { isStun } from './stun';

/**
 * One UDP port, on IPv4 and IPv6, as a `UdpSocket` for the link, with STUN packets handed to `onStun` instead: the same socket asks the
 * STUN server, so what the server sees is the real mapping of the port the phone will be talking to. IPv6 is optional (not every computer has it).
 */
export class NodeUdp implements UdpSocket {
  private v4: Socket;
  private v6: Socket | null = null;
  private cb: ((d: Uint8Array, h: string, p: number) => void) | null = null;
  port = 0;

  constructor(private onStun: (d: Uint8Array) => void) {
    this.v4 = createSocket({ type: 'udp4', reuseAddr: false });
    this.v4.on('message', (m, r) => this.arrive(m, r.address, r.port));
    this.v4.on('error', () => undefined);
  }

  /** Binds `port` (0 for any free one) on every address. */
  async bind(port: number): Promise<number> {
    await new Promise<void>((resolve, reject) => { this.v4.once('error', reject); this.v4.bind(port, '0.0.0.0', () => { this.v4.off('error', reject); resolve(); }); });
    this.port = this.v4.address().port;
    const v6 = createSocket({ type: 'udp6', ipv6Only: true });
    v6.on('message', (m, r) => this.arrive(m, r.address.split('%')[0], r.port));
    v6.on('error', () => undefined);
    try {
      await new Promise<void>((resolve, reject) => { v6.once('error', reject); v6.bind(this.port, '::', () => { v6.off('error', reject); resolve(); }); });
      this.v6 = v6;
    } catch { try { v6.close(); } catch { /* never opened */ } }
    return this.port;
  }

  private arrive(m: Buffer, host: string, port: number) {
    const d = new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
    if (isStun(d)) this.onStun(d); else this.cb?.(d, host, port);
  }

  send(data: Uint8Array, host: string, port: number) {
    const s = host.includes(':') ? this.v6 : this.v4;
    try { s?.send(data, port, host, () => undefined); } catch { /* unreachable or closed */ }
  }
  onMessage(cb: (d: Uint8Array, h: string, p: number) => void) { this.cb = cb; }
  /** Closes after a moment, so the goodbye packets that were just sent get out. */
  close() {
    const socks = [this.v4, this.v6];
    this.v6 = null;
    this.cb = null;
    setTimeout(() => { for (const s of socks) { try { s?.close(); } catch { /* already closed */ } } }, 100).unref?.();
  }
}
