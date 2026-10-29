import { describe, expect, it } from 'vitest';
import { forCode, isCgnat4, isPrivate4, rankCandidates } from '../src/core/p2p/addresses';

const nic = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false) => ({ address, family, internal, netmask: '', mac: '', cidr: null }) as any;
const kinds = (i: Record<string, any[]>) => rankCandidates(i).map((c) => [c.address, c.kind, c.virtual]);

describe('address classes', () => {
  it('knows private and carrier-grade NAT ranges at their edges', () => {
    for (const a of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.1']) expect(isPrivate4(a)).toBe(true);
    for (const a of ['172.15.0.1', '172.32.0.1', '192.169.0.1', '11.0.0.1', '8.8.8.8']) expect(isPrivate4(a)).toBe(false);
    for (const a of ['100.64.0.0', '100.127.255.255']) expect(isCgnat4(a)).toBe(true);
    for (const a of ['100.63.0.1', '100.128.0.1', '99.64.0.1']) expect(isCgnat4(a)).toBe(false);
  });
});

describe('rankCandidates', () => {
  it('orders every kind: lan, global IPv6, public IPv4, vpn, unique-local IPv6, other', () => {
    const out = kinds({
      a: [nic('fd00::1', 'IPv6')],
      b: [nic('100.100.1.1')],
      c: [nic('198.51.100.4')],
      d: [nic('2a00::1', 'IPv6')],
      e: [nic('192.168.5.5')],
      f: [nic('ff02::1', 'IPv6')],
      g: [nic('3ffe::1', 'IPv6')]
    });
    expect(out.map((o) => o[1])).toEqual(['lan', 'global6', 'global6', 'public4', 'vpn', 'unique6', 'other']);
  });

  it('puts virtual adapters last whatever their kind, and flags them', () => {
    const out = kinds({
      docker0: [nic('192.168.99.1')], 'vEthernet (WSL)': [nic('172.20.0.1')], 'br-1234': [nic('10.9.0.1')], 'VMware Network Adapter VMnet1': [nic('192.168.1.5')], virbr0: [nic('192.168.122.1')],
      vmnet8: [nic('192.168.7.1')], VirtualBox: [nic('192.168.56.1')], 'Hyper-V': [nic('172.30.0.1')], podman0: [nic('10.88.0.1')], cni0: [nic('10.1.0.1')], lxcbr0: [nic('10.0.3.1')],
      veth1: [nic('10.5.5.5')], wlan0: [nic('192.168.1.9')]
    });
    expect(out[0]).toEqual(['192.168.1.9', 'lan', false]);
    expect(out.slice(1).every((o) => o[2] === true)).toBe(true);
    expect(out).toHaveLength(13);
  });

  it('calls Hamachi/Radmin-style 25.x addresses VPN, by address and by name', () => {
    expect(kinds({ eth: [nic('25.4.5.6')] })).toEqual([['25.4.5.6', 'vpn', false]]);
    expect(kinds({ 'Radmin VPN': [nic('26.1.1.1')], Hamachi: [nic('25.1.1.1')] }).map((o) => o[1])).toEqual(['vpn', 'vpn']);
  });

  it('calls ZeroTier, WireGuard, OpenVPN and tun adapters VPN, including their IPv6 addresses', () => {
    const out = kinds({ zt0: [nic('192.168.192.5')], ZeroTier: [nic('10.147.17.5'), nic('fd12:3456::1', 'IPv6'), nic('2a00::7', 'IPv6')], wg0: [nic('10.8.0.2')], 'OpenVPN TAP': [nic('10.9.0.2')], tun0: [nic('10.10.0.2')], utun3: [nic('10.11.0.2')], nebula1: [nic('10.12.0.2')] });
    const vpn = out.filter((o) => o[1] === 'vpn').map((o) => o[0]);
    expect(vpn).toEqual(expect.arrayContaining(['10.147.17.5', 'fd12:3456::1', '2a00::7', '10.8.0.2', '10.9.0.2', '10.10.0.2', '10.11.0.2', '10.12.0.2']));
    // zt0 is not matched by name (it is a 192.168 LAN address on an adapter called zt0)
    expect(out.find((o) => o[0] === '192.168.192.5')?.[1]).toBe('lan');
    expect(out.find((o) => o[0] === '2a00::7')?.[1]).toBe('vpn');
  });

  it('reads uppercase IPv6, strips a zone, and drops link-local, Teredo and loopback in any case', () => {
    const out = rankCandidates({
      eth0: [nic('2A00:DB8::1%eth0', 'IPv6'), nic('FD12::9', 'IPv6'), nic('FE80::1%eth0', 'IPv6'), nic('2001:0:1::1', 'IPv6'), nic('2001:0000:1::1', 'IPv6'), nic('2001:0DB8::5', 'IPv6')],
      lo: [nic('127.0.0.1'), nic('::1', 'IPv6')]
    });
    expect(out.map((c) => [c.address, c.kind])).toEqual([['2a00:db8::1', 'global6'], ['2001:0db8::5', 'global6'], ['fd12::9', 'unique6']]);
  });

  it('drops internal interfaces and 127.x / 169.254.x addresses on non-internal ones', () => {
    expect(kinds({ lo: [nic('10.0.0.1', 'IPv4', true)], eth: [nic('127.5.5.5'), nic('169.254.1.1')] })).toEqual([]);
  });

  it('copes with an interface with no address list, and uses the real interfaces by default', () => {
    expect(rankCandidates({ x: undefined })).toEqual([]);
    expect(Array.isArray(rankCandidates())).toBe(true);
  });

  it('keeps the original order among equals', () => {
    expect(kinds({ a: [nic('192.168.1.1')], b: [nic('192.168.1.2')] }).map((o) => o[0])).toEqual(['192.168.1.1', '192.168.1.2']);
  });
});

describe('forCode', () => {
  it('writes IPv6 in brackets and an optional port', () => {
    expect(forCode('192.168.1.2')).toBe('192.168.1.2');
    expect(forCode('192.168.1.2', 4000)).toBe('192.168.1.2:4000');
    expect(forCode('2a00::1')).toBe('[2a00::1]');
    expect(forCode('2a00::1', 4000)).toBe('[2a00::1]:4000');
    expect(forCode('1.2.3.4', 0)).toBe('1.2.3.4');
  });
});
