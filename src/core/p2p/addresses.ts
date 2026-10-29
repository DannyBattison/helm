import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';

export type Kind = 'lan' | 'global6' | 'public4' | 'vpn' | 'unique6' | 'other';
export interface Candidate { address: string; kind: Kind; iface: string; virtual: boolean }

const VPN_NAME = /tailscale|zerotier|hamachi|wireguard|^wg\d|openvpn|^tun\d|^utun|radmin|nebula/i;
const VIRTUAL_NAME = /docker|veth|^br-|vmnet|vbox|virtualbox|hyper-v|vethernet|wsl|virbr|^lxc|^cni|podman/i;

const v4 = (a: string) => a.split('.').map(Number);
export const isPrivate4 = (a: string) => { const [x, y] = v4(a); return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168); };
/** 100.64.0.0/10: carrier-grade NAT space, which Tailscale also uses for its own addresses. */
export const isCgnat4 = (a: string) => { const [x, y] = v4(a); return x === 100 && y >= 64 && y <= 127; };

/**
 * The addresses this computer can be reached at, best first, from its network interfaces: loopback, link-local and Teredo left out; then
 * ordered local network, global IPv6, public IPv4 (an adapter with no NAT in front), VPN, unique-local IPv6; virtual adapters (Docker, WSL,
 * Hyper-V, VMs) kept but last, since a phone can rarely reach them.
 */
export function rankCandidates(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): Candidate[] {
  const order: Kind[] = ['lan', 'global6', 'public4', 'vpn', 'unique6', 'other'];
  const out: Candidate[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      const a = i.address.split('%')[0].toLowerCase();
      if (i.internal || a.startsWith('127.') || a === '::1' || a.startsWith('169.254.') || a.startsWith('fe80:') || a.startsWith('2001:0:') || a.startsWith('2001:0000:')) continue;
      let kind: Kind;
      if (i.family === 'IPv4') kind = VPN_NAME.test(name) || isCgnat4(a) || a.startsWith('25.') ? 'vpn' : isPrivate4(a) ? 'lan' : 'public4';
      else kind = VPN_NAME.test(name) ? 'vpn' : /^f[cd]/.test(a) ? 'unique6' : /^[23]/.test(a) ? 'global6' : 'other';
      out.push({ address: a, kind, iface: name, virtual: VIRTUAL_NAME.test(name) });
    }
  }
  return out.sort((x, y) => Number(x.virtual) - Number(y.virtual) || order.indexOf(x.kind) - order.indexOf(y.kind));
}

/** An address as it is written in a share code: IPv6 in brackets. */
export const forCode = (address: string, port?: number) => {
  const host = address.includes(':') ? `[${address}]` : address;
  return port ? `${host}:${port}` : host;
};
