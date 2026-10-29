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

describe('when the router is not helpful (UPnP)', () => {
  const fast = (r: Awaited<ReturnType<typeof router>>, extra = {}) => new PortMapper({ ...r.options, waitMs: 250, gateway: async () => null, ...extra });
  const noRouter = { mapping: null, note: expect.stringMatching(/No router answered/) };

  it('gives up quietly on SSDP replies that are garbage, have no LOCATION, or point somewhere that is not http', async () => {
    for (const ssdpReply of ['garbage', 'HTTP/1.1 200 OK\r\nST: x\r\n\r\n', 'HTTP/1.1 200 OK\r\nLOCATION: ftp://192.168.1.1/x\r\n\r\n']) {
      const r = await router({ ssdpReply, natpmp: false });
      expect(await fast(r).map(4000)).toEqual(noRouter);
      expect(r.log).toEqual([]);
    }
  });

  it('gives up when the description cannot be fetched (an error status, or nothing listening)', async () => {
    const r = await router({ descStatus: 404, natpmp: false });
    expect(await fast(r).map(4000)).toEqual(noRouter);
    const dead = await router({ ssdpReply: 'HTTP/1.1 200 OK\r\nLOCATION: http://127.0.0.1:1/desc.xml\r\n\r\n', natpmp: false });
    expect(await fast(dead).map(4000)).toEqual(noRouter);
  });

  it('gives up when the router has no WAN connection service', async () => {
    const r = await router({ noWan: true, natpmp: false });
    expect(await fast(r).map(4000)).toEqual(noRouter);
    expect(r.log).toEqual([]);
  });

  it('gives up when the router will not say its external address, or says nothing', async () => {
    const empty = await router({ emptyIp: true, natpmp: false });
    expect(await fast(empty).map(4000)).toEqual(noRouter);
    expect(empty.log).toEqual(['GetExternalIPAddress']);
    const fault = await router({ fault: { GetExternalIPAddress: 501 }, natpmp: false });
    expect(await fast(fault).map(4000)).toEqual(noRouter);
  });

  it('stops at SOAP faults other than "permanent leases only" (725) and "port taken" (718), leaving nothing behind', async () => {
    for (const code of [402, 501, 718 + 1]) {
      const r = await router({ fault: { AddPortMapping: code }, natpmp: false });
      expect(await fast(r).map(4000)).toEqual(noRouter);
      expect(r.log).toEqual(['GetExternalIPAddress', 'AddPortMapping']); // one try: no walking through ports
      expect(r.mappings.size).toBe(0);
    }
  });

  it('stops when the permanent-lease retry fails too', async () => {
    const r = await router({ fault: { AddPortMapping: 725 }, natpmp: false });
    expect(await fast(r).map(4000)).toEqual(noRouter);
    expect(r.log).toEqual(['GetExternalIPAddress', 'AddPortMapping', 'AddPortMapping']);
  });

  it('tries only five ports when all are taken', async () => {
    const r = await router({ taken: [4000, 4001, 4002, 4003, 4004, 4005], natpmp: false });
    expect(await fast(r).map(4000)).toEqual(noRouter);
    expect(r.log.filter((a) => a === 'AddPortMapping')).toHaveLength(5);
  });

  it('does not trust "OK" when reading the mapping back names another computer or finds nothing', async () => {
    const other = await router({ readBackClient: '192.168.1.77', natpmp: false });
    expect(await fast(other).map(4000)).toEqual(noRouter);
    const missing = await router({ fault: { GetSpecificPortMappingEntry: 714 }, natpmp: false });
    expect(await fast(missing).map(4000)).toEqual(noRouter);
  });

  it('moves on to the next local address when one cannot be searched from, and to NAT-PMP when UPnP finds nothing', async () => {
    const r = await router();
    // 203.0.113.5 is not an address of this computer, so binding the search socket from it fails.
    const m = fast(r, { localAddresses: () => ['203.0.113.5', '127.0.0.1'] });
    expect((await m.map(4000)).mapping).toMatchObject({ method: 'upnp' });
    await m.unmap();
    const pmpOnly = await router({ noWan: true });
    expect((await fast(pmpOnly, { gateway: async () => '127.0.0.1' }).map(4000)).mapping).toMatchObject({ method: 'natpmp' });
  });

  it('falls back to NAT-PMP when asking local addresses blows up, and to nothing when the gateway lookup does', async () => {
    const r = await router();
    const m = fast(r, { gateway: async () => '127.0.0.1', localAddresses: () => { throw new Error('no interfaces'); } });
    expect((await m.map(4000)).mapping).toMatchObject({ method: 'natpmp' });
    await m.unmap();
    const none = await router({ upnp: false });
    expect(await fast(none, { gateway: async () => { throw new Error('no route'); } }).map(4000)).toEqual(noRouter);
  });

  it('has nothing to do for unmap when nothing was mapped', async () => {
    const r = await router();
    const m = fast(r);
    await m.unmap();
    expect(r.log).toEqual([]);
    expect(r.pmp.size).toBe(0);
  });

  it('survives a router that refuses to delete the mapping', async () => {
    const r = await router({ fault: { DeletePortMapping: 501 } });
    const m = fast(r);
    await m.map(4000);
    await expect(m.unmap()).resolves.toBeUndefined();
    expect(r.log).toContain('DeletePortMapping');
  });
});

describe('when the router is not helpful (NAT-PMP)', () => {
  const pmp = (r: Awaited<ReturnType<typeof router>>, extra = {}) => new PortMapper({ ...r.options, waitMs: 150, ...extra });
  const none = { mapping: null, note: expect.stringMatching(/No router answered/) };

  it('does nothing without a gateway', async () => {
    const r = await router({ upnp: false });
    expect(await pmp(r, { gateway: async () => null }).map(4000)).toEqual(none);
  });

  it('refuses result codes other than success, for the address and for the mapping', async () => {
    expect(await pmp(await router({ upnp: false, pmpIpResult: 3 })).map(4000)).toEqual(none);
    const r = await router({ upnp: false, pmpMapResult: 4 });
    expect(await pmp(r).map(4000)).toEqual(none);
  });

  it('refuses a mapping answer with the wrong op code, or with no external port', async () => {
    expect(await pmp(await router({ upnp: false, pmpMapOp: 130 })).map(4000)).toEqual(none);
    expect(await pmp(await router({ upnp: false, pmpNoPort: true })).map(4000)).toEqual(none);
  });

  it('ignores answers from an address other than the gateway', async () => {
    const r = await router({ upnp: false, pmpImpostor: true });
    const m = pmp(r);
    expect((await m.map(4000)).mapping).toEqual({ method: 'natpmp', externalIp: '203.0.113.9', externalPort: 4000 });
    await m.unmap();
  });

  it('asks again after 250 ms and after 750 ms, and then stops asking', async () => {
    for (const drop of [1, 2]) {
      const r = await router({ upnp: false, pmpDrop: drop });
      const t0 = Date.now();
      expect((await pmp(r).map(4000)).mapping).toMatchObject({ method: 'natpmp' });
      expect(Date.now() - t0).toBeGreaterThanOrEqual(drop === 1 ? 240 : 740);
    }
    // 1750 ms is as long as one exchange waits, whatever else is going on
    const silent = await router({ upnp: false, pmpDrop: 99 });
    const t0 = Date.now();
    expect(await pmp(silent).map(4000)).toEqual(none);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1700);
  }, 20_000);

  it('takes the mapping away with a zero lifetime', async () => {
    const r = await router({ upnp: false });
    const m = pmp(r);
    await m.map(4000);
    expect(r.pmp.size).toBe(1);
    await m.unmap();
    expect(r.pmp.size).toBe(0);
  });
});

describe('keeping the mapping', () => {
  it('stops renewing, and forgets the mapping, when the router stops answering; unmap then has nothing to delete', async () => {
    const r = await router();
    const m = new PortMapper({ ...r.options, waitMs: 150, renewMs: 100 });
    const seen: unknown[] = [];
    m.onRenewed = (x) => seen.push(x);
    await m.map(4000);
    r.opts.upnp = false; r.opts.natpmp = false; // the router goes away
    await vi.waitFor(() => expect((m as any).upnp).toBeNull(), { timeout: 3000 });
    expect(seen).toEqual([]);
    const calls = r.log.length;
    await m.unmap();
    expect(r.log.length).toBe(calls);
  });

  it('renews a NAT-PMP mapping the same way', async () => {
    const r = await router({ upnp: false });
    const m = new PortMapper({ ...r.options, renewMs: 100, leaseSeconds: 120 });
    const seen: { method: string }[] = [];
    m.onRenewed = (x) => seen.push(x);
    await m.map(4000);
    r.pmp.clear();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(seen[0]).toMatchObject({ method: 'natpmp' });
    expect(r.pmp.get(4000)?.lifetime).toBe(120);
    await m.unmap();
  });

  it('does not renew after unmap, even if a renewal was already on its way', async () => {
    const r = await router();
    const m = new PortMapper({ ...r.options, renewMs: 10_000 });
    await m.map(4000);
    await m.unmap();
    const calls = r.log.length;
    await (m as any).renew();
    expect(r.log.length).toBe(calls);
    expect((m as any).timer).toBeNull();
  });

  it('waits half the lease between renewals, but never less than 30 s', async () => {
    const r = await router();
    const delays: unknown[] = [];
    const real = globalThis.setTimeout;
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: any, ms?: number, ...a: any[]) => { delays.push(ms); return real(fn, ms, ...a); }) as any);
    try {
      const a = new PortMapper({ ...r.options, leaseSeconds: 7200 });
      await a.map(4000); await a.unmap();
      const b = new PortMapper({ ...r.options, leaseSeconds: 10 });
      await b.map(4001); await b.unmap();
    } finally { spy.mockRestore(); }
    expect(delays).toContain(3_600_000);
    expect(delays).toContain(30_000);
  });
});

describe('the desktop service with a router that fails', () => {
  const settings = (over = {}) => ({ data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1', p2pPortMap: true, ...over } } }) as any;
  const dir = () => mkdtempSync(join(tmpdir(), 'helm-portmap-'));

  it('shows why the router could not forward the port', async () => {
    const r = await router({ upnp: false, natpmp: false });
    const d = dir();
    const p = new P2P(settings(), async () => null, () => undefined, () => ({ dataDir: d }), async () => 'alice', () => new PortMapper({ ...r.options, waitMs: 200 }));
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.portMap?.state).toBe('failed'), { timeout: 5000 });
    expect(p.state.portMap?.note).toMatch(/No router answered/);
    expect(p.state.addresses[0]).toBe('127.0.0.1');
  });

  it('says so when asking the router throws', async () => {
    const d = dir();
    const broken = { map: async () => { throw new Error('x'); }, unmap: async () => undefined } as unknown as PortMapper;
    const p = new P2P(settings(), async () => null, () => undefined, () => ({ dataDir: d }), async () => 'alice', () => broken);
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.portMap).toEqual({ state: 'failed', note: 'The router could not be asked.' }), { timeout: 5000 });
  });

  it('puts a renewed mapping into the code, and ignores renewals that arrive after it was switched off', async () => {
    const r = await router();
    const d = dir();
    let mapper!: PortMapper;
    const st = settings();
    const p = new P2P(st, async () => null, () => undefined, () => ({ dataDir: d }), async () => 'alice', () => (mapper = new PortMapper({ ...r.options, renewMs: 100 })));
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.portMap?.state).toBe('mapped'), { timeout: 5000 });
    const first = mapper;
    // the router hands out a different public address on renewal
    first.onRenewed!({ method: 'upnp', externalIp: '198.51.100.8', externalPort: 5555 });
    expect(p.state.addresses.slice(0, 2)).toEqual(['127.0.0.1', '198.51.100.8:5555']);
    st.data.settings.p2pEnabled = false;
    p.apply();
    first.onRenewed!({ method: 'upnp', externalIp: '198.51.100.9', externalPort: 1 });
    expect(p.state.addresses).toEqual([]);
  });

  it('gives the forwarding back when it is turned off before the router answered', async () => {
    const r = await router();
    const d = dir();
    const st = settings();
    const p = new P2P(st, async () => null, () => undefined, () => ({ dataDir: d }), async () => 'alice', () => new PortMapper(r.options));
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.state).toBe('ready'), { timeout: 3000 });
    st.data.settings.p2pEnabled = false;
    p.apply();
    await vi.waitFor(() => expect(r.log.length).toBeGreaterThan(0), { timeout: 3000 });
    await vi.waitFor(() => expect(r.mappings.size).toBe(0), { timeout: 3000 });
    expect(p.state.state).toBe('off');
  });

  // Found as a bug and fixed: turning the service off used to leave `portMap`, so the settings screen kept showing "mapped" for a port that
  // was no longer open.
  it('shows no port forwarding once the service is off', async () => {
    const r = await router();
    const st = settings();
    const p = new P2P(st, async () => null, () => undefined, () => ({ dataDir: dir() }), async () => 'alice', () => new PortMapper(r.options));
    closers.push(() => p.shutdown());
    p.apply();
    await vi.waitFor(() => expect(p.state.portMap?.state).toBe('mapped'), { timeout: 5000 });
    st.data.settings.p2pEnabled = false;
    p.apply();
    expect(p.state.portMap).toBeUndefined();
  });
});
