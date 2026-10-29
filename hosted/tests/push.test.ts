import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPush, pushRoute, validSub } from '../src/push';

const sub = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'p' + n, auth: 'a' + n } });
const note = { title: 'Done', body: 'Session finished', sessionId: 's1', kind: 'ready' };
const fresh = () => mkdtempSync(join(tmpdir(), 'helm-push-'));

describe('push subscriptions', () => {
  it('accepts a browser subscription and nothing else', () => {
    expect(validSub(sub(1))).toBe(true);
    for (const bad of [null, {}, { endpoint: 'http://x/y', keys: { p256dh: 'a', auth: 'b' } }, { endpoint: 'https://x', keys: {} }, { endpoint: 'https://x'.padEnd(2000, 'x'), keys: { p256dh: 'a', auth: 'b' } }]) expect(validSub(bad)).toBe(false);
  });

  it('makes a key once and keeps it, with the devices, across restarts', () => {
    const dir = fresh();
    const a = createPush(dir);
    a.subscribe(sub(1));
    const b = createPush(dir);
    expect(b.publicKey).toBe(a.publicKey);
    expect(b.count()).toBe(1);
    expect(statSync(join(dir, 'push.json')).mode & 0o077).toBe(0);
  });

  it('keeps one entry per device and a bounded number of devices', () => {
    const p = createPush(fresh());
    p.subscribe(sub(1)); p.subscribe(sub(1));
    expect(p.count()).toBe(1);
    for (let i = 2; i < 40; i++) p.subscribe(sub(i));
    expect(p.count()).toBe(20);
  });

  it('sends the notification to every device and forgets the ones the push service says are gone', async () => {
    const send = vi.fn(async (s: any, _body?: string) => { if (s.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 }); if (s.endpoint.endsWith('/3')) throw new Error('offline'); return {} as any; });
    const dir = fresh();
    const p = createPush(dir, 'mailto:a@b.c', send as any);
    for (const i of [1, 2, 3]) p.subscribe(sub(i));
    await p.notify(note);
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.parse(send.mock.calls[0][1] as string)).toMatchObject({ title: 'Done', sessionId: 's1', kind: 'ready' });
    expect(p.count()).toBe(2);
    expect(JSON.parse(readFileSync(join(dir, 'push.json'), 'utf8')).subs.map((s: any) => s.endpoint)).not.toContain('https://push.example/2');
  });
});

describe('/push routes', () => {
  let close: () => void = () => undefined;
  afterEach(() => close());
  async function serve(signedIn: boolean) {
    const push = createPush(fresh());
    const srv = createServer(async (req, res) => { if (!(await pushRoute(req, res, push, () => signedIn))) res.writeHead(404).end(); });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    close = () => srv.close();
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { push, base, post };
  }

  it('turns away anyone who has not signed in', async () => {
    const { base, post, push } = await serve(false);
    expect((await fetch(base + '/push/key')).status).toBe(401);
    expect((await post('/push/subscribe', sub(1))).status).toBe(401);
    expect(push.count()).toBe(0);
  });

  it('hands the signed-in person the key and stores and removes their device', async () => {
    const { base, post, push } = await serve(true);
    expect(await (await fetch(base + '/push/key')).json()).toEqual({ key: push.publicKey });
    expect((await post('/push/subscribe', sub(1))).status).toBe(200);
    expect(push.count()).toBe(1);
    expect((await post('/push/unsubscribe', { endpoint: sub(1).endpoint })).status).toBe(200);
    expect(push.count()).toBe(0);
  });

  it('refuses a subscription that is not one, or is not JSON, or is huge', async () => {
    const { post, push } = await serve(true);
    expect((await post('/push/subscribe', { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } })).status).toBe(400);
    expect((await post('/push/subscribe', 'nope')).status).toBe(400);
    expect((await post('/push/subscribe', 'x'.repeat(5000))).status).toBe(413);
    expect(push.count()).toBe(0);
  });

  it('leaves other paths to the caller', async () => {
    const { base } = await serve(true);
    expect((await fetch(base + '/elsewhere')).status).toBe(404);
  });
});
