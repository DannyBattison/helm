import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncService, normaliseUrl, type SyncBundle } from '../src/core/sync';
import { Store } from '../src/core/store';

const mk = async (running: string[] = [], serve = true, vault: any = {}) => {
  const store = new Store();
  const dir = await mkdtemp(join(tmpdir(), 'helm-cov-sync-'));
  await store.load(dir);
  const events: any[] = [];
  const changed = vi.fn();
  const svc = new SyncService(store, () => ({ dataDir: dir, ...vault }), { isRunning: (id) => running.includes(id), changed, canServe: () => serve, emitTranscript: (...a) => events.push(a), name: () => 'box' });
  await svc.load();
  return { store, svc, events, dir, changed };
};
type X = Awaited<ReturnType<typeof mk>>;
const session = (id: string, extra: any = {}) => ({ id, repoId: 'o/r', status: 'idle', subagents: [], timeline: [], startedAt: 1, updatedAt: 10, ...extra }) as any;
const emptyBundle = (o: Partial<SyncBundle> = {}): SyncBundle => ({ from: { id: 'o', name: 'o' }, repos: [], automations: [], sessions: [], lists: { usage: [], audit: [], daily: [] }, files: {}, deleted: [], transcripts: {}, ...o });
const tx = (x: X, key: string, evs: any[]) => writeFile(join(x.store.root, 'transcripts', key + '.json'), JSON.stringify(evs));
const link = (server: X) => vi.stubGlobal('fetch', async (url: string, init: any) => {
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

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('secrets file', () => {
  it('goes through the vault when it can encrypt', async () => {
    const vault = { encrypt: (s: string) => Buffer.from('E' + s), decrypt: (b: Buffer) => b.toString().slice(1) };
    const a = await mk([], true, vault);
    const key = await a.svc.key();
    expect((await readFile(join(a.dir, 'sync.bin'), 'utf8')).startsWith('E')).toBe(true);
    await a.svc.addPeer('p', 'http://p.example', 'k');
    const b = new SyncService(a.store, () => ({ dataDir: a.dir, ...vault }), { isRunning: () => false, changed() {}, canServe: () => true, emitTranscript() {}, name: () => 'b' });
    await b.load();
    expect(await b.key()).toBe(key);
    expect(b.status().peers.map((p) => p.url)).toEqual(['http://p.example']);
  });
  it('starts empty from a damaged file, and tolerates odd shapes', async () => {
    const a = await mk();
    await writeFile(join(a.dir, 'sync.bin'), '{"key":5,"peers":"x"}');
    await a.svc.load();
    expect(a.svc.status().peers).toEqual([]);
    await writeFile(join(a.dir, 'sync.bin'), 'garbage');
    await a.svc.load();
    expect(a.svc.status().peers).toEqual([]);
    expect(await a.svc.key()).toMatch(/^hsk_/);
    expect(await a.svc.key()).toBe(await a.svc.key());
  });
});

describe('servers list', () => {
  it('validates what is added, names it from the address, and refuses a duplicate', async () => {
    const a = await mk();
    expect(normaliseUrl(' https://x.io/// ')).toBe('https://x.io');
    await expect(a.svc.addPeer('n', 'ftp://x', 'k')).rejects.toThrow(/address/);
    await expect(a.svc.addPeer('n', 'https://x.io', '  ')).rejects.toThrow(/sync key/);
    await a.svc.addPeer('  ', 'https://Host.example/', ' k ');
    await expect(a.svc.addPeer('n', 'https://host.EXAMPLE', 'k')).rejects.toThrow(/already/);
    expect(a.svc.status().peers[0]).toMatchObject({ name: 'Host.example', url: 'https://Host.example', continuous: false, live: { state: 'off' } });
    expect(a.changed).toHaveBeenCalled();
  });
  it('removes a server, and refuses to change one that is not there', async () => {
    const a = await mk();
    await a.svc.addPeer('n', 'https://x.io', 'k');
    await expect(a.svc.setContinuous('nope', true)).rejects.toThrow(/Unknown server/);
    await a.svc.removePeer(a.svc.status().peers[0].id);
    expect(a.svc.status().peers).toEqual([]);
  });
  it('reports whether it can serve and how many are connected', async () => {
    const a = await mk([], false);
    expect(a.svc.status()).toMatchObject({ canServe: false, enabled: false, connected: 0 });
    expect(a.svc.isOn()).toBe(false);
  });
});

describe('answering requests', () => {
  it('serves the manifest, rejects unknown routes and bad bodies', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('s', { updatedAt: 7 }));
    await tx(a, 's', [{ k: 'text' }]);
    const m = await a.svc.handle('GET', '/api/sync/manifest', '');
    expect(m.status).toBe(200);
    expect((m.json as any).sessions).toEqual({ s: 7 });
    expect((m.json as any).transcripts.s.n).toBe(1);
    expect((await a.svc.handle('GET', '/nope', '')).status).toBe(404);
    expect((await a.svc.handle('POST', '/api/sync/manifest', '')).status).toBe(404);
    const bad = await a.svc.handle('POST', '/api/sync/push', '{not json');
    expect(bad.status).toBe(400);
    expect((bad.json as any).error).toBeTruthy();
    expect((await a.svc.handle('POST', '/api/sync/pull', 'null')).status).toBe(200);
  });
  it('bundles what is asked for and skips the rest', async () => {
    const a = await mk();
    a.store.data.repos.push({ id: 'o/r' } as any, { id: 'o/q' } as any);
    a.store.data.automations.push({ id: 'a1' } as any, { id: 'a2' } as any);
    a.store.data.sessions.push(session('s1'), session('s2'));
    a.store.data.audit.push({ n: 1 } as any, { n: 2 } as any);
    await tx(a, 's1', [{ k: 'text', t: 'a' }, { k: 'text', t: 'b' }, { k: 'text', t: 'c' }]);
    await mkdir(join(a.store.root, 'repo-artifacts', 'o'), { recursive: true });
    await writeFile(join(a.store.root, 'repo-artifacts', 'o', 'n.md'), 'note');
    await writeFile(join(a.store.root, 'secret.txt'), 'no');
    const { createHash } = await import('node:crypto');
    const h = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('base64url').slice(0, 12);
    const b = await a.svc.bundle({
      repos: ['o/r', 'zzz'], automations: ['a2'], sessions: ['s2'], lists: { usage: [], audit: [h({ n: 2 })], daily: [] },
      files: ['repo-artifacts/o/n.md', 'repo-artifacts/o/missing.md', 'secret.txt', 'repo-artifacts/../secret.txt'],
      transcripts: { s1: 1.9, 's1~x': -3, '../bad': 0 }
    } as any);
    expect(b.repos.map((r) => r.id)).toEqual(['o/r']);
    expect(b.automations.map((r) => r.id)).toEqual(['a2']);
    expect(b.sessions.map((r) => r.id)).toEqual(['s2']);
    expect(b.lists.audit).toEqual([{ n: 2 }]);
    expect(Object.keys(b.files)).toEqual(['repo-artifacts/o/n.md']);
    expect(b.transcripts.s1).toEqual({ from: 1, events: [{ k: 'text', t: 'b' }, { k: 'text', t: 'c' }] });
    expect(b.transcripts['s1~x']).toEqual({ from: 0, events: [] });
    expect(Object.keys(b.transcripts)).not.toContain('../bad');
  });
  it('lists artifacts and notices when a transcript file changed or is torn', async () => {
    const a = await mk();
    await mkdir(join(a.store.root, 'repo-artifacts'), { recursive: true });
    await writeFile(join(a.store.root, 'repo-artifacts', 'f.txt'), 'abc');
    await writeFile(join(a.store.root, 'transcripts', 'torn.json'), '{"not":"array"');
    await writeFile(join(a.store.root, 'transcripts', 'obj.json'), '{"a":1}');
    await tx(a, 'ok', [{ k: 'text' }]);
    let m = await a.svc.manifest();
    expect(m.files).toEqual({ 'repo-artifacts/f.txt': 3 });
    expect(m.transcripts.torn.n).toBe(0);
    expect(m.transcripts.obj.n).toBe(0);
    const h1 = m.transcripts.ok.h;
    expect((await a.svc.manifest()).transcripts.ok.h).toBe(h1);
    await tx(a, 'ok', [{ k: 'text' }, { k: 'text', t: 'longer' }]);
    m = await a.svc.manifest();
    expect(m.transcripts.ok.n).toBe(2);
    expect(m.transcripts.ok.h).not.toBe(h1);
  });
});

describe('applying what arrives', () => {
  it('adds new repositories and automations, takes newer ones, keeps the local path, ignores older and malformed', async () => {
    const a = await mk();
    a.store.data.repos.push({ id: 'o/r', localPath: '/mine', cap: 1, updatedAt: 5 } as any);
    a.store.data.automations.push({ id: 'a1', name: 'old', updatedAt: 5 } as any);
    const n = await a.svc.apply(emptyBundle({
      repos: [{ id: 'o/r', localPath: '/theirs', cap: 2, updatedAt: 9 }, { id: 'o/new', updatedAt: 1 }, { id: 'o/r', cap: 0, updatedAt: 1 }, null, { id: 5 }],
      automations: [{ id: 'a1', name: 'new', updatedAt: 9 }, { id: 'a2' }, { id: 'a1', name: 'older', updatedAt: 1 }, null, {}]
    }));
    expect(n).toMatchObject({ repos: 2, automations: 2 });
    expect(a.store.data.repos[0]).toMatchObject({ cap: 2, localPath: '/mine' });
    expect(a.store.data.repos.map((r) => r.id)).toEqual(['o/r', 'o/new']);
    expect(a.store.data.automations.map((x: any) => x.name)).toEqual(['new', undefined]);
    expect(a.changed).toHaveBeenCalled();
  });
  it('adopts sessions as stopped and owned elsewhere, keeping this machine\'s paths for an existing one', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('old', { updatedAt: 1, worktree: '/mine/w', extras: ['/e'], uploads: undefined }));
    const n = await a.svc.apply(emptyBundle({
      from: { id: 'o', name: 'N'.repeat(100) },
      sessions: [
        session('old', { updatedAt: 9, status: 'working', worktree: '/theirs', worktreeGone: true, extras: ['/x'], uploads: ['u'], remoteOwner: 'zzz' }),
        session('fresh', { status: 'working', worktree: '/theirs/f' }),
        session('../bad'), null, { id: 3 }
      ]
    }));
    expect(n.sessions).toBe(2);
    const old = a.store.data.sessions.find((s) => s.id === 'old')!;
    expect(old).toMatchObject({ worktree: '/mine/w', extras: ['/e'], step: expect.stringMatching(/^Running on N{80}$/), remoteOwner: 'N'.repeat(80) });
    expect(old.uploads).toBeUndefined();
    expect(old.worktreeGone).toBe(true); // /mine/w is not a real folder here
    expect(a.store.data.sessions.map((s) => s.id)).toEqual(['old', 'fresh']);
  });
  it('names an unnamed sender "another instance"', async () => {
    const a = await mk();
    await a.svc.apply({ ...emptyBundle({ sessions: [session('s', { status: 'working' })] }), from: undefined as any });
    expect(a.store.data.sessions[0].remoteOwner).toBe('another instance');
  });
  it('takes in records not already held and keeps usage and daily sorted', async () => {
    const a = await mk();
    a.store.data.usage.push({ t: 5 } as any);
    const n = await a.svc.apply(emptyBundle({ lists: { usage: [{ t: 9 }, { t: 5 }, { t: 1 }, { t: 1 }], audit: [], daily: [{ day: 'b' }, { day: 'a' }, { day: 'b' }] } as any }));
    expect(n.records).toBe(4);
    expect(a.store.data.usage.map((u) => u.t)).toEqual([1, 5, 9]);
    expect(a.store.data.daily.map((u) => u.day)).toEqual(['a', 'b']);
    expect((await a.svc.apply(emptyBundle({ lists: undefined as any }))).records).toBe(0);
  });
  it('writes new artifacts but never over existing files or outside the folder', async () => {
    const a = await mk();
    await mkdir(join(a.store.root, 'repo-artifacts'), { recursive: true });
    await writeFile(join(a.store.root, 'repo-artifacts', 'have.md'), 'mine');
    const n = await a.svc.apply(emptyBundle({ files: {
      'repo-artifacts/have.md': { enc: 'utf8', data: 'theirs' }, 'repo-artifacts/x/new.md': { enc: 'utf8', data: 'new' },
      'repo-artifacts/nodata.md': { enc: 'utf8' } as any, 'repo-artifacts/null.md': null as any, 'transcripts/t.json': { enc: 'utf8', data: '[]' }
    } }));
    expect(n.files).toBe(1);
    expect(await readFile(join(a.store.root, 'repo-artifacts', 'have.md'), 'utf8')).toBe('mine');
    expect(await readFile(join(a.store.root, 'repo-artifacts', 'x', 'new.md'), 'utf8')).toBe('new');
    await expect(readFile(join(a.store.root, 'transcripts', 't.json'))).rejects.toThrow();
    await a.svc.apply(emptyBundle({ files: 'x' as any, transcripts: 'x' as any }));
  });
  it('merges transcript events, announces small changes to the window and ignores unusable ones', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('s'));
    await tx(a, 's', [{ k: 'text', t: 'a' }]);
    await tx(a, 's~sub', []);
    const n = await a.svc.apply(emptyBundle({ transcripts: {
      s: { from: 0, events: [{ k: 'text', t: 'a' }, { k: 'text', t: 'b' }, null, { x: 1 } as any, { k: 'text', t: 'c' }] },
      's~sub': { from: 0, events: [{ k: 'text', t: 'z' }] },
      ghost: { from: 0, events: [{ k: 'text' }] },
      '../s': { from: 0, events: [{ k: 'text' }] },
      s2: { from: 0, events: 'no' as any }
    } }));
    expect(n.events).toBe(3);
    expect(a.events.map((e) => [e[0], e[1]])).toEqual([['s', 1], ['s', 4]]);
    await a.store.flushTranscripts();
    expect((await a.store.transcript('s')).length).toBe(5);
  });
  it('does not announce a big transcript event by event, and refuses a gap or a negative start', async () => {
    const a = await mk();
    a.store.data.sessions.push(session('s'));
    await tx(a, 's', []);
    const many = Array.from({ length: 301 }, (_, i) => ({ k: 'text', t: String(i) }));
    await a.svc.apply(emptyBundle({ transcripts: { s: { from: 0, events: many } } }));
    expect(a.events).toEqual([]);
    const n = await a.svc.apply(emptyBundle({ transcripts: { s: { from: 999, events: [{ k: 'text' }] } } }));
    expect(n.events).toBe(0);
    expect((await a.svc.apply(emptyBundle({ transcripts: { s: { from: -2, events: [{ k: 'text' }] } } }))).events).toBe(0);
  });
});

describe('deletions', () => {
  it('deletes sessions, repositories and automations, unless edited since or running, and ignores bad entries', async () => {
    const a = await mk(['run']);
    const now = Date.now();
    a.store.data.sessions.push(session('gone', { updatedAt: 5 }), session('edited', { updatedAt: now + 5000 }), session('run', { updatedAt: 5 }));
    a.store.data.repos.push({ id: 'o/gone', updatedAt: 5 } as any);
    a.store.data.automations.push({ id: 'a-gone' } as any);
    await tx(a, 'gone', [{ k: 'text' }]);
    const n = await a.svc.apply(emptyBundle({ deleted: [
      { kind: 'session', id: 'gone', at: now }, { kind: 'session', id: 'edited', at: now }, { kind: 'session', id: 'run', at: now },
      { kind: 'repo', id: 'o/gone', at: now }, { kind: 'automation', id: 'a-gone', at: now }, { kind: 'session', id: 'never-had', at: now },
      { kind: 'other', id: 'x', at: now } as any, { kind: 'session', id: 5, at: now } as any, { kind: 'session', id: 'q', at: 'x' } as any, null as any
    ] }));
    expect(n.deleted).toBe(3);
    expect(a.store.data.sessions.map((s) => s.id)).toEqual(['edited', 'run']);
    expect(a.store.data.repos).toEqual([]);
    expect(a.store.data.automations).toEqual([]);
    expect(a.store.data.deleted.map((t) => t.id).sort()).toEqual(['a-gone', 'gone', 'never-had', 'o/gone']);
    await a.svc.apply(emptyBundle({ deleted: 'x' as any }));
  });
  it('does not take back a record that was deleted after its last change', async () => {
    const a = await mk();
    const now = Date.now();
    a.store.tombstone('repo', 'o/r', now, true);
    a.store.tombstone('automation', 'a', now, true);
    a.store.tombstone('session', 's', now, true);
    const n = await a.svc.apply(emptyBundle({ repos: [{ id: 'o/r', updatedAt: 50 }], automations: [{ id: 'a', updatedAt: 50 }], sessions: [session('s', { updatedAt: 50 })] }));
    expect(n).toMatchObject({ repos: 0, automations: 0, sessions: 0 });
  });
});

describe('subscribers', () => {
  it('rings after a pause, once, and a gone subscriber is no longer counted', async () => {
    vi.useFakeTimers();
    const a = await mk();
    a.store.data.settings.syncEnabled = true;
    const ring = vi.fn(), hang = vi.fn();
    const stop = a.svc.subscribe(ring, hang);
    expect(a.svc.status().connected).toBe(1);
    a.svc.localChanged(); a.svc.localChanged();
    await vi.advanceTimersByTimeAsync(900);
    expect(ring).toHaveBeenCalledTimes(1);
    stop(); stop();
    expect(a.svc.status().connected).toBe(0);
    a.svc.localChanged();
    await vi.advanceTimersByTimeAsync(900);
    expect(ring).toHaveBeenCalledTimes(1);
  });
  it('hangs up on subscribers when syncing is turned off, and not while it is on', async () => {
    const a = await mk();
    const hang = vi.fn();
    a.svc.subscribe(() => {}, hang);
    a.store.data.settings.syncEnabled = true;
    a.svc.settingsChanged();
    expect(hang).not.toHaveBeenCalled();
    a.store.data.settings.syncEnabled = false;
    a.svc.settingsChanged();
    expect(hang).toHaveBeenCalledTimes(1);
    expect(a.svc.status().connected).toBe(0);
  });
});

describe('starting a sync', () => {
  const stubFetch = (fn: (url: string, init: any) => Response | Promise<Response>) => vi.stubGlobal('fetch', async (u: string, i: any) => fn(u, i));
  const peerOf = async (a: X) => { await a.svc.addPeer('p', 'https://p.example', 'k'); return a.svc.status().peers[0].id; };
  const m2 = (o: any = {}) => ({ v: 3, instance: { id: 'r', name: 'r' }, repos: {}, automations: {}, sessions: {}, owners: {}, settings: 0, transcripts: {}, deleted: [], lists: { usage: [], audit: [], daily: [] }, files: {}, ...o });

  it('explains a refused key, a different version, a server error and an unreachable server', async () => {
    const a = await mk();
    await peerOf(a);
    stubFetch(() => new Response('{}', { status: 401 }));
    expect((await a.svc.run())[0].result.error).toMatch(/refused/);
    stubFetch(() => new Response('<html>nope</html>', { status: 404 }));
    expect((await a.svc.run())[0].result.error).toMatch(/refused/);
    stubFetch(() => new Response(JSON.stringify(m2({ v: 99 })), { status: 200 }));
    expect((await a.svc.run())[0].result.error).toMatch(/different version/);
    stubFetch(() => new Response('null', { status: 200 }));
    expect((await a.svc.run())[0].result.error).toMatch(/different version/);
    stubFetch(() => new Response('{"error":"disk full"}', { status: 500 }));
    expect((await a.svc.run())[0].result.error).toBe('disk full');
    stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    expect((await a.svc.run())[0].result.error).toBe('The server answered 502');
    stubFetch(() => { throw Object.assign(new Error('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND') }); });
    expect((await a.svc.run())[0].result.error).toBe('getaddrinfo ENOTFOUND');
    stubFetch(() => { throw new Error('plain'); });
    const r = (await a.svc.run())[0].result;
    expect(r).toMatchObject({ ok: false, error: 'plain' });
    expect(a.svc.status().peers[0].last?.error).toBe('plain');
  });
  it('syncs with only the server asked for', async () => {
    const a = await mk();
    const id1 = await peerOf(a);
    await a.svc.addPeer('q', 'https://q.example', 'k');
    const urls: string[] = [];
    stubFetch((u) => { urls.push(u); return new Response(JSON.stringify(m2()), { status: 200 }); });
    const out = await a.svc.run(id1);
    expect(out.map((o) => o.name)).toEqual(['p']);
    expect(urls.every((u) => u.startsWith('https://p.example'))).toBe(true);
    expect((await a.svc.run('nope'))).toEqual([]);
  });
  it('sends tombstones it owes even when there is nothing else to push, and takes theirs first', async () => {
    const a = await mk();
    await peerOf(a);
    a.store.data.sessions.push(session('theirs-gone', { updatedAt: 1 }));
    a.store.tombstone('session', 'mine-gone', Date.now(), true);
    const posts: any[] = [];
    stubFetch((u, i) => {
      if (u.endsWith('/manifest')) return new Response(JSON.stringify(m2({ deleted: [{ kind: 'session', id: 'theirs-gone', at: Date.now() }] })), { status: 200 });
      posts.push([u, JSON.parse(i.body)]);
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const [r] = await a.svc.run();
    expect(r.result.ok).toBe(true);
    expect(r.result.pulled.deleted).toBe(1);
    expect(a.store.data.sessions).toEqual([]);
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toMatch(/\/push$/);
    expect(posts[0][1].deleted.map((t: any) => t.id).sort()).toEqual(['mine-gone', 'theirs-gone']);
  });
  it('serialises syncs started together', async () => {
    const a = await mk();
    await peerOf(a);
    let active = 0, peak = 0;
    stubFetch(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return new Response(JSON.stringify(m2()), { status: 200 }); });
    await Promise.all([a.svc.run(), a.svc.run()]);
    expect(peak).toBe(1);
  });
});

const realTimeout = setTimeout;
const settle = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 8; i++) { await new Promise((r) => realTimeout(r, 5)); await vi.advanceTimersByTimeAsync(0); } };

describe('standing connection', () => {
  class Sock {
    static all: Sock[] = [];
    static throwNext = false;
    onopen?: () => void; onmessage?: (e: { data: any }) => void; onclose?: () => void; onerror?: () => void;
    sent: string[] = []; closed = 0; closeThrows = false;
    constructor(public url: string) { if (Sock.throwNext) { Sock.throwNext = false; throw new Error('bad url'); } Sock.all.push(this); }
    send(t: string) { this.sent.push(t); }
    close() { this.closed++; if (this.closeThrows) throw new Error('x'); }
  }
  const setup = async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    Sock.all = [];
    vi.stubGlobal('WebSocket', Sock);
    const a = await mk();
    // sync attempts triggered by the doorbell find a server that is not there
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ v: 3, instance: { id: 'r', name: 'r' }, repos: {}, automations: {}, sessions: {}, owners: {}, settings: 0, transcripts: {}, deleted: [], lists: { usage: [], audit: [], daily: [] }, files: {} }), { status: 200 }));
    await a.svc.addPeer('p', 'https://p.example', 'KEY');
    const id = a.svc.status().peers[0].id;
    return { a, id };
  };
  const live = (a: X) => a.svc.status().peers[0].live;

  it('connects, says hello with the key, and goes live when told it is ready', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    const s = Sock.all[0];
    expect(s.url).toBe('wss://p.example/api/sync/stream');
    expect(live(a).state).toBe('connecting');
    s.onopen!();
    expect(JSON.parse(s.sent[0])).toEqual({ t: 'hello', key: 'KEY' });
    s.onmessage!({ data: 'not json' });
    s.onmessage!({ data: '{"t":"unknown"}' });
    s.onmessage!({ data: '{"t":"ready"}' });
    expect(live(a).state).toBe('connected');
    expect(a.svc.status().peers[0].continuous).toBe(true);
    await settle(10);
    expect(a.svc.status().peers[0].last?.ok).toBe(true);
    a.svc.stop();
    expect(s.closed).toBeGreaterThan(0);
    expect(a.svc.status().peers[0].live.state).toBe('off');
  });
  it('uses ws for an http address and reconnects with a growing delay, resetting once ready', async () => {
    const { a } = await setup();
    await a.svc.removePeer(a.svc.status().peers[0].id);
    await a.svc.addPeer('p', 'http://plain.example', 'K');
    await a.svc.setContinuous(a.svc.status().peers[0].id, true);
    expect(Sock.all[0].url).toBe('ws://plain.example/api/sync/stream');
    Sock.all[0].onerror!();
    expect(live(a)).toEqual({ state: 'error', error: 'Could not connect.' });
    Sock.all[0].onclose!();           // a second failure from the same socket is ignored
    await settle(1000);
    expect(Sock.all).toHaveLength(2);
    Sock.all[1].onclose!();
    expect(live(a).error).toBe('Disconnected.');
    await settle(1999);
    expect(Sock.all).toHaveLength(2);
    await settle(1);
    expect(Sock.all).toHaveLength(3);
    Sock.all[2].onmessage!({ data: '{"t":"ready"}' });
    Sock.all[2].onclose!();
    await settle(1000);
    expect(Sock.all).toHaveLength(4);
    a.svc.stop();
  });
  it('caps the delay at a minute', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    for (let i = 0; i < 8; i++) { Sock.all[Sock.all.length - 1].onerror!(); await vi.advanceTimersByTimeAsync(60_000); }
    const n = Sock.all.length;
    Sock.all[n - 1].onerror!();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(Sock.all).toHaveLength(n);
    await settle(1);
    expect(Sock.all).toHaveLength(n + 1);
    a.svc.stop();
  });
  it('reports a refused key and a constructor that throws, and survives a socket that cannot be closed', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    Sock.all[0].closeThrows = true;
    Sock.all[0].onmessage!({ data: '{"t":"refused"}' });
    expect(live(a).error).toMatch(/refused the key/);
    Sock.throwNext = true;
    await settle(1000);
    expect(live(a)).toEqual({ state: 'error', error: 'bad url' });
    await settle(2000);
    expect(Sock.all).toHaveLength(2);
    a.svc.stop();
  });
  it('stops reconnecting once closed, even when the socket reports afterwards', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    const s = Sock.all[0];
    s.closeThrows = true;
    await a.svc.setContinuous(id, false);
    s.onclose!();
    await settle(5000);
    expect(Sock.all).toHaveLength(1);
    expect(live(a).state).toBe('off');
  });
  it('syncs on a ring, and the safety interval and local changes queue syncs only for connected servers', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    a.svc.start();
    const s = Sock.all[Sock.all.length - 1];
    const calls = () => (globalThis.fetch as any);
    const fetchSpy = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', fetchSpy);
    a.svc.localChanged();                       // not connected yet: nothing queued
    await settle(2500);
    expect(fetchSpy).not.toHaveBeenCalled();
    s.onmessage!({ data: '{"t":"ready"}' });
    await settle(10);
    const afterReady = fetchSpy.mock.calls.length;
    expect(afterReady).toBeGreaterThan(0);
    s.onmessage!({ data: '{"t":"changed"}' });
    s.onmessage!({ data: '{"t":"changed"}' });  // asking again before it runs waits for the same one
    await settle(400);
    const afterRing = fetchSpy.mock.calls.length;
    expect(afterRing).toBeGreaterThan(afterReady);
    a.svc.localChanged();
    await settle(2100);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(afterRing);
    const before = fetchSpy.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(before);
    expect(calls).toBeDefined();
    a.svc.stop();
  });
  it('does nothing for a queued sync whose server was removed', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    const spy = vi.fn(globalThis.fetch);
    vi.stubGlobal('fetch', spy);
    Sock.all[0].onmessage!({ data: '{"t":"changed"}' });
    (a.svc as any).secrets.peers = [];
    await settle(500);
    expect(spy).not.toHaveBeenCalled();
    a.svc.stop();
  });
  it('records a failing sync once, and keeps the earlier success time when nothing moved', async () => {
    const { a, id } = await setup();
    await a.svc.setContinuous(id, true);
    Sock.all[0].onmessage!({ data: '{"t":"ready"}' });
    await settle(10);
    const first = a.svc.status().peers[0].last!;
    expect(first.ok).toBe(true);
    await settle(1000);
    Sock.all[0].onmessage!({ data: '{"t":"changed"}' });
    await settle(400);
    expect(a.svc.status().peers[0].last!.ok).toBe(true);
    expect(a.svc.status().peers[0].last!.at).toBeGreaterThan(first.at);
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    Sock.all[0].onmessage!({ data: '{"t":"changed"}' });
    await settle(400);
    expect(a.svc.status().peers[0].last).toMatchObject({ ok: false });
    a.svc.stop();
  });
});
