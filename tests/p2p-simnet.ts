import type { UdpSocket } from '../src/shared/p2p/link';

/** A pretend network for the p2p tests: datagrams that can be lost, duplicated, delayed and reordered, on the (fake) clock. */
export class SimNet {
  loss = 0;
  dupe = 0;
  maxDelay = 20;
  sent: { from: string; to: string; data: Uint8Array }[] = [];
  private socks = new Map<string, (d: Uint8Array, h: string, p: number) => void>();
  private state: number;
  constructor(seed = 1) { this.state = seed; }
  rnd() { this.state = (this.state * 1664525 + 1013904223) >>> 0; return this.state / 2 ** 32; }

  private source = new Map<string, { host: string; port: number }>();

  /** The device at `addr` is now seen at `to` (a phone changing network): its packets arrive from there, and packets for there reach it. */
  move(addr: string, to: string) {
    const [h, p] = to.split(':');
    this.source.set(addr, { host: h, port: +p });
    const cb = this.socks.get(addr);
    if (cb) this.socks.set(to, cb);
  }

  socket(host: string, port: number): UdpSocket & { addr: string } {
    const addr = `${host}:${port}`;
    return {
      addr,
      send: (data, h, p) => {
        const to = `${h}:${p}`;
        this.sent.push({ from: addr, to, data: data.slice() });
        if (this.rnd() < this.loss) return;
        for (let i = 0; i < (this.rnd() < this.dupe ? 2 : 1); i++) {
          const copy = data.slice();
          const src = this.source.get(addr) ?? { host, port };
          setTimeout(() => this.socks.get(to)?.(copy, src.host, src.port), 1 + this.rnd() * this.maxDelay);
        }
      },
      onMessage: (cb) => { this.socks.set(addr, cb); },
      close: () => { this.socks.delete(addr); }
    };
  }
}
