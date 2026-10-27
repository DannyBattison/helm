/**
 * Syncing helm instances. Each side describes what it holds (a manifest); the side that starts a sync compares the two and works out what
 * to pull and what to push. A sync can be started by hand, or by the doorbell of a standing connection (see `src/core/sync.ts`). Nothing
 * here touches the disk or the network.
 */
export const SYNC_VERSION = 2;
/** The lists of records that have no id of their own: told apart by a short hash of their content. */
export const SYNC_LISTS = ['usage', 'audit', 'daily'] as const;
export type SyncList = (typeof SYNC_LISTS)[number];
/** How many events before the end of a transcript are sent again, because a tool's result is patched into the slot of the call that asked for it. */
export const TRANSCRIPT_OVERLAP = 50;

export interface Tombstone { kind: 'session' | 'repo' | 'automation'; id: string; at: number }
/** `n` events; `h` a hash of their content. */
export interface TranscriptInfo { n: number; h: string }

export interface SyncManifest {
  v: number;
  /** Who is answering. */
  instance: { id: string; name: string };
  /** Record id to when it last changed (`updatedAt`). */
  repos: Record<string, number>;
  automations: Record<string, number>;
  sessions: Record<string, number>;
  /** Keyed by a session's id, or `<id>~<subagent>`. */
  transcripts: Record<string, TranscriptInfo>;
  deleted: Tombstone[];
  lists: Record<SyncList, string[]>;
  /** Repository artifacts: path (relative to the data directory) to size. */
  files: Record<string, number>;
}

/** What one side asks the other for (or sends): ids and hashes, not content. A transcript is asked for from an event number on. */
export interface SyncWant {
  repos: string[];
  automations: string[];
  sessions: string[];
  transcripts: Record<string, number>;
  lists: Record<SyncList, string[]>;
  files: string[];
}

export const emptyWant = (): SyncWant => ({ repos: [], automations: [], sessions: [], transcripts: {}, lists: { usage: [], audit: [], daily: [] }, files: [] });
export const wantCount = (w: SyncWant) => w.repos.length + w.automations.length + w.sessions.length + Object.keys(w.transcripts).length + w.files.length + SYNC_LISTS.reduce((n, k) => n + w.lists[k].length, 0);

const missing = (have: Iterable<string>, from: string[]) => { const h = new Set(have); return from.filter((x) => !h.has(x)); };

/** The latest deletion of each record, from either side. */
export function deadMap(...lists: Tombstone[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lists) for (const t of l) m.set(`${t.kind}:${t.id}`, Math.max(m.get(`${t.kind}:${t.id}`) ?? 0, t.at));
  return m;
}

/**
 * What `local` should get from `remote` (`pull`) and what `remote` should get from `local` (`push`). The copy changed last wins; a record
 * deleted after its last change is gone, not copied back. A session running here is never pulled: this instance is its owner.
 */
export function planSync(local: SyncManifest, remote: SyncManifest, runningHere: (sessionId: string) => boolean = () => false): { pull: SyncWant; push: SyncWant } {
  const pull = emptyWant(), push = emptyWant();
  const dead = deadMap(local.deleted, remote.deleted);
  const live = (kind: Tombstone['kind'], id: string, u: number) => (dead.get(`${kind}:${id}`) ?? -1) < u;
  const records = (kind: Tombstone['kind'], l: Record<string, number>, r: Record<string, number>, into: { pull: string[]; push: string[] }) => {
    for (const [id, u] of Object.entries(r)) if (live(kind, id, u) && (l[id] === undefined || u > l[id])) into.pull.push(id);
    for (const [id, u] of Object.entries(l)) if (live(kind, id, u) && (r[id] === undefined || u > r[id])) into.push.push(id);
  };
  const pairs = {
    repos: { pull: pull.repos, push: push.repos }, automations: { pull: pull.automations, push: push.automations }, sessions: { pull: pull.sessions, push: push.sessions }
  };
  records('repo', local.repos, remote.repos, pairs.repos);
  records('automation', local.automations, remote.automations, pairs.automations);
  records('session', local.sessions, remote.sessions, pairs.sessions);
  pull.sessions = pull.sessions.filter((id) => !runningHere(id));

  for (const k of SYNC_LISTS) { pull.lists[k] = missing(local.lists[k], remote.lists[k]); push.lists[k] = missing(remote.lists[k], local.lists[k]); }
  pull.files = missing(Object.keys(local.files), Object.keys(remote.files)); push.files = missing(Object.keys(remote.files), Object.keys(local.files));

  for (const key of new Set([...Object.keys(local.transcripts), ...Object.keys(remote.transcripts)])) {
    const l = local.transcripts[key], r = remote.transcripts[key], sid = key.split('~')[0];
    const sessionAlive = (m: SyncManifest) => m.sessions[sid] !== undefined && live('session', sid, m.sessions[sid]);
    if (l && r && l.h === r.h) continue;
    let dir: 'pull' | 'push' | null;
    if (!l) dir = 'pull'; else if (!r) dir = 'push';
    else if (r.n !== l.n) dir = r.n > l.n ? 'pull' : 'push';
    // Same length, different content: whoever's session changed last has the right one.
    else dir = (remote.sessions[sid] ?? 0) > (local.sessions[sid] ?? 0) ? 'pull' : (remote.sessions[sid] ?? 0) < (local.sessions[sid] ?? 0) ? 'push' : null;
    if (dir === 'pull' && !runningHere(sid) && sessionAlive(remote)) pull.transcripts[key] = Math.max(0, (l?.n ?? 0) - TRANSCRIPT_OVERLAP);
    if (dir === 'push' && sessionAlive(local)) push.transcripts[key] = Math.max(0, (r?.n ?? 0) - TRANSCRIPT_OVERLAP);
  }
  return { pull, push };
}

/** Splits a request into pieces of at most `n` sessions, then `n` transcripts each, so no single request carries the whole history. */
export function chunkWant(w: SyncWant, n = 10): SyncWant[] {
  const out: SyncWant[] = [{ ...w, sessions: w.sessions.slice(0, n), transcripts: {} }];
  for (let i = n; i < w.sessions.length; i += n) out.push({ ...emptyWant(), sessions: w.sessions.slice(i, i + n) });
  const keys = Object.keys(w.transcripts);
  for (let i = 0; i < keys.length; i += n) out.push({ ...emptyWant(), transcripts: Object.fromEntries(keys.slice(i, i + n).map((k) => [k, w.transcripts[k]])) });
  return out.filter((x) => wantCount(x) > 0);
}

export interface SyncCounts { sessions: number; repos: number; automations: number; records: number; files: number; events: number; deleted: number }
export const emptyCounts = (): SyncCounts => ({ sessions: 0, repos: 0, automations: 0, records: 0, files: 0, events: 0, deleted: 0 });
export const countTotal = (c: SyncCounts) => Object.values(c).reduce((a, b) => a + b, 0);
export interface SyncPeerResult { at: number; ok: boolean; error?: string; pulled: SyncCounts; pushed: SyncCounts }
export interface SyncPeerInfo {
  id: string; name: string; url: string;
  /** Keep this server in step all the time, over a standing connection. */
  continuous: boolean;
  /** The standing connection: only meaningful when `continuous`. */
  live: { state: 'off' | 'connecting' | 'connected' | 'error'; error?: string };
  last?: SyncPeerResult;
}
export interface SyncStatus {
  /** This instance can be synced into (it has a web address): the hosted server. The desktop app can only start syncs. */
  canServe: boolean;
  enabled: boolean;
  /** Instances currently holding a standing connection to this one. */
  connected: number;
  peers: SyncPeerInfo[];
}
