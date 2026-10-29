import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortMapper, findWanService, gatewayFromDarwin, gatewayFromLinuxRoutes, gatewayFromWindows, isPublic4, natpmpMapRequest, parseNatpmp, parseSsdp, soapBody, soapError } from '../src/core/p2p/portmap';
import { P2P } from '../src/core/p2p/service';
import { fakeRouter } from './p2p-router';

const closers: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); });
const router = async (o: Parameters<typeof fakeRouter>[0] = {}) => { const r = await fakeRouter(o); closers.push(() => r.close()); return r; };

describe('reading what routers say', () => {
  it('finds the router address in a routing table, whichever platform', () => {
    expect(gatewayFromLinuxRoutes('Iface\tDestination\tGateway\tFlags\neth0\t00000000\t0101A8C0\t0003\neth0\t0001A8C0\t00000000\t0001')).toBe('192.168.1.1');
    expect(gatewayFromLinuxRoutes('Iface\tDestination\tGateway\nlo\t0001A8C0\t00000000')).toBeNull();
    expect(gatewayFromDarwin('   route to: default\n    gateway: 10.0.0.1\n  interface: en0')).toBe('10.0.0.1');
    expect(gatewayFromWindows('Network Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.20     25')).toBe('192.168.0.1');
  });
  it('reads an SSDP answer, a device description and a SOAP fault', () => {
    expect(parseSsdp('HTTP/1.1 200 OK\r\nLocation: http://192.168.1.1:5000/rootDesc.xml\r\nST: x\r\n\r\n')['location']).toBe('http://192.168.1.1:5000/rootDesc.xml');
    const xml = '<root><device><service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType><controlURL>/ppp</controlURL></service></device></root>';
    expect(findWanService(xml, 'http://192.168.1.1:5000/rootDesc.xml')).toEqual({ type: 'urn:schemas-upnp-org:service:WANPPPConnection:1', control: 'http://192.168.1.1:5000/ppp' });
    expect(findWanService('<root/>', 'http://x/')).toBeNull();
    expect(soapError('<errorCode>725</errorCode>')).toBe(725);
    expect(soapBody('urn:t', 'Do', { A: 1 })).toContain('<u:Do xmlns:u="urn:t"><A>1</A></u:Do>');
  });
  it('reads NAT-PMP answers and builds the mapping request', () => {
    const ip = new Uint8Array(12); ip[1] = 128; ip.set([203, 0, 113, 9], 8);
    expect(parseNatpmp(ip)).toMatchObject({ result: 0, ip: '203.0.113.9' });
    const req = natpmpMapRequest(4000, 4001, 3600);
    expect([req[1], (req[4] << 8) | req[5], (req[6] << 8) | req[7]]).toEqual([1, 4000, 4001]);
    expect(parseNatpmp(new Uint8Array(3))).toBeNull();
  });
  it('knows which addresses the internet can reach', () => {
    for (const a of ['203.0.113.9', '8.8.8.8']) expect(isPublic4(a)).toBe(true);
    for (const a of ['192.168.1.1', '10.1.1.1', '172.16.0.4', '100.64.3.3', '169.254.1.1', '0.0.0.0', 'nope']) expect(isPublic4(a)).toBe(false);
  });
});

describe('asking a router to forward the port', () => {
  it('maps with UPnP, reads it back, and takes it away again', async () => {
    const r = await router();
    const m = new PortMapper(r.options);
    const { mapping } = await m.map(4000);
    expect(mapping).toEqual({ method: 'upnp', externalIp: '203.0.113.9', externalPort: 4000 });
    // A lease that runs out by itself, so a crash leaves nothing forever.
    expect(r.mappings.get(4000)).toEqual({ client: '127.0.0.1', internal: 4000, lease: 3600 });
    expect(r.log).toEqual(['GetExternalIPAddress', 'AddPortMapping', 'GetSpecificPortMappingEntry']);
    await m.unmap();
    expect(r.mappings.size).toBe(0);
  });

  it('falls back to a permanent lease for a router that only allows those, and to another port if one is taken', async () => {
    const r = await router({ permanentOnly: true, taken: [4000, 4001] });
    const { mapping } = await new PortMapper(r.options).map(4000);
    expect(mapping?.externalPort).toBe(4002);
    expect(r.mappings.get(4002)?.lease).toBe(0);
  });

  it('uses NAT-PMP when there is no UPnP, and gives it back', async () => {
    const r = await router({ upnp: false });
    const m = new PortMapper(r.options);
    const { mapping } = await m.map(4000);
    expect(mapping).toEqual({ method: 'natpmp', externalIp: '203.0.113.9', externalPort: 4000 });
    expect(r.pmp.get(4000)?.lifetime).toBe(3600);
    await m.unmap();
    expect(r.pmp.size).toBe(0);
  });

  it('does not leave a forwarding behind that could never work: a router address that is private', async () => {
    const r = await router({ externalIp: '192.168.100.2' });
    const m = new PortMapper(r.options);
    const out = await m.map(4000);
    expect(out.mapping).toBeNull();
    expect(out.note).toMatch(/not reachable from the internet/);
    expect(r.mappings.size).toBe(0);
  });

  it('says so when no router answers', async () => {
    const r = await router({ upnp: false, natpmp: false });
    const out = await new PortMapper({ ...r.options, waitMs: 300 }).map(4000);
    expect(out.mapping).toBeNull();
    expect(out.note).toMatch(/No router answered/);
  });

  it('asks again before the lease runs out, so it is kept, and makes it again if the router forgot', async () => {
    const r = await router();
    const m = new PortMapper({ ...r.options, leaseSeconds: 60, renewMs: 150 });
    const seen: unknown[] = [];
    m.onRenewed = (x) => seen.push(x);
    await m.map(4000);
    r.mappings.clear(); // the router rebooted
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 4000 });
    expect(r.mappings.get(4000)?.lease).toBe(60);
    await m.unmap();
    const after = r.log.length;
    await new Promise((res) => setTimeout(res, 400));
    expect(r.log.length).toBe(after);
  });
});

describe('in the desktop service', () => {
  it('puts the forwarded address first in the code, shows what happened, and gives the port back on shutdown', async () => {
    const r = await router();
    const dir = mkdtempSync(join(tmpdir(), 'helm-portmap-'));
    const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '', p2pPortMap: true } } };
    const p = new P2P(store, async () => null, () => undefined, () => ({ dataDir: dir }), async () => 'alice', () => new PortMapper(r.options));
    p.apply();
    await vi.waitFor(() => expect(p.state.portMap?.state).toBe('mapped'), { timeout: 5000 });
    expect(p.state.portMap).toMatchObject({ method: 'upnp', address: `203.0.113.9:${p.state.port}` });
    await vi.waitFor(() => expect(p.state.addresses[0]).toBe('203.0.113.9'), { timeout: 3000 });
    expect(r.mappings.size).toBe(1);
    await p.shutdown();
    expect(r.mappings.size).toBe(0);
  });

  it('leaves the router alone unless it was asked to', async () => {
    const r = await router();
    const dir = mkdtempSync(join(tmpdir(), 'helm-portmap-'));
    const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1', p2pPortMap: false } } };
    const p = new P2P(store, async () => null, () => undefined, () => ({ dataDir: dir }), async () => 'alice', () => new PortMapper(r.options));
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.state).toBe('ready'), { timeout: 3000 });
    expect(p.state.portMap).toEqual({ state: 'off' });
    expect(r.log).toEqual([]);
  });
});
