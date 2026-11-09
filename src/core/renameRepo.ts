import { mkdir, rename } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import type { Session } from '../shared/types';
import { claudeProjectDir } from './claudeBackend';
import * as G from './git';
import * as GH from './github';
import { validRepoName } from '../shared/repoName';
import { renameRepoFixtures } from './repofixtures';
import type { RepoService } from './repos';
import type { Store } from './store';

/** The same URL with the repository's name swapped, keeping the protocol and any `.git`. */
export const renamedRemote = (url: string, name: string) => url.replace(/(github\.com[:/]+[^/\s]+\/)[^/\s]+?(\.git)?(\/?\s*)$/i, `$1${name}$2$3`);

const within = (p: string, dir: string) => p === dir || p.startsWith(dir + sep);
const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface RenameDeps {
  store: Store;
  repos: RepoService;
  /** Sessions in the repository whose agent is running or waiting on you. */
  live(repoId: string): Session[];
  /** Who the activity log credits. */
  who(): string;
}

/**
 * Renames a repository on GitHub, then follows it locally: the origin URL, the clone's folder, the folder holding its sessions'
 * worktrees (and the Claude Code history filed under those paths), and everything helm keyed by the old `owner/name`.
 * Refuses while an agent is working in it, since its folder would move under it. Local steps that fail are returned as warnings:
 * by then GitHub has the new name, so helm has to follow it.
 */
export async function renameRepository(d: RenameDeps, id: string, raw: string): Promise<{ id: string; warnings: string[] }> {
  const { store, repos } = d;
  const repo = repos.must(id);
  const name = raw.trim();
  const bad = validRepoName(name);
  if (bad) throw new Error(bad);
  if (name === repo.name) throw new Error('That is already its name.');
  if (repos.find(`${repo.owner}/${name}`) && !sameFile(name, repo.name)) throw new Error(`${repo.owner}/${name} is already added to helm.`);
  const live = d.live(id);
  if (live.length) throw new Error(`Wait for ${live.length === 1 ? 'its running agent' : `its ${live.length} running agents`} (${live.slice(0, 3).map((s) => s.id).join(', ')}${live.length > 3 ? '…' : ''}) to finish, or stop ${live.length === 1 ? 'it' : 'them'}, first: their folders are about to move.`);

  // Folders that carry the name: the clone itself, and the folder under the worktree root that holds this repository's worktrees.
  const mine = store.data.sessions.filter((s) => !s.free && (s.repoId === id || s.extras?.some((e) => e.repoId === id)));
  const wtPaths = (s: Session) => [s.repoId === id ? s.worktree : '', ...(s.extras ?? []).filter((e) => e.repoId === id).map((e) => e.worktree)].filter(Boolean);
  const moves: { from: string; to: string }[] = [];
  if (basename(repo.localPath) === repo.name && (await G.fileExists(repo.localPath))) moves.push({ from: repo.localPath, to: join(dirname(repo.localPath), name) });
  for (const s of mine) for (const p of wtPaths(s)) {
    const parent = dirname(p);
    if (basename(parent) === repo.name && !moves.some((m) => m.from === parent) && (await G.fileExists(parent))) moves.push({ from: parent, to: join(dirname(parent), name) });
  }
  for (const m of moves) if (!sameFile(m.from, m.to) && (await G.fileExists(m.to))) throw new Error(`${m.to} already exists, so the folder cannot be renamed. Move it away and try again.`);

  const full = await GH.renameRepo(id, name);
  const [owner, newName] = full.split('/');
  const newId = full;
  const warnings: string[] = [];
  const attempt = async (what: string, f: () => Promise<unknown>) => { try { await f(); return true; } catch (e: any) { warnings.push(`${what}: ${String(e?.message || e)}`); return false; } };

  if (await G.fileExists(repo.localPath)) {
    await attempt('Updating the origin remote', async () => {
      const url = (await G.git(repo.localPath, 'remote', 'get-url', 'origin')).trim();
      const next = renamedRemote(url, newName);
      if (next !== url) await G.git(repo.localPath, 'remote', 'set-url', 'origin', next);
    });
  }

  const done: { from: string; to: string }[] = [];
  for (const m of moves) {
    // A case-only change needs a hop through another name on case-insensitive disks.
    if (await attempt(`Renaming ${m.from}`, async () => {
      await mkdir(dirname(m.to), { recursive: true });
      if (sameFile(m.from, m.to)) { const tmp = m.from + '.helm-rename'; await rename(m.from, tmp); await rename(tmp, m.to); } else await rename(m.from, m.to);
    })) done.push(m);
  }
  const remap = (p: string) => { const m = done.find((x) => within(p, x.from)); return m ? m.to + p.slice(m.from.length) : p; };

  const newClone = remap(repo.localPath);
  const moved = new Set<string>();
  for (const s of mine) for (const p of wtPaths(s)) if (remap(p) !== p) moved.add(remap(p));
  if (done.length) {
    // The clone and its worktrees point at each other by absolute path; tell git where they went.
    await attempt('Reconnecting the worktrees', () => G.git(newClone, 'worktree', 'repair', ...moved));
    // Claude Code files a conversation under its folder's path, so follow the folder or the session cannot be resumed.
    const paths = [repo.localPath, ...mine.flatMap(wtPaths)];
    for (const p of new Set(paths)) {
      const to = remap(p);
      if (to === p) continue;
      await attempt('Moving Claude Code history', async () => {
        const [a, b] = [claudeProjectDir(p), claudeProjectDir(to)];
        if (a !== b && (await G.fileExists(a)) && !(await G.fileExists(b))) await rename(a, b);
      });
    }
  }
  await attempt('Moving uploaded files', () => renameRepoFixtures(id, newId));
  await repos.renamedCache(id, newId);

  repo.id = newId; repo.owner = owner; repo.name = newName; repo.localPath = newClone;
  for (const s of store.data.sessions) {
    if (s.repoId === id) s.repoId = newId;
    s.worktree = s.free ? s.worktree : remap(s.worktree);
    for (const e of s.extras ?? []) if (e.repoId === id) { e.repoId = newId; e.worktree = remap(e.worktree); }
  }
  const t = store.data.totals;
  if (t[id]) { t[newId] = t[id]; delete t[id]; }
  for (const u of store.data.usage) if (u.repoId === id) u.repoId = newId;
  for (const u of store.data.daily) if (u.repoId === id) u.repoId = newId;
  const seen = store.data.automationSeen;
  if (seen[id]) { seen[newId] = seen[id]; delete seen[id]; }
  for (const a of store.data.automations) if (a.scope === id) a.scope = newId;
  store.log({ kind: 'git', who: d.who(), human: true, what: `renamed the repository from ${id}`, repo: newName, ok: !warnings.length, detail: warnings.join('\n') || undefined });
  // Other machines drop the old record and pick up the new one when they sync.
  store.tombstone('repo', id);
  return { id: newId, warnings };
}
