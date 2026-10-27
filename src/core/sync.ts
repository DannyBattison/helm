import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYNC_LISTS, SYNC_VERSION, chunkWant, countTotal, deadMap, emptyCounts, emptyWant, planSync } from '../shared/sync';
import type { SyncCounts, SyncList, SyncManifest, SyncPeerInfo, SyncPeerResult, SyncStatus, SyncWant, Tombstone } from '../shared/sync';
import type { TranscriptEvent } from '../shared/types';
import type { Host } from './host';
import { adopt, readEntry, target, walk, writeEntry } from './migrate';
import type { FileEntry } from './migrate';
import type { Store } from './store';
import { uid } from './util';

/**
 * Keeping helm instances' history in step. A sync is started by one side, which asks the other for a manifest of what it holds, works out
 * what each side lacks or has older, then pulls and pushes it. The side that is asked is a hosted server answering plain HTTP with a bearer
 * key; the desktop app has no address, so it starts syncs but cannot receive them.
 *
 * Continuous sync is the same sync, started by a doorbell. The starting side keeps a WebSocket open to the server (`/api/sync/stream`). The
 * server rings it ("changed") when its data changes, and the starting side syncs; it also syncs when its own data changes. No data travels
 * on the socket, so there is one code path to get right, and a missed ring costs at most five minutes (a sync is also run on that interval).
 *
 * Settings, sign-ins, passwords, caches and the activity log are never synced. Records (sessions, repositories, automated agents) are
 * stamped with `updatedAt`, and the later copy wins. Deletions travel as tombstones. A transcript has one writer, the instance running
 * the session, which others see as `remoteOwner`; a session running here is never overwritten by a sync.
 */
type Vault = Pick<Host, 'dataDir' | 'encrypt' | 'decrypt'>;
interface Peer { id: string; name: string; url: string; key: string; continuous?: boolean; last?: SyncPeerResult }
interface Secrets { key: string; peers: Peer[] }

export interface SyncOps {
  isRunning(sessionId: string): boolean;
  /** Something a sync brought in changed the state the window shows. */
  changed(): void;
  /** Whether this instance has an address other instances can reach. */
  canServe(): boolean;
  /** An event arrived for a transcript the window may be showing. */
  emitTranscript(sessionId: string, index: number, event: TranscriptEvent): void;
  /** What other instances call this one. */
  name(): string;
}

export interface SyncBundle {
  from: { id: string; name: string };
  repos: any[];
  automations: any[];
  sessions: any[];
  lists: Record<SyncList, unknown[]>;
  files: Record<string, FileEntry>;
  deleted: Tombstone[];
  /** Events of a transcript from an index on. */
  transcripts: Record<string, { from: number; events: any[] }>;
}

const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('base64url').slice(0, 12);
const newKey = () => 'hsk_' + randomBytes(24).toString('hex');
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const validKey = (k: string) => /^[\w.-]+(~[\w.-]+)?$/.test(k) && !k.includes('..');
export const normaliseUrl = (u: string) => u.trim().replace(/\/+$/, '');
const SAFETY_MS = 5 * 60_000;

export class SyncService {
  private secrets: Secrets = { key: '', peers: [] };
  private chain: Promise<unknown> = Promise.resolve();
  private txCache = new Map<string, { size: number; mtime: number; n: number; h: string }>();
  private links = new Map<string, { stop: boolean; ws?: WebSocket; timer?: NodeJS.Timeout; delay: number }>();
  private live = new Map<string, SyncPeerInfo['live']>();
  private due = new Map<string, NodeJS.Timeout>();
  private subscribers = new Map<() => void, () => void>();
  private ring: NodeJS.Timeout | null = null;
  private interval: NodeJS.Timeout | null = null;

  constructor(private store: Store, private vault: () => Vault, private ops: SyncOps) {}

  private file() { return join(this.vault().dataDir, 'sync.bin'); }
  private get enabled() { return this.ops.canServe() && this.store.data.settings.syncEnabled; }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const r = this.chain.then(fn, fn);
    this.chain = r.catch(() => undefined);
    return r;
  }

  async load() {
    try {
      const buf = await readFile(this.file()), v = this.vault();
      const j = JSON.parse(v.decrypt ? v.decrypt(buf) : buf.toString('utf8'));
      this.secrets = { key: typeof j.key === 'string' ? j.key : '', peers: Array.isArray(j.peers) ? j.peers : [] };
    } catch { this.secrets = { key: '', peers: [] }; }
  }
  private async save() {
    const v = this.vault(), raw = JSON.stringify(this.secrets);
    await writeFile(this.file(), v.encrypt ? v.encrypt(raw) : Buffer.from(raw), { mode: 0o600 });
  }

  /** Opens the standing connections and starts the safety interval. Call once, after the state has loaded. */
  start() {
    this.store.onLocalChange = () => this.localChanged();
    for (const p of this.secrets.peers) if (p.continuous) this.open(p);
    this.interval = setInterval(() => { for (const p of this.secrets.peers) if (p.continuous) this.queue(p.id, 0); }, SAFETY_MS);
    this.interval.unref?.();
  }
  stop() {
    for (const id of [...this.links.keys()]) this.close(id);
    if (this.interval) clearInterval(this.interval);
  }

  // ---------------------------------------------------------------- settings: the key and the other instances
  status(): SyncStatus {
    return {
      canServe: this.ops.canServe(), enabled: this.store.data.settings.syncEnabled, connected: this.subscribers.size,
      peers: this.secrets.peers.map(({ id, name, url, last, continuous }): SyncPeerInfo => ({ id, name, url, last, continuous: !!continuous, live: this.live.get(id) ?? { state: 'off' } }))
    };
  }
  async key(): Promise<string> {
    if (!this.secrets.key) { this.secrets.key = newKey(); await this.save(); }
    return this.secrets.key;
  }
  async regenerateKey(): Promise<string> {
    this.secrets.key = newKey();
    await this.save();
    this.dropSubscribers();
    return this.secrets.key;
  }
  /** Settings changed: a server that stops accepting syncs hangs up on the ones connected. */
  settingsChanged() { if (!this.enabled) this.dropSubscribers(); }
  async addPeer(name: string, url: string, key: string) {
    url = normaliseUrl(url);
    if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error('Enter the other server\'s address, for example https://helm.example.com');
    if (!key.trim()) throw new Error('Enter the sync key shown in the other instance\'s settings.');
    if (this.secrets.peers.some((p) => p.url.toLowerCase() === url.toLowerCase())) throw new Error('That server is already in the list.');
    this.secrets.peers.push({ id: uid(), name: name.trim() || url.replace(/^https?:\/\//i, ''), url, key: key.trim() });
    await this.save();
    this.ops.changed();
  }
  async removePeer(id: string) {
    this.close(id);
    this.secrets.peers = this.secrets.peers.filter((p) => p.id !== id);
    await this.save();
    this.ops.changed();
  }
  async setContinuous(id: string, on: boolean) {
    const p = this.secrets.peers.find((x) => x.id === id);
    if (!p) throw new Error('Unknown server.');
    p.continuous = on;
    await this.save();
    if (on) this.open(p); else this.close(id);
    this.ops.changed();
  }

  // ---------------------------------------------------------------- what this instance holds
  private async transcriptInfo(key: string) {
    const f = join(this.store.root, 'transcripts', key + '.json');
    const st = await stat(f).catch(() => null);
    if (!st) return null;
    const c = this.txCache.get(key);
    if (c && c.size === st.size && c.mtime === st.mtimeMs) return c;
    const text = await readFile(f, 'utf8').catch(() => '');
    let n = 0;
    try { const a = JSON.parse(text); n = Array.isArray(a) ? a.length : 0; } catch { /* a torn file counts as empty */ }
    const info = { size: st.size, mtime: st.mtimeMs, n, h: createHash('sha1').update(text).digest('base64url').slice(0, 12) };
    this.txCache.set(key, info);
    return info;
  }

  async manifest(): Promise<SyncManifest> {
    await this.store.flushTranscripts();
    const d = this.store.data, root = this.store.root;
    const stamps = (xs: { id: string; updatedAt?: number }[]) => Object.fromEntries(xs.map((x) => [x.id, x.updatedAt || 0]));
    const transcripts: SyncManifest['transcripts'] = {};
    for (const k of await this.store.transcriptKeys()) { const i = await this.transcriptInfo(k); if (i) transcripts[k] = { n: i.n, h: i.h }; }
    const names: string[] = [];
    await walk(root, 'repo-artifacts', names);
    const files: Record<string, number> = {};
    for (const n of names) files[n] = (await stat(join(root, n)).catch(() => null))?.size || 0;
    return {
      v: SYNC_VERSION, instance: { id: d.instanceId, name: this.ops.name() },
      repos: stamps(d.repos), automations: stamps(d.automations), sessions: stamps(d.sessions), transcripts, deleted: d.deleted,
      lists: Object.fromEntries(SYNC_LISTS.map((k) => [k, (d[k] as unknown[]).map(hash)])) as Record<SyncList, string[]>, files
    };
  }

  /** The content for what was asked for. Whatever this instance does not have is left out. */
  async bundle(want: SyncWant): Promise<SyncBundle> {
    await this.store.flushTranscripts();
    const d = this.store.data, root = this.store.root;
    const repos = new Set(want.repos), autos = new Set(want.automations), ids = new Set(want.sessions);
    const out: SyncBundle = {
      from: { id: d.instanceId, name: this.ops.name() }, repos: d.repos.filter((r) => repos.has(r.id)), automations: d.automations.filter((a) => autos.has(a.id)),
      sessions: d.sessions.filter((s) => ids.has(s.id)), lists: { usage: [], audit: [], daily: [] }, files: {}, deleted: d.deleted, transcripts: {}
    };
    for (const k of SYNC_LISTS) { const h = new Set(want.lists[k]); out.lists[k] = (d[k] as unknown[]).filter((x) => h.has(hash(x))); }
    for (const n of want.files) { const e = target(root, n) && n.startsWith('repo-artifacts/') ? await readEntry(root, n) : null; if (e) out.files[n] = e; }
    for (const [key, from] of Object.entries(want.transcripts)) {
      if (!validKey(key)) continue;
      const f = Math.max(0, Math.floor(+from) || 0);
      const events = (await this.store.peekTranscript(key)).slice(f);
      out.transcripts[key] = { from: f, events };
    }
    return out;
  }

  /** Deletes what was deleted elsewhere, unless it was changed here after that. */
  private applyDeleted(list: Tombstone[], n: SyncCounts) {
    const d = this.store.data;
    for (const t of Array.isArray(list) ? list : []) {
      if (!t || typeof t.id !== 'string' || typeof t.at !== 'number' || !['session', 'repo', 'automation'].includes(t.kind)) continue;
      const have = (t.kind === 'session' ? d.sessions : t.kind === 'repo' ? d.repos : d.automations) as { id: string; updatedAt?: number }[];
      const i = have.findIndex((x) => x.id === t.id);
      const edited = i >= 0 && (have[i].updatedAt || 0) > t.at;
      if (i >= 0 && !edited) {
        if (t.kind === 'session' && this.ops.isRunning(t.id)) continue;
        have.splice(i, 1);
        if (t.kind === 'session') { this.store.dropTranscripts(t.id); void this.store.deleteTranscripts(t.id); }
        n.deleted++;
      }
      if (!edited) this.store.tombstone(t.kind, t.id, t.at, true);
    }
  }

  /** Takes in what another instance sent. The decisions are made again here: a newer copy replaces ours, unless ours is running. */
  async apply(b: SyncBundle): Promise<SyncCounts> {
    const d = this.store.data, root = this.store.root, n = emptyCounts();
    const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
    const owner = typeof b.from?.name === 'string' ? b.from.name.slice(0, 80) : 'another instance';
    this.applyDeleted(b.deleted, n);
    const dead = deadMap(d.deleted);
    const newer = (a: any, old: any) => (a.updatedAt || 0) > (old.updatedAt || 0);
    const isLive = (kind: Tombstone['kind'], x: any) => (dead.get(`${kind}:${x.id}`) ?? -1) < (x.updatedAt || 0);

    for (const r of arr(b.repos)) {
      if (!r || typeof r.id !== 'string' || !isLive('repo', r)) continue;
      const i = d.repos.findIndex((x) => x.id === r.id);
      if (i < 0) d.repos.push(r);
      else if (newer(r, d.repos[i])) d.repos[i] = { ...r, localPath: d.repos[i].localPath };
      else continue;
      this.store.markSynced('repo', d.repos.find((x) => x.id === r.id)!); n.repos++;
    }
    for (const a of arr(b.automations)) {
      if (!a || typeof a.id !== 'string' || !isLive('automation', a)) continue;
      const i = d.automations.findIndex((x) => x.id === a.id);
      if (i < 0) d.automations.push(a); else if (newer(a, d.automations[i])) d.automations[i] = a; else continue;
      this.store.markSynced('automation', a); n.automations++;
    }
    for (const s of arr(b.sessions)) {
      if (!s || typeof s.id !== 'string' || !/^[\w-]+$/.test(s.id) || !isLive('session', s)) continue;
      const i = d.sessions.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        const old = d.sessions[i];
        if (this.ops.isRunning(s.id) || !newer(s, old)) continue;
        // Where things are on disk belongs to this machine, not to the session.
        for (const k of ['worktree', 'worktreeGone', 'extras', 'uploads'] as const) { if (old[k] === undefined) delete (s as any)[k]; else (s as any)[k] = old[k]; }
        delete s.remoteOwner;
        d.sessions[i] = adopt(s, owner);
      } else d.sessions.push(adopt(s, owner));
      this.store.markSynced('session', s); n.sessions++;
    }

    for (const k of SYNC_LISTS) {
      const list = d[k] as unknown[], seen = new Set(list.map(hash));
      for (const x of arr((b.lists as any)?.[k])) if (!seen.has(hash(x))) { list.push(x); seen.add(hash(x)); n.records++; }
    }
    if (n.records) { d.usage.sort((a, c) => a.t - c.t); d.daily.sort((a, c) => (a.day < c.day ? -1 : a.day > c.day ? 1 : 0)); }

    for (const [name, f] of Object.entries(b.files && typeof b.files === 'object' ? b.files : {})) {
      const dest = name.startsWith('repo-artifacts/') ? target(root, name) : null;
      if (!dest || !f || typeof f.data !== 'string' || (await stat(dest).catch(() => null))) continue;
      await writeEntry(dest, f);
      n.files++;
    }

    for (const [key, t] of Object.entries(b.transcripts && typeof b.transcripts === 'object' ? b.transcripts : {})) {
      const sid = key.split('~')[0];
      if (!validKey(key) || !t || !Array.isArray(t.events) || this.ops.isRunning(sid) || !d.sessions.some((s) => s.id === sid)) continue;
      const mine = await this.store.transcript(key);
      const from = Math.floor(+t.from) || 0;
      if (from < 0 || from > mine.length) continue;
      let changed = false;
      t.events.forEach((ev: any, j: number) => {
        if (!ev || typeof ev.k !== 'string') return;
        const i = from + j;
        if (i < mine.length && JSON.stringify(mine[i]) === JSON.stringify(ev)) return;
        mine[i] = ev; changed = true; n.events++;
        if (key === sid && t.events.length <= 300) this.ops.emitTranscript(sid, i, ev);
      });
      if (changed) this.store.saveTranscript(key);
    }
    if (countTotal(n)) { this.store.save(); this.ops.changed(); this.ringSubscribers(); }
    return n;
  }

  // ---------------------------------------------------------------- answering another instance (HTTP and the doorbell socket)
  authorised(header: string | undefined): boolean {
    if (!this.enabled || !this.secrets.key) return false;
    const m = /^Bearer (.+)$/.exec(header || '');
    return !!m && same(m[1], this.secrets.key);
  }
  isOn() { return this.enabled; }

  async handle(method: string, path: string, body: string): Promise<{ status: number; json: unknown }> {
    try {
      if (method === 'GET' && path === '/api/sync/manifest') return { status: 200, json: await this.manifest() };
      if (method === 'POST' && path === '/api/sync/pull') return { status: 200, json: await this.bundle({ ...emptyWant(), ...JSON.parse(body) }) };
      if (method === 'POST' && path === '/api/sync/push') return { status: 200, json: await this.apply(JSON.parse(body)) };
      return { status: 404, json: { error: 'Not found' } };
    } catch (e: any) { return { status: 400, json: { error: String(e?.message || e) } }; }
  }

  /** A connected instance wants to hear when this one changes. Returns the way to stop. `hangUp` closes its socket. */
  subscribe(ring: () => void, hangUp: () => void): () => void {
    this.subscribers.set(ring, hangUp);
    this.ops.changed();
    return () => { if (this.subscribers.delete(ring)) this.ops.changed(); };
  }
  private dropSubscribers() { for (const hangUp of [...this.subscribers.values()]) hangUp(); this.subscribers.clear(); }
  private ringSubscribers() {
    if (this.ring || !this.subscribers.size) return;
    this.ring = setTimeout(() => { this.ring = null; for (const r of this.subscribers.keys()) r(); }, 800);
  }

  /** Something changed here by itself: tell whoever is listening, and sync with the servers kept in step. */
  localChanged() {
    this.ringSubscribers();
    for (const p of this.secrets.peers) if (p.continuous && this.live.get(p.id)?.state === 'connected') this.queue(p.id, 2000);
  }

  // ---------------------------------------------------------------- the standing connection to a server
  private setLive(id: string, live: SyncPeerInfo['live']) {
    const old = this.live.get(id);
    this.live.set(id, live);
    if (old?.state !== live.state || old?.error !== live.error) this.ops.changed();
  }
  private open(p: Peer) {
    this.close(p.id);
    const link = { stop: false, delay: 1000 } as { stop: boolean; ws?: WebSocket; timer?: NodeJS.Timeout; delay: number };
    this.links.set(p.id, link);
    const go = () => {
      if (link.stop) return;
      this.setLive(p.id, { state: 'connecting' });
      let ws: WebSocket;
      let over = false;
      const failed = (why: string) => {
        if (over) return;
        over = true;
        try { ws?.close(); } catch { /* already closed */ }
        if (link.stop) return;
        this.setLive(p.id, { state: 'error', error: why });
        link.timer = setTimeout(go, link.delay);
        link.delay = Math.min(link.delay * 2, 60_000);
      };
      try { ws = new WebSocket(p.url.replace(/^http/i, 'ws') + '/api/sync/stream'); } catch (e: any) { failed(String(e?.message || e)); return; }
      link.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', key: p.key }));
      ws.onmessage = (ev) => {
        let m: any;
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.t === 'ready') { link.delay = 1000; this.setLive(p.id, { state: 'connected' }); this.queue(p.id, 0); } else if (m.t === 'changed') this.queue(p.id, 300);
        else if (m.t === 'refused') failed('The other server refused the key, or syncing is off there.');
      };
      ws.onerror = () => failed('Could not connect.');
      ws.onclose = () => failed('Disconnected.');
    };
    go();
  }
  private close(id: string) {
    const l = this.links.get(id);
    if (l) { l.stop = true; clearTimeout(l.timer); try { l.ws?.close(); } catch { /* already closed */ } this.links.delete(id); }
    clearTimeout(this.due.get(id)); this.due.delete(id);
    if (this.live.delete(id)) this.ops.changed();
  }
  /** Syncs with one server soon. Asking again before then just waits for the same sync. */
  private queue(id: string, ms: number) {
    if (this.due.has(id)) return;
    this.due.set(id, setTimeout(() => {
      this.due.delete(id);
      const p = this.secrets.peers.find((x) => x.id === id);
      if (!p) return;
      void this.exclusive(async () => {
        const before = JSON.stringify(p.last && [p.last.ok, p.last.error]);
        const r = await this.syncWith(p);
        const moved = countTotal(r.pulled) + countTotal(r.pushed) > 0;
        p.last = r.ok && !moved && p.last?.ok ? { ...p.last, at: r.at } : r;
        if (moved || before !== JSON.stringify([p.last.ok, p.last.error])) { await this.save(); this.ops.changed(); }
      });
    }, ms));
  }

  // ---------------------------------------------------------------- starting a sync
  private async call(p: Peer, method: string, path: string, body?: unknown): Promise<any> {
    const r = await fetch(p.url + path, { method, headers: { Authorization: `Bearer ${p.key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10 * 60_000) });
    const text = await r.text();
    let j: any = null;
    try { j = JSON.parse(text); } catch { /* not JSON: a proxy's error page */ }
    if (r.status === 401 || r.status === 404) throw new Error('The other server refused the request. Check the address and key, and that syncing is turned on there.');
    if (!r.ok) throw new Error(j?.error || `The server answered ${r.status}`);
    return j;
  }

  /** Syncs now with one server, or all of them, and says what happened. */
  run(peerId?: string): Promise<{ id: string; name: string; result: SyncPeerResult }[]> {
    return this.exclusive(async () => {
      const out = [];
      for (const p of this.secrets.peers.filter((x) => !peerId || x.id === peerId)) {
        const result = await this.syncWith(p);
        p.last = result;
        out.push({ id: p.id, name: p.name, result });
        this.ops.changed();
      }
      await this.save();
      return out;
    });
  }

  private async syncWith(p: Peer): Promise<SyncPeerResult> {
    const result: SyncPeerResult = { at: Date.now(), ok: false, pulled: emptyCounts(), pushed: emptyCounts() };
    const add = (to: SyncCounts, from: SyncCounts) => { for (const k of Object.keys(to) as (keyof SyncCounts)[]) to[k] += from?.[k] || 0; };
    try {
      const remote = (await this.call(p, 'GET', '/api/sync/manifest')) as SyncManifest;
      if (!remote || remote.v !== SYNC_VERSION) throw new Error('The other server runs a different version of helm\'s sync. Update both.');
      // What it deleted goes first, so the plan below does not copy it back.
      this.applyDeleted(remote.deleted, result.pulled);
      const local = await this.manifest();
      const plan = planSync(local, remote, (id) => this.ops.isRunning(id));
      for (const w of chunkWant(plan.pull)) add(result.pulled, await this.apply(await this.call(p, 'POST', '/api/sync/pull', w)));
      const pushes = chunkWant(plan.push);
      const theirDead = deadMap(remote.deleted);
      const owe = local.deleted.some((t) => (theirDead.get(`${t.kind}:${t.id}`) ?? -1) < t.at);
      if (!pushes.length && owe) pushes.push(emptyWant());
      for (const w of pushes) add(result.pushed, await this.call(p, 'POST', '/api/sync/push', await this.bundle(w)));
      result.ok = true;
    } catch (e: any) { result.error = String(e?.cause?.message || e?.message || e); }
    return result;
  }
}
