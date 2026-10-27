import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SYNC_LISTS, SYNC_VERSION, chunkWant, emptyCounts, emptyWant, isNewer, planSync, sessionStamp } from '../shared/sync';
import type { SyncCounts, SyncList, SyncManifest, SyncPeerInfo, SyncPeerResult, SyncStatus, SyncWant } from '../shared/sync';
import type { Host } from './host';
import { adopt, readEntry, target, walk, writeEntry } from './migrate';
import type { FileEntry } from './migrate';
import type { Store } from './store';
import { uid } from './util';

/**
 * Keeping two helm instances' history in step. A sync is started by one side (a button in Settings), which asks the other for a manifest of
 * what it holds, works out what each side lacks, then pulls and pushes it. The side that is asked is a hosted server answering plain HTTP
 * with a bearer key; the desktop app has no address, so it can start syncs but not receive them. Settings, sign-ins, passwords, caches and
 * the activity log are never synced, and nothing is deleted: a session removed on one side comes back from the other.
 */
type Vault = Pick<Host, 'dataDir' | 'encrypt' | 'decrypt'>;
interface Peer { id: string; name: string; url: string; key: string; last?: SyncPeerResult }
interface Secrets { key: string; peers: Peer[] }

export interface SyncBundle {
  repos: unknown[];
  automations: unknown[];
  sessions: any[];
  lists: Record<SyncList, unknown[]>;
  files: Record<string, FileEntry>;
}

const hash = (x: unknown) => createHash('sha1').update(JSON.stringify(x)).digest('base64url').slice(0, 12);
const newKey = () => 'hsk_' + randomBytes(24).toString('hex');
/** Every file of a session's transcripts: its own and its subagents'. */
const isTranscriptOf = (name: string, id: string) => name === `transcripts/${id}.json` || name.startsWith(`transcripts/${id}~`);
const same = (a: string, b: string) => { const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest(); return timingSafeEqual(x, y); };
export const normaliseUrl = (u: string) => u.trim().replace(/\/+$/, '');

export class SyncService {
  private secrets: Secrets = { key: '', peers: [] };
  private busy = false;

  constructor(private store: Store, private vault: () => Vault, private isRunning: (id: string) => boolean, private changed: () => void, private canServe: () => boolean) {}

  private file() { return join(this.vault().dataDir, 'sync.bin'); }
  private get enabled() { return this.canServe() && this.store.data.settings.syncEnabled; }

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

  // ---------------------------------------------------------------- settings: the key and the other instances
  status(): SyncStatus {
    return { canServe: this.canServe(), enabled: this.store.data.settings.syncEnabled, peers: this.secrets.peers.map(({ id, name, url, last }): SyncPeerInfo => ({ id, name, url, last })) };
  }
  async key(): Promise<string> {
    if (!this.secrets.key) { this.secrets.key = newKey(); await this.save(); }
    return this.secrets.key;
  }
  async regenerateKey(): Promise<string> {
    this.secrets.key = newKey();
    await this.save();
    return this.secrets.key;
  }
  async addPeer(name: string, url: string, key: string) {
    url = normaliseUrl(url);
    if (!/^https?:\/\/[^/\s]+/i.test(url)) throw new Error('Enter the other server\'s address, for example https://helm.example.com');
    if (!key.trim()) throw new Error('Enter the sync key shown in the other instance\'s settings.');
    if (this.secrets.peers.some((p) => p.url.toLowerCase() === url.toLowerCase())) throw new Error('That server is already in the list.');
    this.secrets.peers.push({ id: uid(), name: name.trim() || url.replace(/^https?:\/\//i, ''), url, key: key.trim() });
    await this.save();
    this.changed();
  }
  async removePeer(id: string) {
    this.secrets.peers = this.secrets.peers.filter((p) => p.id !== id);
    await this.save();
    this.changed();
  }
  /** The files go with the data directory's secrets; deleting the key file forgets everything here. */
  async forgetAll() { this.secrets = { key: '', peers: [] }; await rm(this.file(), { force: true }); }

  // ---------------------------------------------------------------- what this instance holds
  async manifest(): Promise<SyncManifest> {
    await this.store.flushAll();
    const d = this.store.data, root = this.store.root;
    const sizes = new Map<string, number>();
    for (const f of await readdir(join(root, 'transcripts')).catch(() => [] as string[])) {
      const id = f.replace(/~.*$/, '').replace(/\.json$/, '');
      sizes.set(id, (sizes.get(id) || 0) + ((await stat(join(root, 'transcripts', f)).catch(() => null))?.size || 0));
    }
    const sessions: SyncManifest['sessions'] = {};
    for (const s of d.sessions) sessions[s.id] = { size: sizes.get(s.id) || 0, stamp: sessionStamp(s) };
    const names: string[] = [];
    await walk(root, 'repo-artifacts', names);
    const files: Record<string, number> = {};
    for (const n of names) files[n] = (await stat(join(root, n)).catch(() => null))?.size || 0;
    return {
      v: SYNC_VERSION, repos: d.repos.map((r) => r.id), automations: d.automations.map((a) => a.id), sessions,
      lists: Object.fromEntries(SYNC_LISTS.map((k) => [k, (d[k] as unknown[]).map(hash)])) as Record<SyncList, string[]>, files
    };
  }

  /** The content for what was asked for. Whatever this instance does not have is left out. */
  async bundle(want: SyncWant): Promise<SyncBundle> {
    await this.store.flushAll();
    const d = this.store.data, root = this.store.root;
    const out: SyncBundle = { repos: [], automations: [], sessions: [], lists: { usage: [], audit: [], daily: [] }, files: {} };
    const repos = new Set(want.repos), autos = new Set(want.automations), ids = new Set(want.sessions);
    out.repos = d.repos.filter((r) => repos.has(r.id));
    out.automations = d.automations.filter((a) => autos.has(a.id));
    out.sessions = d.sessions.filter((s) => ids.has(s.id));
    for (const k of SYNC_LISTS) { const h = new Set(want.lists[k]); out.lists[k] = (d[k] as unknown[]).filter((x) => h.has(hash(x))); }
    const names = new Set(want.files.filter((n) => target(root, n)));
    for (const f of await readdir(join(root, 'transcripts')).catch(() => [] as string[])) for (const id of ids) if (isTranscriptOf('transcripts/' + f, id)) names.add('transcripts/' + f);
    for (const n of names) { const e = await readEntry(root, n); if (e) out.files[n] = e; }
    return out;
  }

  /** Takes in what another instance sent. The decisions are made again here: a session only replaces ours if it is further on and ours is not running. */
  async apply(b: SyncBundle): Promise<SyncCounts> {
    const d = this.store.data, root = this.store.root, n = emptyCounts();
    const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);

    const repos = new Set(d.repos.map((r) => r.id));
    for (const r of arr(b.repos)) if (r?.id && !repos.has(r.id)) { d.repos.push(r); repos.add(r.id); n.repos++; }
    const autos = new Set(d.automations.map((a) => a.id));
    for (const a of arr(b.automations)) if (a?.id && !autos.has(a.id)) { d.automations.push(a); autos.add(a.id); n.automations++; }

    const files = b.files && typeof b.files === 'object' ? b.files : {};
    const sizeOf = (id: string) => Object.entries(files).reduce((a, [name, f]) => (isTranscriptOf(name, id) && typeof f?.data === 'string' ? a + (f.enc === 'base64' ? Buffer.from(f.data, 'base64').length : Buffer.byteLength(f.data)) : a), 0);
    const mine = await this.manifest();
    const accepted = new Set<string>();
    for (const s of arr(b.sessions)) {
      if (!s?.id || typeof s.id !== 'string' || !/^[\w-]+$/.test(s.id)) continue;
      const i = d.sessions.findIndex((x) => x.id === s.id);
      const theirs = { size: sizeOf(s.id), stamp: sessionStamp(s) };
      if (i < 0) { d.sessions.push(adopt(s, 'Synced')); accepted.add(s.id); n.sessions++; continue; }
      if (this.isRunning(s.id) || !isNewer(theirs, mine.sessions[s.id] ?? { size: 0, stamp: 0 })) continue;
      const old = d.sessions[i];
      // Where things are on disk belongs to this machine, not to the session.
      adopt(s, 'Synced');
      for (const k of ['worktree', 'worktreeGone', 'extras', 'uploads'] as const) { if (old[k] === undefined) delete (s as any)[k]; else (s as any)[k] = old[k]; }
      d.sessions[i] = s; accepted.add(s.id); n.sessions++;
    }

    for (const k of SYNC_LISTS) {
      const list = d[k] as unknown[], seen = new Set(list.map(hash));
      for (const x of arr((b.lists as any)?.[k])) if (!seen.has(hash(x))) { list.push(x); seen.add(hash(x)); n.records++; }
    }
    d.usage.sort((a, b) => a.t - b.t);
    d.daily.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

    for (const [name, f] of Object.entries(files)) {
      const dest = target(root, name);
      if (!dest || !f || typeof f.data !== 'string') continue;
      if (name.startsWith('transcripts/')) {
        const id = [...accepted].find((x) => isTranscriptOf(name, x));
        if (!id) continue;
      } else if (existsSync(dest)) continue;
      else n.files++;
      await writeEntry(dest, f);
    }
    for (const id of accepted) this.store.dropTranscripts(id);
    this.store.save();
    this.changed();
    return n;
  }

  // ---------------------------------------------------------------- answering another instance (HTTP)
  /** `null` when the key is wrong or syncing is off; the caller answers 404 or 401 without saying which. */
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

  async run(peerId?: string): Promise<{ id: string; name: string; result: SyncPeerResult }[]> {
    if (this.busy) throw new Error('A sync is already running.');
    this.busy = true;
    try {
      const out = [];
      for (const p of this.secrets.peers.filter((x) => !peerId || x.id === peerId)) {
        const result = await this.syncWith(p);
        p.last = result;
        out.push({ id: p.id, name: p.name, result });
        this.changed();
      }
      await this.save();
      return out;
    } finally { this.busy = false; }
  }

  private async syncWith(p: Peer): Promise<SyncPeerResult> {
    const result: SyncPeerResult = { at: Date.now(), ok: false, pulled: emptyCounts(), pushed: emptyCounts() };
    const add = (to: SyncCounts, from: SyncCounts) => { for (const k of Object.keys(to) as (keyof SyncCounts)[]) to[k] += from[k] || 0; };
    try {
      const remote = (await this.call(p, 'GET', '/api/sync/manifest')) as SyncManifest;
      if (!remote || remote.v !== SYNC_VERSION) throw new Error('The other server runs a different version of helm\'s sync. Update both.');
      const plan = planSync(await this.manifest(), remote);
      for (const w of chunkWant(plan.pull)) add(result.pulled, await this.apply(await this.call(p, 'POST', '/api/sync/pull', w)));
      for (const w of chunkWant(plan.push)) add(result.pushed, await this.call(p, 'POST', '/api/sync/push', await this.bundle(w)));
      result.ok = true;
    } catch (e: any) { result.error = String(e?.cause?.message || e?.message || e); }
    return result;
  }
}
