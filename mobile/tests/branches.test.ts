import { describe, expect, it, vi } from 'vitest';
import { githubLogin, startDeviceFlow, waitForToken } from '../src/github';
import type { DeviceCode } from '../src/github';
import { Instances } from '../src/instances';
import type { Storage } from '../src/instances';
import { showNew } from '../src/notices';
import { b64, encodeShareCode, decodeShareCode } from '../../src/shared/p2p/sharecode';

const reply = (j: unknown) => (async () => ({ json: async () => j })) as any;
const flow: DeviceCode = { deviceCode: 'dc', userCode: 'AB', verificationUri: 'u', interval: 5, expiresIn: 900 };
const nosleep = async () => undefined;

describe('GitHub device flow edge cases', () => {
  it('reports the reason when GitHub will not start the sign-in', async () => {
    await expect(startDeviceFlow('cid', reply({ error_description: 'Device flow is disabled' }))).rejects.toThrow('Device flow is disabled');
    await expect(startDeviceFlow('cid', reply({}))).rejects.toThrow(/did not start/);
  });
  it('defaults the polling interval to 5 seconds', async () => {
    const d = await startDeviceFlow('cid', reply({ device_code: 'a', user_code: 'b', verification_uri: 'c', expires_in: 60 }));
    expect(d.interval).toBe(5);
  });
  it('slows down by five seconds each time GitHub asks', async () => {
    const waits: number[] = [];
    const answers: any[] = [{ error: 'slow_down' }, { error: 'slow_down' }, { access_token: 't' }];
    const f = (async () => ({ json: async () => answers.shift() })) as any;
    expect(await waitForToken('c', { ...flow, interval: 2 }, f, async (ms) => { waits.push(ms); })).toBe('t');
    expect(waits).toEqual([2000, 2000 + 5000, 2000 + 10000]);
  });
  it('fails with GitHub\'s own message for any other error, or a generic one', async () => {
    await expect(waitForToken('c', flow, reply({ error: 'bad_verification_code', error_description: 'The code is wrong' }), nosleep)).rejects.toThrow('The code is wrong');
    await expect(waitForToken('c', flow, reply({ error: 'unsupported' }), nosleep)).rejects.toThrow('The sign-in did not finish.');
  });
  it('gives up when the code expires, and when expiry arrives while only failing lookups happened', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(async () => { throw new Error('offline'); }) as any;
      const p = waitForToken('c', { ...flow, expiresIn: 10 }, f, async (ms) => { vi.advanceTimersByTime(ms); });
      await expect(p).rejects.toThrow(/expired/);
      expect(f).toHaveBeenCalled();
      await expect(waitForToken('c', { ...flow, expiresIn: 0 }, f, nosleep)).rejects.toThrow(/expired/);
    } finally { vi.useRealTimers(); }
  });
  it('treats a non-JSON answer as a dropped lookup and asks again', async () => {
    const answers: any[] = [new SyntaxError('bad json'), { access_token: 'ok' }];
    const f = (async () => ({ json: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; } })) as any;
    expect(await waitForToken('c', flow, f, nosleep)).toBe('ok');
  });
  it('githubLogin has null for a body without a login', async () => {
    const f = (async () => ({ ok: true, status: 200, json: async () => ({ id: 1 }) })) as any;
    expect(await githubLogin('t', f)).toBeNull();
    const g = (async () => ({ ok: true, status: 200, json: async () => null })) as any;
    expect(await githubLogin('t', g)).toBeNull();
  });
});

const memory = (): Storage => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const code = encodeShareCode({ v: 1, n: 'Desk', p: 1000, c: ['10.0.0.1'], k: b64.encode(new Uint8Array(32).fill(1)), s: b64.encode(new Uint8Array(16).fill(2)) });

describe('instances', () => {
  it('ignores address updates for hosted or unknown instances', async () => {
    const s = memory();
    const inst = new Instances(s);
    const h = await inst.addHosted('H', 'https://h.example');
    const before = await s.get('helm.instances');
    await inst.updateAddresses(h.id, 5, ['1.2.3.4']);
    await inst.updateAddresses('nope', 5, ['1.2.3.4']);
    expect(await s.get('helm.instances')).toBe(before);
  });
  it('keeps at most 16 addresses from an update', async () => {
    const inst = new Instances(memory());
    const d: any = await inst.finishDesktop(inst.prepareDesktop(code));
    await inst.updateAddresses(d.id, 2000, Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`));
    const saved: any = (await inst.list())[0];
    const c = decodeShareCode(saved.code).code;
    expect(c.p).toBe(2000);
    expect(c.c).toHaveLength(16);
  });
  it('identityOf restores the key pair that was saved', async () => {
    const inst = new Instances(memory());
    const p = inst.prepareDesktop(code);
    const d: any = await inst.finishDesktop(p);
    const id = inst.identityOf(d);
    expect(Array.from(id.secretKey)).toEqual(Array.from(p.identity.secretKey));
    expect(Array.from(id.publicKey)).toEqual(Array.from(p.identity.publicKey));
  });
  it('lists nothing from damaged storage, and uses the host as the name of a nameless server', async () => {
    const s = memory();
    await s.set('helm.instances', '{not json');
    const inst = new Instances(s);
    expect(await inst.list()).toEqual([]);
    expect((await inst.addHosted('', 'localhost:8080')).name).toBe('localhost:8080');
  });
  it('removes only the named instance', async () => {
    const inst = new Instances(memory());
    const a = await inst.addHosted('A', 'a.example');
    const b = await inst.addHosted('B', 'b.example');
    await inst.remove(a.id);
    expect((await inst.list()).map((i) => i.id)).toEqual([b.id]);
  });
});

describe('showNew', () => {
  const n = (id: string) => ({ id, kind: 'attention', title: id, body: '', silent: false, at: 0 }) as any;
  it('still counts, remembers and acknowledges a notice whose display failed', async () => {
    const ack = vi.fn();
    const seen = new Set<string>();
    const shown = await showNew([n('a'), n('b')], ack, async (x) => { if (x.id === 'a') throw new Error('denied'); }, seen);
    expect(shown).toBe(2);
    expect([...seen]).toEqual(['a', 'b']);
    expect(ack).toHaveBeenCalledWith(['a', 'b']);
  });
  it('shows an already-seen notice no more, yet acknowledges it again', async () => {
    const ack = vi.fn();
    const show = vi.fn(async () => undefined);
    expect(await showNew([n('a')], ack, show, new Set(['a']))).toBe(0);
    expect(show).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith(['a']);
  });
});
