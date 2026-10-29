import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A pretend home router on 127.0.0.1: answers SSDP, serves a UPnP description and takes SOAP calls, and speaks NAT-PMP. */
export interface RouterOptions {
  externalIp?: string; permanentOnly?: boolean; taken?: number[]; upnp?: boolean; natpmp?: boolean;
  /** The device description has no WAN connection service. */
  noWan?: boolean;
  /** The device description cannot be fetched (HTTP status). */
  descStatus?: number;
  /** SOAP actions that fail with this UPnP error code (HTTP 500). */
  fault?: Record<string, number>;
  /** GetSpecificPortMappingEntry names this client instead of the one that asked. */
  readBackClient?: string;
  /** GetExternalIPAddress answers with an empty address. */
  emptyIp?: boolean;
  /** SSDP answers with this text instead of a proper reply. */
  ssdpReply?: string;
  /** NAT-PMP: result code for the external-address request / the map request. */
  pmpIpResult?: number;
  pmpMapResult?: number;
  /** NAT-PMP: op code put in the map answer instead of 129. */
  pmpMapOp?: number;
  /** NAT-PMP: ignore this many requests before answering (to make the client retry). */
  pmpDrop?: number;
  /** NAT-PMP: every answer is preceded by a false one (a different address, 6.6.6.6 / port 6666) sent from 127.0.0.2, which the client should not believe. */
  pmpImpostor?: boolean;
  /** NAT-PMP: answer the map request with external port 0. */
  pmpNoPort?: boolean;
}

/** A pretend home router on 127.0.0.1: answers SSDP, serves a UPnP description and takes SOAP calls, and speaks NAT-PMP. The options can be changed later through `opts`. */
export async function fakeRouter(o: RouterOptions = {}) {
  const externalIp = o.externalIp ?? '203.0.113.9';
  const mappings = new Map<number, { client: string; internal: number; lease: number }>();
  const pmp = new Map<number, { internal: number; lifetime: number }>();
  const log: string[] = [];

  const http = createServer((req, res) => {
    if (req.url === '/desc.xml') {
      if (o.descStatus) { res.statusCode = o.descStatus; res.end('no'); return; }
      if (o.noWan) { res.end('<root><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3</controlURL></service></serviceList></device></root>'); return; }
      res.end(`<root><URLBase>http://127.0.0.1:${(http.address() as AddressInfo).port}/</URLBase><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl</controlURL></service></serviceList></device></root>`);
      return;
    }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const action = /#(\w+)"/.exec(String(req.headers.soapaction))?.[1] ?? '';
      log.push(action);
      const field = (n: string) => new RegExp(`<${n}>([^<]*)</${n}>`).exec(body)?.[1] ?? '';
      const fail = (code: number, status = 500) => { res.statusCode = status; res.end(`<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>${code}</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>`); };
      const ok = (inner = '') => res.end(`<s:Envelope><s:Body><u:${action}Response>${inner}</u:${action}Response></s:Body></s:Envelope>`);
      const port = +field('NewExternalPort');
      if (o.fault?.[action]) return fail(o.fault[action]);
      if (action === 'GetExternalIPAddress') return ok(`<NewExternalIPAddress>${o.emptyIp ? '' : externalIp}</NewExternalIPAddress>`);
      if (action === 'AddPortMapping') {
        const lease = +field('NewLeaseDuration');
        if (o.permanentOnly && lease !== 0) return fail(725);
        if (o.taken?.includes(port) || mappings.has(port)) return fail(718);
        mappings.set(port, { client: field('NewInternalClient'), internal: +field('NewInternalPort'), lease });
        return ok();
      }
      if (action === 'GetSpecificPortMappingEntry') {
        const m = mappings.get(port);
        return m ? ok(`<NewInternalPort>${m.internal}</NewInternalPort><NewInternalClient>${o.readBackClient ?? m.client}</NewInternalClient>`) : fail(714);
      }
      if (action === 'DeletePortMapping') { mappings.delete(port); return ok(); }
      fail(401, 400);
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

  const ssdp = createSocket('udp4');
  ssdp.on('message', (m, r) => {
    if (o.upnp === false || !m.toString().startsWith('M-SEARCH')) return;
    if (o.ssdpReply !== undefined) { ssdp.send(o.ssdpReply, r.port, r.address); return; }
    ssdp.send(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://127.0.0.1:${(http.address() as AddressInfo).port}/desc.xml\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n`, r.port, r.address);
  });
  await new Promise<void>((r) => ssdp.bind(0, '127.0.0.1', r));

  const natpmp = createSocket('udp4');
  let dropped = 0;
  const reply = (b: Buffer, r: { port: number; address: string }) => {
    if (o.pmpImpostor) {
      const fake = Buffer.from(b);
      if (b[1] === 128) fake.set([6, 6, 6, 6], 8); else fake.writeUInt16BE(6666, 10);
      impostor.send(fake, r.port, r.address);
    }
    natpmp.send(b, r.port, r.address);
  };
  natpmp.on('message', (m, r) => {
    if (o.natpmp === false) return;
    if (dropped < (o.pmpDrop ?? 0)) { dropped++; return; }
    if (m[1] === 0) { const b = Buffer.alloc(12); b.writeUInt16BE(o.pmpIpResult ?? 0, 2); b[1] = 128; Buffer.from(externalIp.split('.').map(Number)).copy(b, 8); reply(b, r); return; }
    if (m[1] === 1) {
      const internal = m.readUInt16BE(4), external = m.readUInt16BE(6), lifetime = m.readUInt32BE(8);
      if (lifetime === 0) pmp.delete(internal); else pmp.set(internal, { internal: external || internal, lifetime });
      const b = Buffer.alloc(16); b[1] = o.pmpMapOp ?? 129; b.writeUInt16BE(o.pmpMapResult ?? 0, 2); b.writeUInt16BE(internal, 8); b.writeUInt16BE(o.pmpNoPort ? 0 : external || internal, 10); b.writeUInt32BE(lifetime, 12);
      reply(b, r);
    }
  });
  await new Promise<void>((r) => natpmp.bind(0, '127.0.0.1', r));
  const impostor = createSocket('udp4');
  await new Promise<void>((r) => impostor.bind(0, '127.0.0.2', r));

  return {
    mappings, pmp, log, externalIp, opts: o,
    options: { ssdpHost: '127.0.0.1', ssdpPort: (ssdp.address() as AddressInfo).port, natpmpPort: (natpmp.address() as AddressInfo).port, gateway: async () => '127.0.0.1', localAddresses: () => ['127.0.0.1'], waitMs: 600 },
    close() { http.close(); http.closeAllConnections(); ssdp.close(); natpmp.close(); impostor.close(); }
  };
}
