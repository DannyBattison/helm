import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/core/dispatch';
import { P2P } from '../../src/core/p2p/service';
import { NodeUdp } from '../../src/core/p2p/udp';
import { generateKeyPair } from '../../src/shared/p2p/noise';
import { b64, encodeShareCode } from '../../src/shared/p2p/sharecode';
import { qrModules, qrSvg } from '../../src/shared/qr';
import { Instances } from '../src/instances';
import type { Storage } from '../src/instances';
import { collect } from '../src/notices';
import type { Notice } from '../src/notices';
import { connectDesktop } from '../src/p2pConn';
import { findShareCode } from '../src/scan';
import { fromExtra, openUrl, parseOpenUrl, plan } from '../src/open';

/** What a camera would see: the QR drawn at `scale` pixels a module, with a border, as RGBA. */
function picture(text: string, scale = 6, border = 4) {
  const m = qrModules(text);
  const side = (m.length + border * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const i = (((y + border) * scale + dy) * side + (x + border) * scale + dx) * 4; data[i] = data[i + 1] = data[i + 2] = 0; }
  }));
  return { data, width: side, height: side };
}

describe('QR codes for share codes', () => {
  const code = encodeShareCode({ v: 1, n: 'Desk', p: 41234, c: ['203.0.113.5', '192.168.1.20', '[2a00:1:2::5]', '100.101.102.103', 'home.example.com'], k: b64.encode(new Uint8Array(32).fill(9)), s: b64.encode(new Uint8Array(16).fill(4)) });

  it('are read back as the same code', () => {
    expect(findShareCode(picture(code))).toBe(code);
    expect(findShareCode(picture(code, 3))).toBe(code);
  });
  it('ignore a QR code that is not a helm share code', () => {
    expect(findShareCode(picture('https://example.com/'))).toBeNull();
    expect(findShareCode({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 })).toBeNull();
  });
  it('make an SVG that has the quiet zone and the dark squares', () => {
    const svg = qrSvg(code);
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/);
    expect(svg).toContain('fill="#fff"');
    expect(svg).not.toContain('<script');
  });
});

// -------------------------------------------------------------------------------------------- notifications while the app is closed
const closers: (() => void)[] = [];
afterEach(() => { closers.forEach((c) => c()); closers.length = 0; });
const memory = (): Storage => { const m = new Map<string, string>(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; };
const udp = () => { const u = new NodeUdp(() => undefined); void u.bind(0); closers.push(() => u.close()); return u; };

async function pairedPhone(p: P2P) {
  await vi.waitFor(() => expect(p.state.code).toBeTruthy(), { timeout: 3000 });
  const instances = new Instances(memory());
  const prepared = instances.prepareDesktop(p.state.code!);
  (await connectDesktop(udp, { code: prepared.code, identity: prepared.identity, name: 'Phone', githubToken: 'alice-token' })()).close();
  const d = await instances.finishDesktop(prepared) as Extract<Awaited<ReturnType<Instances['finishDesktop']>>, { kind: 'desktop' }>;
  return { d, instances, link: { code: d.code, identity: instances.identityOf(d), name: 'Phone' } };
}

function desktop() {
  const dir = mkdtempSync(join(tmpdir(), 'helm-notice-'));
  const store: any = { data: { user: { login: 'alice' }, settings: { p2pEnabled: true, p2pPort: 0, p2pStun: '', p2pAddress: '127.0.0.1' } } };
  const p = new P2P(store, (n, a) => dispatch({}, n, a), () => undefined, () => ({ dataDir: dir }), async () => 'alice');
  closers.push(() => p.shutdown());
  p.apply();
  return { p, dir, store };
}
const note = (title: string): Omit<Notice, 'id' | 'at'> => ({ kind: 'attention', title, body: 'Approve a command?', silent: false, sessionId: 's1' });

describe('notifications for a phone that is closed', () => {
  it('are kept until the phone collects them, shown once, and then forgotten', async () => {
    const { p } = desktop();
    const { link } = await pairedPhone(p);
    p.notify(note('First'));
    p.notify(note('Second'));

    const shown: string[] = [];
    const storage = memory();
    const n1 = await collect([{ id: 'i1', name: 'Desk', link }], udp, async (n) => { shown.push(n.title + '@' + n.instanceName); }, storage, 800);
    expect(shown).toEqual(['First@Desk', 'Second@Desk']);
    expect(n1).toBe(2);

    // Collected and acknowledged: the next background run finds nothing.
    const n2 = await collect([{ id: 'i1', name: 'Desk', link }], udp, async () => { shown.push('again'); }, storage, 800);
    expect(n2).toBe(0);
    expect(shown).toHaveLength(2);
  });

  it('arrive live while the phone is connected', async () => {
    const { p } = desktop();
    const { link } = await pairedPhone(p);
    const got: Notice[] = [];
    const conn = await connectDesktop(udp, link, { notices: (items, ack) => { got.push(...items); ack(items.map((i) => i.id)); } })();
    await vi.waitFor(() => expect(p.state.devices[0]?.connected).toBe(true), { timeout: 3000 });
    p.notify(note('Live'));
    await vi.waitFor(() => expect(got.map((n) => n.title)).toEqual(['Live']), { timeout: 3000 });
    conn.close();
  });

  it('survive a desktop restart, and are cleared once collected', async () => {
    const { p, dir, store } = desktop();
    const { link } = await pairedPhone(p);
    p.notify(note('Kept'));
    p.shutdown();
    const again = new P2P(store, async () => null, () => undefined, () => ({ dataDir: dir }), async () => 'alice');
    closers.push(() => again.shutdown());
    again.apply();
    await vi.waitFor(() => expect(again.state.state).toBe('ready'), { timeout: 3000 });

    const shown: string[] = [];
    const storage = memory();
    // The phone collects but the "ack" never reaches the computer (simulated by not acknowledging).
    await collect([{ id: 'i1', name: 'Desk', link }], udp, async (n) => { shown.push(n.title); }, storage, 800);
    expect(shown).toEqual(['Kept']);
    const queue = (again as any).saved.queue;
    expect(Object.values(queue).flat()).toHaveLength(0);
  }, 15_000);

  it('are not kept for a phone that was removed, and nothing is kept when no phone is paired', async () => {
    const { p } = desktop();
    await vi.waitFor(() => expect(p.state.code).toBeTruthy(), { timeout: 3000 });
    p.notify(note('Nobody'));
    expect((p as any).saved.queue ?? {}).toEqual({});
    const { link } = await pairedPhone(p);
    p.notify(note('For the phone'));
    await p.revoke(p.state.devices[0].id);
    expect(Object.values((p as any).saved.queue ?? {}).flat()).toHaveLength(0);
    void link; void generateKeyPair;
  });
});

describe('opening a session from a notification', () => {
  const t = { instance: 'inst-1', session: 's/1&x', kind: 'attention' };
  it('round-trips through the link, and reads the extra both platforms give', () => {
    expect(parseOpenUrl(openUrl(t))).toEqual(t);
    expect(fromExtra({ instance: 'a', session: 'b', kind: 'ready' })).toEqual({ instance: 'a', session: 'b', kind: 'ready' });
    expect(fromExtra({ instanceId: 'a', sessionId: 'b' })).toEqual({ instance: 'a', session: 'b', kind: '' });
  });
  it('ignores a link that is not one, or has no session', () => {
    for (const bad of ['', 'https://open?instance=a&session=b', 'helm://other?instance=a&session=b', 'helm://open?instance=a', 'nonsense']) expect(parseOpenUrl(bad)).toBeNull();
    expect(fromExtra(undefined)).toBeNull();
  });
  it('goes straight there if that computer is open, switches if another is, and drops one that was removed', () => {
    const known = [{ id: 'inst-1', kind: 'desktop' }, { id: 'srv', kind: 'hosted' }];
    expect(plan(t, known, 'inst-1')).toBe('go');
    expect(plan(t, known, null)).toBe('switch');
    expect(plan(t, known, 'other')).toBe('switch');
    expect(plan({ ...t, instance: 'gone' }, known, null)).toBe('ignore');
    expect(plan({ ...t, instance: 'srv' }, known, null)).toBe('ignore');
  });
});
