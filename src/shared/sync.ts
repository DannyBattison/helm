import type { Session } from './types';

/**
 * Syncing two helm instances. Each side describes what it holds (a manifest); the side that starts the sync compares the two and works out
 * what to pull and what to push. Nothing here touches the disk or the network.
 */
export const SYNC_VERSION = 1;
/** The lists of records that have no id of their own: told apart by a short hash of their content. */
export const SYNC_LISTS = ['usage', 'audit', 'daily'] as const;
export type SyncList = (typeof SYNC_LISTS)[number];

export interface SyncManifest {
  v: number;
  repos: string[];
  automations: string[];
  /** `size` is the bytes of the transcript files (they only grow); `stamp` the last time anything happened to the session. */
  sessions: Record<string, { size: number; stamp: number }>;
  lists: Record<SyncList, string[]>;
  /** Repository artifacts: path (relative to the data directory) to size. */
  files: Record<string, number>;
}

/** What one side asks the other for (or sends): ids and hashes, not content. */
export interface SyncWant {
  repos: string[];
  automations: string[];
  sessions: string[];
  lists: Record<SyncList, string[]>;
  files: string[];
}

export const emptyWant = (): SyncWant => ({ repos: [], automations: [], sessions: [], lists: { usage: [], audit: [], daily: [] }, files: [] });
export const wantCount = (w: SyncWant) => w.repos.length + w.automations.length + w.sessions.length + w.files.length + SYNC_LISTS.reduce((n, k) => n + w.lists[k].length, 0);

/** When something last happened to a session. Looking at it does not count (`lastAccess` is left out), so reading a session on one instance never makes it look newer. */
export const sessionStamp = (s: Pick<Session, 'startedAt' | 'endedAt' | 'mergedAt' | 'archivedAt' | 'pushedAt' | 'timeline'>) =>
  Math.max(s.startedAt || 0, s.endedAt || 0, s.mergedAt || 0, s.archivedAt || 0, s.pushedAt || 0, s.timeline?.[s.timeline.length - 1]?.t || 0);

/** Is `theirs` further on than `mine`? More transcript wins; when they are the same length, the later event wins. Equal means leave it. */
export const isNewer = (theirs: { size: number; stamp: number }, mine: { size: number; stamp: number }) =>
  theirs.size > mine.size || (theirs.size === mine.size && theirs.stamp > mine.stamp);

const missing = (have: Iterable<string>, from: string[]) => { const h = new Set(have); return from.filter((x) => !h.has(x)); };

/** What `local` should get from `remote` (`pull`) and what `remote` should get from `local` (`push`). */
export function planSync(local: SyncManifest, remote: SyncManifest): { pull: SyncWant; push: SyncWant } {
  const pull = emptyWant(), push = emptyWant();
  pull.repos = missing(local.repos, remote.repos); push.repos = missing(remote.repos, local.repos);
  pull.automations = missing(local.automations, remote.automations); push.automations = missing(remote.automations, local.automations);
  for (const k of SYNC_LISTS) { pull.lists[k] = missing(local.lists[k], remote.lists[k]); push.lists[k] = missing(remote.lists[k], local.lists[k]); }
  pull.files = missing(Object.keys(local.files), Object.keys(remote.files)); push.files = missing(Object.keys(remote.files), Object.keys(local.files));
  for (const [id, r] of Object.entries(remote.sessions)) { const l = local.sessions[id]; if (!l || isNewer(r, l)) pull.sessions.push(id); }
  for (const [id, l] of Object.entries(local.sessions)) { const r = remote.sessions[id]; if (!r || isNewer(l, r)) push.sessions.push(id); }
  return { pull, push };
}

/** Splits a request into pieces of at most `n` sessions, so no single request carries the whole history. Everything that is not a session goes in the first. */
export function chunkWant(w: SyncWant, n = 10): SyncWant[] {
  const first: SyncWant = { ...w, sessions: w.sessions.slice(0, n) };
  const out = [first];
  for (let i = n; i < w.sessions.length; i += n) out.push({ ...emptyWant(), sessions: w.sessions.slice(i, i + n) });
  return out.filter((x) => wantCount(x) > 0);
}

export interface SyncCounts { sessions: number; repos: number; automations: number; records: number; files: number }
export const emptyCounts = (): SyncCounts => ({ sessions: 0, repos: 0, automations: 0, records: 0, files: 0 });
export interface SyncPeerResult { at: number; ok: boolean; error?: string; pulled: SyncCounts; pushed: SyncCounts }
export interface SyncPeerInfo { id: string; name: string; url: string; last?: SyncPeerResult }
export interface SyncStatus {
  /** This instance can be synced into (it has a web address): the hosted server. The desktop app can only start syncs. */
  canServe: boolean;
  enabled: boolean;
  peers: SyncPeerInfo[];
}
