import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '../src/core/sync';
import { Store } from '../src/core/store';
import { chunkWant, emptyWant, planSync } from '../src/shared/sync';

const manifest = (o: any = {}) => ({ v: 2, instance: { id: 'x', name: 'x' }, repos: {}, automations: {}, sessions: {}, transcripts: {}, deleted: [], lists: { usage: [], audit: [], daily: [] }, files: {}, ...o });

describe('planSync', () => {
  it('pulls what changed later there, pushes what changed later here, leaves equals', () => {
    const p = planSync(
      manifest({ repos: { 'a/x': 1 }, sessions: { mine: 1, both: 9, ahead: 3, behind: 9 } }),
      manifest({ repos: { 'a/y': 1 }, sessions: { theirs: 1, both: 9, ahead: 8, behind: 2 } })
    );
    expect(p.pull.sessions.sort()).toEqual(['ahead', 'theirs']);
    expect(p.push.sessions.sort()).toEqual(['behind', 'mine']);
    expect(p.pull.repos).toEqual(['a/y']);
    expect(p.push.repos).toEqual(['a/x']);
  });
  it('does not copy back what was deleted after it last changed, but does copy what was changed after', () => {
    const p = planSync(manifest({ sessions: { gone: 5, back: 20 } }), manifest({ deleted: [{ kind: 'session', id: 'gone', at: 10 }, { kind: 'session', id: 'back', at: 10 }] }));
    expect(p.push.sessions).toEqual(['back']);
  });
  it('sends transcripts that differ from near their end, longer one first', () => {
    const t = (n: number, h: string) => ({ n, h });
    const p = planSync(
      manifest({ sessions: { a: 1, b: 1, c: 1, d: 1 }, transcripts: { a: t(100, 'x'), b: t(10, 'x'), c: t(5, 'x'), d: t(5, 'x') } }),
      manifest({ sessions: { a: 1, b: 1, c: 1, d: 1 }, transcripts: { a: t(160, 'y'), b: t(10, 'x'), c: t(5, 'y'), d: t(5, 'x') } })
    );
    expect(p.pull.transcripts).toEqual({ a: 50 });
    expect(p.push.transcripts).toEqual({});
  });
  it('breaks a tie on length by which session changed last, and never pulls one running here', () => {
    const local = manifest({ sessions: { s: 1 }, transcripts: { s: { n: 5, h: 'a' } } });
    const remote = manifest({ sessions: { s: 2 }, transcripts: { s: { n: 5, h: 'b' } } });
    expect(Object.keys(planSync(local, remote).pull.transcripts)).toEqual(['s']);
    expect(planSync(local, remote, () => true).pull.transcripts).toEqual({});
    expect(planSync(local, remote, () => true).pull.sessions).toEqual([]);
  });
  it('splits sessions, then transcripts, into chunks', () => {
    const w = { ...emptyWant(), repos: ['r'], sessions: ['1', '2', '3'], transcripts: { '1': 0, '2': 0, '3': 0 } };
    const c = chunkWant(w, 2);
    expect(c.map((x) => x.sessions)).toEqual([['1', '2'], ['3'], [], []]);
    expect(c[0].repos).toEqual(['r']);
    expect(c.map((x) => Object.keys(x.transcripts).length)).toEqual([0, 0, 2, 1]);
    expect(chunkWant(emptyWant())).toEqual([]);
  });
});

const mk = async (running: string[] = [], serve = true) => {
  const store = new Store();
  const dir = await mkdtemp(join(tmpdir(), 'helm-sync-'));
  await store.load(dir);
  const events: any[] = [];
  const svc = new SyncService(store, () => ({ dataDir: dir }), { isRunning: (id) => running.includes(id), changed: () => undefined, canServe: () => serve, emitTranscript: (...a) => events.push(a), name: () => 'box-' + dir.slice(-4) });
  await svc.load();
  return { store, svc, events, dir };
};
const session = (id: string, extra: any = {}) => ({ id, repoId: 'o/r', status: 'idle', worktree: '/elsewhere/' + id, subagents: [], timeline: [{ t: 10, status: 'idle' }], startedAt: 1, updatedAt: 10, ...extra }) as any;
const tx = async (x: { store: Store }, key: string, evs: any[]) => writeFile(join(x.store.root, 'transcripts', key + '.json'), JSON.stringify(evs));
const link = (server: Awaited<ReturnType<typeof mk>>) => vi.stubGlobal('fetch', async (url: string, init: any) => {
  if (!server.svc.authorised(init.headers.Authorization)) return new Response('{}', { status: 401 });
  const r = await server.svc.handle(init.method, new URL(url).pathname, init.body || '');
  return new Response(JSON.stringify(r.json), { status: r.status });
});
const pair = async () => {
  const server = await mk(), client = await mk();
  server.store.data.settings.syncEnabled = true;
  link(server);
  await client.svc.addPeer('srv', 'https://srv.example/', await server.svc.key());
  return { server, client };
};

afterEach(() => vi.unstubAllGlobals());

describe('syncing two instances', () => {
  it('copies history both ways, keeps local paths, and does nothing the second time', async () => {
    const { server, client } = await pair();
    server.store.data.sessions.push(session('onserver'), session('both', { updatedAt: 20 }));
    client.store.data.sessions.push(session('onclient'), session('both', { worktree: '/mine/both', updatedAt: 5 }));
    await tx(server, 'onserver', [{ k: 'text' }]); await tx(server, 'both', [{ k: 'text' }, { k: 'text' }]);
    await tx(client, 'onclient', [{ k: 'text' }]); await tx(client, 'both', [{ k: 'text' }]);
    server.store.data.audit.push({ n: 1 } as any);
    client.store.data.audit.push({ n: 2 } as any);

    const [r] = await client.svc.run();
    expect(r.result.error).toBeUndefined();
    expect(r.result.pulled.sessions).toBe(2);
    expect(r.result.pushed.sessions).toBe(1);
    expect(client.store.data.sessions.map((s) => s.id).sort()).toEqual(['both', 'onclient', 'onserver']);
    expect(server.store.data.sessions.map((s) => s.id).sort()).toEqual(['both', 'onclient', 'onserver']);
    expect(client.store.data.sessions.find((s) => s.id === 'both')!.worktree).toBe('/mine/both');
    await client.store.flushTranscripts();
    expect(await readFile(join(client.store.root, 'transcripts', 'both.json'), 'utf8')).toBe('[{"k":"text"},{"k":"text"}]');
    await server.store.flushTranscripts();
    expect(await readFile(join(server.store.root, 'transcripts', 'onclient.json'), 'utf8')).toBe('[{"k":"text"}]');
    expect(client.store.data.audit).toHaveLength(2);
    expect(server.store.data.audit).toHaveLength(2);

    const [again] = await client.svc.run();
    expect(again.result.ok).toBe(true);
    expect(again.result.pulled).toMatchObject({ sessions: 0, records: 0, events: 0 });
    expect(again.result.pushed).toMatchObject({ sessions: 0, records: 0, events: 0 });
  });

  it('carries a live session as it grows, including a result patched into an earlier slot', async () => {
    const { server, client } = await pair();
    server.store.data.sessions.push(session('s', { status: 'working', updatedAt: 10 }));
    await tx(server, 's', [{ k: 'tool', r: null }, { k: 'text', t: 'a' }]);
    await client.svc.run();
    const mine = client.store.data.sessions[0];
    expect(mine).toMatchObject({ status: 'idle', remoteOwner: expect.stringMatching(/^box-/) });

    await tx(server, 's', [{ k: 'tool', r: 'done' }, { k: 'text', t: 'a' }, { k: 'text', t: 'b' }]);
    server.store.data.sessions[0].updatedAt = 30;
    await client.svc.run();
    await client.store.flushTranscripts();
    expect(JSON.parse(await readFile(join(client.store.root, 'transcripts', 's.json'), 'utf8'))).toEqual([{ k: 'tool', r: 'done' }, { k: 'text', t: 'a' }, { k: 'text', t: 'b' }]);
    expect(client.events.map((e) => e[1])).toContain(2);

    // It stops over there: the copy here is free to continue.
    server.store.data.sessions[0].status = 'idle';
    server.store.data.sessions[0].updatedAt = 40;
    await client.svc.run();
    expect(client.store.data.sessions[0].remoteOwner).toBeUndefined();
  });

  it('later change wins for sessions, repositories and automated agents', async () => {
    const { server, client } = await pair();
    server.store.data.sessions.push(session('s', { customTitle: 'new', updatedAt: 50 }));
    client.store.data.sessions.push(session('s', { customTitle: 'old', updatedAt: 20 }));
    server.store.data.repos.push({ id: 'o/r', localPath: '/srv/r', cap: 5, updatedAt: 1 } as any);
    client.store.data.repos.push({ id: 'o/r', localPath: '/me/r', cap: 9, updatedAt: 9 } as any);
    await client.svc.run();
    expect(client.store.data.sessions[0].customTitle).toBe('new');
    expect(server.store.data.repos[0]).toMatchObject({ cap: 9, localPath: '/srv/r' });
  });

  it('carries a deletion to the other side instead of bringing it back', async () => {
    const { server, client } = await pair();
    server.store.data.sessions.push(session('s', { updatedAt: 10 }));
    await client.svc.run();
    expect(client.store.data.sessions).toHaveLength(1);
    client.store.data.sessions = [];
    client.store.tombstone('session', 's', Date.now() + 1000);
    await client.svc.run();
    expect(server.store.data.sessions).toHaveLength(0);
    await client.svc.run();
    expect(client.store.data.sessions).toHaveLength(0);
    // Deleted on one side but changed later on the other: the change wins.
    server.store.data.sessions.push(session('t', { updatedAt: 100 }));
    client.store.tombstone('session', 't', 50);
    await client.svc.run();
    expect(client.store.data.sessions.map((s) => s.id)).toEqual(['t']);
  });

  it('stamps only records that really changed, and not a mere look', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('s', { updatedAt: 10 }));
    await a.store.flush();
    const stamped = a.store.data.sessions[0].updatedAt!;
    expect(stamped).toBeGreaterThan(10);
    await new Promise((r) => setTimeout(r, 5));
    a.store.data.sessions[0].lastAccess = Date.now();
    await a.store.flush();
    expect(a.store.data.sessions[0].updatedAt).toBe(stamped);
    await new Promise((r) => setTimeout(r, 5));
    a.store.data.sessions[0].step = 'something new';
    await a.store.flush();
    expect(a.store.data.sessions[0].updatedAt).toBeGreaterThan(stamped);
  });

  it('never replaces a session or transcript that is running here', async () => {
    const a = await mk(['s']);
    await tx(a, 's', []);
    a.store.data.sessions.push(session('s', { step: 'mine', updatedAt: 10 }));
    const n = await a.svc.apply({ from: { id: 'o', name: 'o' }, repos: [], automations: [], sessions: [session('s', { step: 'theirs', updatedAt: 99 })], lists: { usage: [], audit: [], daily: [] }, files: {}, deleted: [], transcripts: { s: { from: 0, events: [{ k: 'text' }] } } });
    expect(n.sessions).toBe(0);
    expect(n.events).toBe(0);
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
    await s.svc.regenerateKey();
    expect(s.svc.authorised(`Bearer ${key}`)).toBe(false);
  });

  it('is off on a host with no address', async () => {
    const s = await mk([], false);
    s.store.data.settings.syncEnabled = true;
    expect(s.svc.authorised(`Bearer ${await s.svc.key()}`)).toBe(false);
  });

  it('does not write transcripts or artifacts outside the data directory', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('x'));
    await a.svc.apply({ from: { id: 'o', name: 'o' }, repos: [], automations: [], sessions: [], lists: { usage: [], audit: [], daily: [] }, deleted: [], transcripts: { '../../evil': { from: 0, events: [{ k: 'text' }] } }, files: { 'transcripts/../../evil.json': { enc: 'utf8', data: 'x' }, 'repo-artifacts/../auth.bin': { enc: 'utf8', data: 'x' }, 'auth.bin': { enc: 'utf8', data: 'x' } } });
    await expect(readFile(join(a.store.root, 'auth.bin'))).rejects.toThrow();
    await expect(readFile(join(a.store.root, '..', 'evil.json'))).rejects.toThrow();
  });
});

describe('continuous sync', () => {
  it('syncs when the server rings and when the client changes, and gives up on a refused key', async () => {
    const { server, client } = await pair();
    const peer = client.svc.status().peers[0];
    const rings: (() => void)[] = [];
    class FakeSocket {
      static last: FakeSocket;
      onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void;
      constructor(public url: string) { FakeSocket.last = this; setTimeout(() => this.onopen?.(), 0); }
      send(text: string) {
        const key = JSON.parse(text).key;
        if (!server.svc.authorised('Bearer ' + key)) return void this.onmessage?.({ data: '{"t":"refused"}' });
        server.svc.subscribe(() => this.onmessage?.({ data: '{"t":"changed"}' }), () => this.onclose?.());
        rings.push(() => this.onmessage?.({ data: '{"t":"changed"}' }));
        this.onmessage?.({ data: '{"t":"ready"}' });
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);
    client.svc.start();
    await client.svc.setContinuous(peer.id, true);
    await vi.waitFor(() => expect(client.svc.status().peers[0].live.state).toBe('connected'));
    expect(server.svc.status().connected).toBe(1);

    // Something happens on the server: its subscribers are rung, and the client pulls it.
    server.store.data.sessions.push(session('fresh', { updatedAt: 5 }));
    await tx(server, 'fresh', [{ k: 'text' }]);
    server.store.onLocalChange?.() ?? server.svc.localChanged();
    await vi.waitFor(() => expect(client.store.data.sessions.map((s) => s.id)).toEqual(['fresh']), { timeout: 4000 });

    // Something happens on the client: it pushes by itself.
    client.store.data.sessions.push(session('mine', { updatedAt: 6 }));
    client.svc.localChanged();
    await vi.waitFor(() => expect(server.store.data.sessions.map((s) => s.id).sort()).toEqual(['fresh', 'mine']), { timeout: 6000 });

    // The server regenerates its key: the standing connection is dropped.
    await server.svc.regenerateKey();
    expect(server.svc.status().connected).toBe(0);
    client.svc.stop();
  }, 20000);
});
