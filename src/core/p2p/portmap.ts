import { execFile } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { isCgnat4, isPrivate4 } from './addresses';

/**
 * Asks the home router to forward the UDP port to this computer, so a phone elsewhere can reach it: UPnP first (SSDP discovery, then SOAP to
 * the router's WAN connection service), NAT-PMP if that finds nothing. Both are written out here, with no libraries. Unlike a permanent
 * mapping, this one has a lease (an hour) that is renewed while helm runs, so a crash leaves nothing behind for long; routers that only
 * allow permanent leases get one, and it is deleted when helm stops.
 */
export interface Mapping { method: 'upnp' | 'natpmp'; externalIp: string; externalPort: number }

export interface PortMapOptions {
  /** Where SSDP searches go. The multicast address in real use; tests point it at a fake router. */
  ssdpHost?: string;
  ssdpPort?: number;
  /** NAT-PMP's port on the gateway (5351). */
  natpmpPort?: number;
  gateway?: () => Promise<string | null>;
  /** The IPv4 addresses of this computer to search from, one per network. */
  localAddresses?: () => string[];
  leaseSeconds?: number;
  /** How long to wait for a router to answer. */
  waitMs?: number;
}

const SEARCH_TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2'];
const WAN_SERVICES = /urn:schemas-upnp-org:service:(WANIPConnection|WANPPPConnection):\d/;

export const lanAddresses = () => Object.values(networkInterfaces()).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal && isPrivate4(i.address)).map((i) => i.address);

/** True if an address is one the internet can reach: not private, not carrier-grade NAT, not link-local. */
export const isPublic4 = (a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a) && !isPrivate4(a) && !isCgnat4(a) && !a.startsWith('169.254.') && !a.startsWith('127.') && a !== '0.0.0.0';

// ------------------------------------------------------------------------------------------------ the pieces that can be read without a router
/** The headers of an SSDP answer. */
export function parseSsdp(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim(); }
  return out;
}

/** The WAN connection service in a device description: its type and the absolute URL to send commands to. */
export function findWanService(xml: string, location: string): { type: string; control: string } | null {
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/g) ?? []) {
    const type = /<serviceType>\s*([^<\s]+)\s*<\/serviceType>/.exec(block)?.[1];
    const control = /<controlURL>\s*([^<\s]+)\s*<\/controlURL>/.exec(block)?.[1];
    if (type && control && WAN_SERVICES.test(type)) {
      const base = /<URLBase>\s*([^<\s]+)\s*<\/URLBase>/.exec(xml)?.[1] ?? location;
      try { return { type, control: new URL(control, base).toString() }; } catch { return null; }
    }
  }
  return null;
}

export const soapBody = (type: string, action: string, args: Record<string, string | number>) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${type}">${Object.entries(args).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;

export const soapError = (xml: string) => { const m = /<errorCode>\s*(\d+)\s*<\/errorCode>/.exec(xml); return m ? +m[1] : null; };

/** The gateway out of a routing table, per platform. */
export function gatewayFromLinuxRoutes(table: string): string | null {
  for (const line of table.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f[1] === '00000000' && f[2] && f[2] !== '00000000') return [6, 4, 2, 0].map((i) => parseInt(f[2].slice(i, i + 2), 16)).join('.');
  }
  return null;
}
export const gatewayFromDarwin = (out: string) => /gateway:\s*(\d+\.\d+\.\d+\.\d+)/.exec(out)?.[1] ?? null;
export const gatewayFromWindows = (out: string) => /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m.exec(out)?.[1] ?? null;

const run = (cmd: string, args: string[]) => new Promise<string>((resolve) => execFile(cmd, args, { timeout: 3000 }, (_e, out) => resolve(String(out || ''))));

/** The default gateway, the router NAT-PMP is spoken to. */
export async function defaultGateway(): Promise<string | null> {
  try {
    if (process.platform === 'linux') return gatewayFromLinuxRoutes(await readFile('/proc/net/route', 'utf8'));
    if (process.platform === 'darwin') return gatewayFromDarwin(await run('route', ['-n', 'get', 'default']));
    if (process.platform === 'win32') return gatewayFromWindows(await run('route', ['print', '-4', '0.0.0.0']));
  } catch { /* not found */ }
  return null;
}

/** NAT-PMP packets (RFC 6886). */
export const natpmpExternalRequest = () => Uint8Array.of(0, 0);
export function natpmpMapRequest(internalPort: number, externalPort: number, lifetime: number): Uint8Array {
  const b = new Uint8Array(12);
  const v = new DataView(b.buffer);
  b[1] = 1; // map UDP
  v.setUint16(4, internalPort); v.setUint16(6, externalPort); v.setUint32(8, lifetime);
  return b;
}
export function parseNatpmp(b: Uint8Array): { op: number; result: number; ip?: string; internalPort?: number; externalPort?: number; lifetime?: number } | null {
  if (b.length < 8 || b[0] !== 0) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const op = b[1], result = v.getUint16(2);
  if (op === 128 && b.length >= 12) return { op, result, ip: Array.from(b.subarray(8, 12)).join('.') };
  if (op === 129 && b.length >= 16) return { op, result, internalPort: v.getUint16(8), externalPort: v.getUint16(10), lifetime: v.getUint32(12) };
  return { op, result };
}

// ------------------------------------------------------------------------------------------------ talking to a router
export class PortMapper {
  private opts: Required<PortMapOptions>;
  private upnp: { type: string; control: string; externalPort: number; internalClient: string } | null = null;
  private pmp: { gateway: string; externalPort: number } | null = null;
  private port = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(o: PortMapOptions = {}) {
    this.opts = { ssdpHost: o.ssdpHost ?? '239.255.255.250', ssdpPort: o.ssdpPort ?? 1900, natpmpPort: o.natpmpPort ?? 5351, gateway: o.gateway ?? defaultGateway, localAddresses: o.localAddresses ?? lanAddresses, leaseSeconds: o.leaseSeconds ?? 3600, waitMs: o.waitMs ?? 2000 };
  }

  /** Forwards `port` (UDP) to this computer. Null if no router agreed, or if the address it reports is not one the internet can reach. */
  async map(port: number): Promise<{ mapping: Mapping | null; note?: string }> {
    this.port = port;
    this.stopped = false;
    const found = (await this.mapUpnp(port).catch(() => null)) ?? (await this.mapNatpmp(port).catch(() => null));
    if (!found) return { mapping: null, note: 'No router answered a UPnP or NAT-PMP request. It may have them turned off; forward the port by hand if you need it.' };
    if (!isPublic4(found.externalIp)) {
      await this.unmap();
      return { mapping: null, note: `The router reports ${found.externalIp} as its address, which is not reachable from the internet (the router is behind another NAT, or your provider shares addresses). The port was not left forwarded.` };
    }
    this.renewLater();
    return { mapping: found };
  }

  // ---- UPnP
  private async mapUpnp(port: number): Promise<Mapping | null> {
    for (const local of this.opts.localAddresses()) {
      const location = await this.search(local);
      if (!location) continue;
      const xml = await getText(location, 3000);
      const svc = xml && findWanService(xml, location);
      if (!svc) continue;
      const call = (action: string, args: Record<string, string | number>) => soap(svc.control, svc.type, action, args);
      const ip = /<NewExternalIPAddress>\s*([^<\s]*)\s*<\/NewExternalIPAddress>/.exec((await call('GetExternalIPAddress', {})).body)?.[1];
      if (!ip) continue;
      // The same external port if the router will, else the next few (it may have it for another computer).
      for (let external = port; external < port + 5; external++) {
        let lease = this.opts.leaseSeconds;
        let r = await call('AddPortMapping', add(external, port, local, lease));
        if (soapError(r.body) === 725) { lease = 0; r = await call('AddPortMapping', add(external, port, local, 0)); }
        const err = soapError(r.body);
        if (err === 718) continue;
        if (!r.ok || err) break;
        // Do not trust "OK": read it back.
        const back = await call('GetSpecificPortMappingEntry', { NewRemoteHost: '', NewExternalPort: external, NewProtocol: 'UDP' });
        if (!new RegExp(`<NewInternalClient>\\s*${local.replace(/\./g, '\\.')}\\s*</NewInternalClient>`).test(back.body)) break;
        this.upnp = { ...svc, externalPort: external, internalClient: local };
        return { method: 'upnp', externalIp: ip, externalPort: external };
      }
    }
    return null;
  }

  /** M-SEARCH from one local address; the LOCATION of the first router that answers. */
  private search(local: string): Promise<string | null> {
    return new Promise((resolve) => {
      const sock = createSocket('udp4');
      const done = (v: string | null) => { clearTimeout(t); try { sock.close(); } catch { /* closed */ } resolve(v); };
      const t = setTimeout(() => done(null), this.opts.waitMs);
      sock.on('error', () => done(null));
      sock.on('message', (m) => { const loc = parseSsdp(m.toString())['location']; if (loc && /^https?:\/\//.test(loc)) done(loc); });
      sock.bind(0, local, () => {
        for (const st of SEARCH_TARGETS) sock.send(`M-SEARCH * HTTP/1.1\r\nHOST: ${this.opts.ssdpHost}:${this.opts.ssdpPort}\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${st}\r\n\r\n`, this.opts.ssdpPort, this.opts.ssdpHost);
      });
    });
  }

  // ---- NAT-PMP
  private async mapNatpmp(port: number): Promise<Mapping | null> {
    const gateway = await this.opts.gateway();
    if (!gateway) return null;
    const ip = await this.pmpExchange(gateway, natpmpExternalRequest());
    const ext = ip && parseNatpmp(ip);
    if (!ext || ext.result !== 0 || !ext.ip) return null;
    const m = await this.pmpExchange(gateway, natpmpMapRequest(port, port, this.opts.leaseSeconds));
    const got = m && parseNatpmp(m);
    if (!got || got.result !== 0 || got.op !== 129 || !got.externalPort) return null;
    this.pmp = { gateway, externalPort: got.externalPort };
    return { method: 'natpmp', externalIp: ext.ip, externalPort: got.externalPort };
  }

  /** One request and its answer, asked again after 250 ms and 500 ms as the protocol does. */
  private pmpExchange(gateway: string, request: Uint8Array): Promise<Uint8Array | null> {
    return new Promise((resolve) => {
      const sock = createSocket('udp4');
      const timers: ReturnType<typeof setTimeout>[] = [];
      const done = (v: Uint8Array | null) => { timers.forEach(clearTimeout); try { sock.close(); } catch { /* closed */ } resolve(v); };
      sock.on('error', () => done(null));
      sock.on('message', (m, r) => { if (r.address === gateway) done(new Uint8Array(m)); });
      for (const [i, at] of [0, 250, 750].entries()) timers.push(setTimeout(() => sock.send(request, this.opts.natpmpPort, gateway, () => undefined), at + i * 0));
      timers.push(setTimeout(() => done(null), 1750));
    });
  }

  // ---- keeping it, and giving it back
  private renewLater() {
    if (this.timer) clearTimeout(this.timer);
    const wait = Math.max(30, this.opts.leaseSeconds / 2) * 1000;
    this.timer = setTimeout(() => void this.renew(), wait);
    (this.timer as any).unref?.();
  }

  private async renew() {
    if (this.stopped) return;
    // Asking again is how both protocols renew. If the router has forgotten (it rebooted), this makes the mapping again.
    const r = this.upnp ? await this.mapUpnp(this.port).catch(() => null) : this.pmp ? await this.mapNatpmp(this.port).catch(() => null) : null;
    if (!r) this.upnp = this.pmp = null;
    else this.onRenewed?.(r);
    this.renewLater();
  }
  onRenewed?: (m: Mapping) => void;

  /** Takes the forwarding away again. */
  async unmap() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const u = this.upnp, p = this.pmp;
    this.upnp = this.pmp = null;
    if (u) await soap(u.control, u.type, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: u.externalPort, NewProtocol: 'UDP' }).catch(() => undefined);
    if (p) await this.pmpExchange(p.gateway, natpmpMapRequest(this.port, 0, 0)).catch(() => undefined);
  }
}

const add = (external: number, internal: number, client: string, lease: number) => ({ NewRemoteHost: '', NewExternalPort: external, NewProtocol: 'UDP', NewInternalPort: internal, NewInternalClient: client, NewEnabled: 1, NewPortMappingDescription: 'helm', NewLeaseDuration: lease });

async function getText(url: string, ms: number): Promise<string | null> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(ms) }); return r.ok ? await r.text() : null; } catch { return null; }
}

async function soap(url: string, type: string, action: string, args: Record<string, string | number>): Promise<{ ok: boolean; body: string }> {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${type}#${action}"` }, body: soapBody(type, action, args), signal: AbortSignal.timeout(4000) });
    return { ok: r.ok, body: await r.text() };
  } catch { return { ok: false, body: '' }; }
}
