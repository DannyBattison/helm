import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** A pretend home router on 127.0.0.1: answers SSDP, serves a UPnP description and takes SOAP calls, and speaks NAT-PMP. */
export async function fakeRouter(o: { externalIp?: string; permanentOnly?: boolean; taken?: number[]; upnp?: boolean; natpmp?: boolean } = {}) {
  const externalIp = o.externalIp ?? '203.0.113.9';
  const mappings = new Map<number, { client: string; internal: number; lease: number }>();
  const pmp = new Map<number, { internal: number; lifetime: number }>();
  const log: string[] = [];

  const http = createServer((req, res) => {
    if (req.url === '/desc.xml') {
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
      if (action === 'GetExternalIPAddress') return ok(`<NewExternalIPAddress>${externalIp}</NewExternalIPAddress>`);
      if (action === 'AddPortMapping') {
        const lease = +field('NewLeaseDuration');
        if (o.permanentOnly && lease !== 0) return fail(725);
        if (o.taken?.includes(port) || mappings.has(port)) return fail(718);
        mappings.set(port, { client: field('NewInternalClient'), internal: +field('NewInternalPort'), lease });
        return ok();
      }
      if (action === 'GetSpecificPortMappingEntry') {
        const m = mappings.get(port);
        return m ? ok(`<NewInternalPort>${m.internal}</NewInternalPort><NewInternalClient>${m.client}</NewInternalClient>`) : fail(714);
      }
      if (action === 'DeletePortMapping') { mappings.delete(port); return ok(); }
      fail(401, 400);
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

  const ssdp = createSocket('udp4');
  ssdp.on('message', (m, r) => {
    if (o.upnp === false || !m.toString().startsWith('M-SEARCH')) return;
    ssdp.send(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://127.0.0.1:${(http.address() as AddressInfo).port}/desc.xml\r\nST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n`, r.port, r.address);
  });
  await new Promise<void>((r) => ssdp.bind(0, '127.0.0.1', r));

  const natpmp = createSocket('udp4');
  natpmp.on('message', (m, r) => {
    if (o.natpmp === false) return;
    if (m[1] === 0) { const b = Buffer.alloc(12); b[1] = 128; Buffer.from(externalIp.split('.').map(Number)).copy(b, 8); natpmp.send(b, r.port, r.address); return; }
    if (m[1] === 1) {
      const internal = m.readUInt16BE(4), external = m.readUInt16BE(6), lifetime = m.readUInt32BE(8);
      if (lifetime === 0) pmp.delete(internal); else pmp.set(internal, { internal: external || internal, lifetime });
      const b = Buffer.alloc(16); b[1] = 129; b.writeUInt16BE(internal, 8); b.writeUInt16BE(external || internal, 10); b.writeUInt32BE(lifetime, 12);
      natpmp.send(b, r.port, r.address);
    }
  });
  await new Promise<void>((r) => natpmp.bind(0, '127.0.0.1', r));

  return {
    mappings, pmp, log, externalIp,
    options: { ssdpHost: '127.0.0.1', ssdpPort: (ssdp.address() as AddressInfo).port, natpmpPort: (natpmp.address() as AddressInfo).port, gateway: async () => '127.0.0.1', localAddresses: () => ['127.0.0.1'], waitMs: 600 },
    close() { http.close(); http.closeAllConnections(); ssdp.close(); natpmp.close(); }
  };
}
