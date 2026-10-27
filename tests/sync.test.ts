import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '../src/core/sync';
import { Store } from '../src/core/store';
import { chunkWant, emptyWant, planSync, sessionStamp } from '../src/shared/sync';

const manifest = (o: any = {}) => ({ v: 1, repos: [], automations: [], sessions: {}, lists: { usage: [], audit: [], daily: [] }, files: {}, ...o });

describe('planSync', () => {
  it('pulls what is further on there, pushes what is further on here, leaves equals', () => {
    const p = planSync(
      manifest({ repos: ['a/x'], sessions: { mine: { size: 5, stamp: 1 }, both: { size: 5, stamp: 9 }, ahead: { size: 3, stamp: 1 }, behind: { size: 9, stamp: 1 } } }),
      manifest({ repos: ['a/y'], sessions: { theirs: { size: 1, stamp: 1 }, both: { size: 5, stamp: 9 }, ahead: { size: 8, stamp: 1 }, behind: { size: 2, stamp: 1 } } })
    );
    expect(p.pull.sessions.sort()).toEqual(['ahead', 'theirs']);
    expect(p.push.sessions.sort()).toEqual(['behind', 'mine']);
    expect(p.pull.repos).toEqual(['a/y']);
    expect(p.push.repos).toEqual(['a/x']);
  });
  it('breaks a tie on size with the later event', () => {
    const p = planSync(manifest({ sessions: { s: { size: 5, stamp: 1 } } }), manifest({ sessions: { s: { size: 5, stamp: 2 } } }));
    expect(p.pull.sessions).toEqual(['s']);
  });
  it('splits sessions into chunks and keeps the rest in the first', () => {
    const w = { ...emptyWant(), repos: ['r'], sessions: ['1', '2', '3'] };
    const c = chunkWant(w, 2);
    expect(c.map((x) => x.sessions)).toEqual([['1', '2'], ['3']]);
    expect(c[0].repos).toEqual(['r']);
    expect(chunkWant(emptyWant())).toEqual([]);
  });
  it('ignores when a session was last looked at', () => {
    expect(sessionStamp({ startedAt: 1, timeline: [{ t: 5, status: 'idle' }], lastAccess: 999 } as any)).toBe(5);
  });
});

const mk = async (running: string[] = [], serve = true) => {
  const store = new Store();
  const dir = await mkdtemp(join(tmpdir(), 'helm-sync-'));
  await store.load(dir);
  const svc = new SyncService(store, () => ({ dataDir: dir }), (id) => running.includes(id), () => undefined, () => serve);
  await svc.load();
  return { store, svc };
};
const session = (id: string, extra: any = {}) => ({ id, repoId: 'o/r', status: 'idle', worktree: '/elsewhere/' + id, subagents: [], timeline: [{ t: 10, status: 'idle' }], startedAt: 1, ...extra }) as any;

afterEach(() => vi.unstubAllGlobals());

describe('syncing two instances', () => {
  it('copies history both ways, keeps local paths, and does nothing the second time', async () => {
    const server = await mk(), client = await mk();
    server.store.data.settings.syncEnabled = true;
    const key = await server.svc.key();
    server.store.data.sessions.push(session('onserver'), session('both'));
    client.store.data.sessions.push(session('onclient'), session('both', { worktree: '/mine/both' }));
    await writeFile(join(server.store.root, 'transcripts', 'onserver.json'), '[{"k":"text"}]');
    await writeFile(join(server.store.root, 'transcripts', 'both.json'), '[{"k":"text"},{"k":"text"}]');
    await writeFile(join(client.store.root, 'transcripts', 'onclient.json'), '[{"k":"text"}]');
    await writeFile(join(client.store.root, 'transcripts', 'both.json'), '[{"k":"text"}]');
    server.store.data.audit.push({ n: 1 } as any);
    client.store.data.audit.push({ n: 2 } as any);

    vi.stubGlobal('fetch', async (url: string, init: any) => {
      const path = new URL(url).pathname;
      if (!server.svc.authorised(init.headers.Authorization)) return new Response('{}', { status: 401 });
      const r = await server.svc.handle(init.method, path, init.body || '');
      return new Response(JSON.stringify(r.json), { status: r.status });
    });
    await client.svc.addPeer('srv', 'https://srv.example/', key);
    const [r] = await client.svc.run();
    expect(r.result.error).toBeUndefined();
    expect(r.result.pulled.sessions).toBe(2);
    expect(r.result.pushed.sessions).toBe(1);

    expect(client.store.data.sessions.map((s) => s.id).sort()).toEqual(['both', 'onclient', 'onserver']);
    expect(server.store.data.sessions.map((s) => s.id).sort()).toEqual(['both', 'onclient', 'onserver']);
    expect(client.store.data.sessions.find((s) => s.id === 'both')!.worktree).toBe('/mine/both');
    expect(await readFile(join(client.store.root, 'transcripts', 'both.json'), 'utf8')).toBe('[{"k":"text"},{"k":"text"}]');
    expect(await readFile(join(server.store.root, 'transcripts', 'onclient.json'), 'utf8')).toBe('[{"k":"text"}]');
    expect(client.store.data.audit).toHaveLength(2);
    expect(server.store.data.audit).toHaveLength(2);

    const [again] = await client.svc.run();
    expect(again.result).toMatchObject({ ok: true, pulled: { sessions: 0, records: 0 }, pushed: { sessions: 0, records: 0 } });
  });

  it('never replaces a session that is running here', async () => {
    const a = await mk(['s']);
    await writeFile(join(a.store.root, 'transcripts', 's.json'), '[]');
    a.store.data.sessions.push(session('s', { step: 'mine' }));
    const n = await a.svc.apply({ repos: [], automations: [], sessions: [session('s', { step: 'theirs' })], lists: { usage: [], audit: [], daily: [] }, files: { 'transcripts/s.json': { enc: 'utf8', data: '[{"k":"text"}]' } } });
    expect(n.sessions).toBe(0);
    expect(a.store.data.sessions[0].step).toBe('mine');
  });

  it('refuses unknown keys, and is invisible unless enabled', async () => {
    const s = await mk();
    const key = await s.svc.key();
    expect(s.svc.authorised(`Bearer ${key}`)).toBe(false);
    s.store.data.settings.syncEnabled = true;
    expect(s.svc.authorised(`Bearer ${key}`)).toBe(true);
    expect(s.svc.authorised('Bearer nope')).toBe(false);
    expect(s.svc.authorised(undefined)).toBe(false);
    const old = key;
    await s.svc.regenerateKey();
    expect(s.svc.authorised(`Bearer ${old}`)).toBe(false);
  });

  it('is off on a host with no address', async () => {
    const s = await mk([], false);
    s.store.data.settings.syncEnabled = true;
    expect(s.svc.authorised(`Bearer ${await s.svc.key()}`)).toBe(false);
  });

  it('does not write transcripts or artifacts outside the data directory', async () => {
    const a = await mk();
    await a.svc.apply({ repos: [], automations: [], sessions: [session('x')], lists: { usage: [], audit: [], daily: [] }, files: { 'transcripts/../../evil.json': { enc: 'utf8', data: 'x' }, 'auth.bin': { enc: 'utf8', data: 'x' } } });
    await expect(readFile(join(a.store.root, 'auth.bin'))).rejects.toThrow();
  });
});
