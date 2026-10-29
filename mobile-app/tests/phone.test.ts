import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/core/dispatch';
import { P2P } from '../../src/core/p2p/service';
import { NodeUdp } from '../../src/core/p2p/udp';
import { createConnectionBridge } from '../../hosted/web/bridge';
import { startDeviceFlow, waitForToken } from '../src/github';
import { Instances } from '../src/instances';
import type { Storage } from '../src/instances';
import { connectDesktop } from '../src/p2pConn';
import { b64, decodeShareCode, encodeShareCode } from '../../src/shared/p2p/sharecode';

const closers: (() => void)[] = [];
afterEach(() => { closers.forEach((c) => c()); closers.length = 0; });

const memory = (): Storage => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const whoIs = async (t: string) => (t === 'alice-token' ? 'Alice' : null);

function desktop(api: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), 'helm-phone-'));
  const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1' } } };
  const p = new P2P(store, (n, a) => dispatch(api, n, a), () => undefined, () => ({ dataDir: dir }), whoIs);
  closers.push(() => p.shutdown());
  p.apply();
  return p;
}
const udp = () => { const u = new NodeUdp(() => undefined); void u.bind(0); closers.push(() => u.close()); return u; };

describe('the phone app talking to a desktop', () => {
  it('pairs from a share code, saves the computer without the secret, and then runs the UI bridge over the link', async () => {
    const p = desktop({ getState: async () => ({ ready: true }), addOne: async (a: number, b: number) => a + b });
    await vi.waitFor(() => expect(p.state.code).toBeTruthy(), { timeout: 3000 });

    const instances = new Instances(memory());
    const prepared = instances.prepareDesktop(p.state.code!);
    expect(prepared.name).not.toBe('');
    // Pairing: the secret and a GitHub token for the right user.
    const first = await connectDesktop(udp, { code: prepared.code, identity: prepared.identity, name: 'Test phone', githubToken: 'alice-token' })();
    first.close();
    const saved = await instances.finishDesktop(prepared);
    expect(saved.kind === 'desktop' && saved.code).not.toContain('undefined');
    expect(JSON.stringify(await instances.list())).not.toContain(p.state.code!);

    // From now on: the saved code (no secret), this phone's key, no GitHub token.
    const d = saved as Extract<typeof saved, { kind: 'desktop' }>;
    const bridge = createConnectionBridge(connectDesktop(udp, { code: d.code, identity: instances.identityOf(d), name: 'Test phone' }));
    await bridge.ready;
    expect(await bridge.invoke('addOne', 2, 3)).toBe(5);
    const states: unknown[] = [];
    bridge.on('toast', (t) => states.push(t));
    await vi.waitFor(() => expect(p.state.devices[0]?.connected).toBe(true), { timeout: 3000 });
    p.forward('toast', { tone: 'ready', title: 'Done' });
    await vi.waitFor(() => expect(states).toEqual([{ tone: 'ready', title: 'Done' }]), { timeout: 3000 });
    await expect(bridge.invoke('nothingLikeThis')).rejects.toThrow(/Unknown call/);
  });

  it('reconnects by itself when the desktop restarts, and asks for the state again', async () => {
    let n = 0;
    const p = desktop({ getState: async () => ({ ready: true, n: ++n }) });
    await vi.waitFor(() => expect(p.state.code).toBeTruthy(), { timeout: 3000 });
    const instances = new Instances(memory());
    const prepared = instances.prepareDesktop(p.state.code!);
    (await connectDesktop(udp, { code: prepared.code, identity: prepared.identity, name: 'P', githubToken: 'alice-token' })()).close();
    const d = await instances.finishDesktop(prepared) as any;

    const bridge = createConnectionBridge(connectDesktop(udp, { code: d.code, identity: instances.identityOf(d), name: 'P' }));
    await bridge.ready;
    const seen: any[] = [];
    bridge.on('state', (s) => seen.push(s));
    p.apply();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 15_000 });
    expect(seen[0]).toMatchObject({ ready: true });
  }, 20_000);

  it('keeps new addresses the desktop announces, and refuses a code that is not one', async () => {
    const instances = new Instances(memory());
    const code = encodeShareCode({ v: 1, n: 'Desk', p: 4000, c: ['203.0.113.5'], k: b64.encode(new Uint8Array(32).fill(3)), s: b64.encode(new Uint8Array(16).fill(1)) });
    const inst = await instances.finishDesktop(instances.prepareDesktop(code));
    await instances.updateAddresses(inst.id, 5000, ['198.51.100.1']);
    const saved = (await instances.list())[0];
    expect(saved.kind === 'desktop' && decodeShareCode(saved.code).endpoints).toEqual([{ host: '198.51.100.1', port: 5000 }]);
    expect(() => instances.prepareDesktop('nonsense')).toThrow(/not a helm share code/);
    await expect(instances.addHosted('x', 'http://example.com')).rejects.toThrow(/https/);
    expect((await instances.addHosted('', 'example.com')).kind).toBe('hosted');
  });
});

describe('GitHub sign-in on the phone', () => {
  it('asks for no scopes and waits through pending and slow-down until approved', async () => {
    const calls: any[] = [];
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'gho_abc' }];
    const f = (async (url: string, init: any) => {
      calls.push([url, JSON.parse(init.body)]);
      return { json: async () => (url.endsWith('/device/code') ? { device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 } : answers.shift()) } as any;
    }) as any;
    const d = await startDeviceFlow('cid', f);
    expect(calls[0][1]).toEqual({ client_id: 'cid', scope: '' });
    expect(d.userCode).toBe('AB-12');
    expect(await waitForToken('cid', d, f, async () => undefined)).toBe('gho_abc');
    await expect(waitForToken('cid', d, (async () => ({ json: async () => ({ error: 'access_denied' }) })) as any, async () => undefined)).rejects.toThrow(/declined/);
  });
});
