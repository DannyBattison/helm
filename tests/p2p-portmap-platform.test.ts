import { afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  readFile: vi.fn(),
  execFile: vi.fn(),
  networkInterfaces: vi.fn()
}));
vi.mock('node:fs/promises', () => ({ readFile: m.readFile }));
vi.mock('node:child_process', () => ({ execFile: m.execFile }));
vi.mock('node:os', async (orig) => ({ ...(await orig<typeof import('node:os')>()), networkInterfaces: m.networkInterfaces }));

import { defaultGateway, lanAddresses } from '../src/core/p2p/portmap';

const realPlatform = process.platform;
const platform = (p: string) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
afterEach(() => { platform(realPlatform); vi.clearAllMocks(); });

/** `execFile` that answers with `out` (or an error and no output). */
const commandSays = (out: string | null) => m.execFile.mockImplementation((_c: string, _a: string[], _o: unknown, cb: (e: Error | null, out?: string) => void) => (out === null ? cb(new Error('not found')) : cb(null, out)));

describe('defaultGateway', () => {
  it('reads /proc/net/route on Linux', async () => {
    platform('linux');
    m.readFile.mockResolvedValue('Iface\tDestination\tGateway\tFlags\neth0\t00000000\t0101A8C0\t0003\n');
    expect(await defaultGateway()).toBe('192.168.1.1');
    expect(m.readFile).toHaveBeenCalledWith('/proc/net/route', 'utf8');
    expect(m.execFile).not.toHaveBeenCalled();
  });
  it('answers null on Linux when the table cannot be read', async () => {
    platform('linux');
    m.readFile.mockRejectedValue(new Error('ENOENT'));
    expect(await defaultGateway()).toBeNull();
  });
  it('asks `route -n get default` on macOS', async () => {
    platform('darwin');
    commandSays('   route to: default\n    gateway: 10.0.0.1\n');
    expect(await defaultGateway()).toBe('10.0.0.1');
    expect(m.execFile.mock.calls[0].slice(0, 2)).toEqual(['route', ['-n', 'get', 'default']]);
  });
  it('asks `route print` on Windows', async () => {
    platform('win32');
    commandSays('          0.0.0.0          0.0.0.0      192.168.0.1    192.168.0.20     25\n');
    expect(await defaultGateway()).toBe('192.168.0.1');
    expect(m.execFile.mock.calls[0].slice(0, 2)).toEqual(['route', ['print', '-4', '0.0.0.0']]);
  });
  it('answers null when the command fails or prints nothing', async () => {
    platform('darwin');
    commandSays(null);
    expect(await defaultGateway()).toBeNull();
    platform('win32');
    commandSays('');
    expect(await defaultGateway()).toBeNull();
  });
  it('answers null on a platform it does not know', async () => {
    platform('freebsd');
    expect(await defaultGateway()).toBeNull();
    expect(m.execFile).not.toHaveBeenCalled();
  });
});

describe('lanAddresses', () => {
  const nic = (address: string, family: string, internal = false) => ({ address, family, internal });
  it('lists only private IPv4 addresses of real interfaces', () => {
    m.networkInterfaces.mockReturnValue({
      lo: [nic('127.0.0.1', 'IPv4', true)],
      eth0: [nic('192.168.1.20', 'IPv4'), nic('fe80::1', 'IPv6'), nic('203.0.113.4', 'IPv4'), nic('100.64.1.1', 'IPv4')],
      wlan0: [nic('10.0.0.7', 'IPv4'), nic('192.168.5.5', 'IPv4', true)],
      down: undefined
    });
    expect(lanAddresses()).toEqual(['192.168.1.20', '10.0.0.7']);
  });
});
