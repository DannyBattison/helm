import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { forecastable, overlap, parseMergeTree, type Conflict } from '../shared/forecast';
import { hunkPatch, validHunk } from '../shared/hunks';
import type { Checkpoint, DiffHunk, Repo, Session } from '../shared/types';
import { git, gitOk } from './git';
import { run, uid } from './util';

// ---------------------------------------------------------------- checkpoints
// A checkpoint is a commit nobody sees: it holds the worktree as it was, uncommitted and untracked files included, parented on HEAD
// and kept alive by a ref under refs/helm/<session>/<n>. No branch moves and nothing is staged, so taking one cannot disturb the agent.

const HELM_IDENT = { GIT_AUTHOR_NAME: 'helm', GIT_AUTHOR_EMAIL: 'helm@localhost', GIT_COMMITTER_NAME: 'helm', GIT_COMMITTER_EMAIL: 'helm@localhost' };
const refPrefix = (id: string) => `refs/helm/${id}/`;

export async function takeCheckpoint(wt: string, sessionId: string, n: number, label: string): Promise<string> {
  const index = join(tmpdir(), `helm-index-${uid()}`);
  const env = { ...process.env, ...HELM_IDENT, GIT_INDEX_FILE: index };
  try {
    await run('git', ['read-tree', 'HEAD'], { cwd: wt, env });
    await run('git', ['add', '-A'], { cwd: wt, env, timeout: 60_000 });
    const tree = (await run('git', ['write-tree'], { cwd: wt, env })).trim();
    const commit = (await run('git', ['commit-tree', tree, '-p', 'HEAD', '-m', label], { cwd: wt, env })).trim();
    await git(wt, 'update-ref', refPrefix(sessionId) + n, commit);
    return commit;
  } finally {
    await rm(index, { force: true }).catch(() => undefined);
  }
}

export async function listCheckpoints(wt: string, sessionId: string): Promise<Checkpoint[]> {
  const out = await git(wt, 'for-each-ref', '--format=%(refname)\t%(objectname)\t%(committerdate:unix)\t%(subject)', refPrefix(sessionId)).catch(() => '');
  return out.split('\n').filter(Boolean).map((l) => {
    const [ref, commit, at, ...label] = l.split('\t');
    return { n: +ref.slice(refPrefix(sessionId).length), commit, at: +at * 1000, label: label.join('\t') };
  }).filter((c) => Number.isInteger(c.n)).sort((a, b) => a.n - b.n);
}

export async function dropCheckpoints(repoPath: string, sessionId: string): Promise<void> {
  const out = await git(repoPath, 'for-each-ref', '--format=%(refname)', refPrefix(sessionId)).catch(() => '');
  for (const ref of out.split('\n').filter(Boolean)) await git(repoPath, 'update-ref', '-d', ref).catch(() => undefined);
}

/** Makes the worktree's files match a checkpoint's, leaving them as uncommitted changes on top of HEAD (which must already be the checkpoint's parent). */
async function materialize(wt: string, commit: string): Promise<void> {
  const parent = `${commit}^`;
  const removed = (await git(wt, 'diff', '--name-only', '--diff-filter=D', '-z', parent, commit)).split('\0').filter(Boolean);
  await git(wt, 'checkout', commit, '--', '.');
  for (const f of removed) await rm(join(wt, f), { force: true, recursive: true }).catch(() => undefined);
  await git(wt, 'reset', '-q');
}

/** Puts the worktree back as it was at a checkpoint: the branch, the tracked files and the untracked ones. Call after taking a safety checkpoint. */
export async function restoreCheckpoint(wt: string, commit: string): Promise<void> {
  await git(wt, 'reset', '--hard', '-q', `${commit}^`);
  await git(wt, 'clean', '-fdq');
  await materialize(wt, commit);
}

/** Starts a fresh worktree from a checkpoint: it must have been created at the checkpoint's parent. */
export const seedFromCheckpoint = materialize;

export async function checkpointParent(repoPath: string, commit: string): Promise<string> {
  return (await git(repoPath, 'rev-parse', `${commit}^`)).trim();
}

// ---------------------------------------------------------------- hunks
/** Throws one hunk of the change away by applying it backwards to the working tree. */
export async function revertHunk(wt: string, path: string, hunk: DiffHunk): Promise<void> {
  // The hunk comes from the window: build a patch only from something shaped like a real one, so it can only touch `path`.
  if (!validHunk(hunk) || /[\n\r]/.test(path)) throw new Error('That is not a hunk of this diff.');
  const patch = hunkPatch(path, hunk);
  try {
    await run('git', ['apply', '-R', '--recount', '--whitespace=nowarn', '-'], { cwd: wt, input: patch });
  } catch (e: any) {
    throw new Error(`That hunk no longer applies cleanly (the file has changed since this diff was read). Reload the diff and try again. ${String(e?.message || '').split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------- conflict forecast
const MAX_SESSIONS = 14;

async function mergeTree(repoPath: string, a: string, b: string): Promise<{ files: string[] } | 'clean' | 'unsupported'> {
  try {
    await git(repoPath, 'merge-tree', '--write-tree', '--name-only', '--no-messages', a, b);
    return 'clean';
  } catch (e: any) {
    if (e?.code === 1) return { files: parseMergeTree(String(e.message)) };
    return 'unsupported';
  }
}

/**
 * Which live sessions of a repository would conflict if merged: each pair, and each against its base, using git's in-memory merge
 * (`merge-tree --write-tree`, git 2.38 or newer, which touches no worktree). Files that two sessions both changed but have
 * not committed yet are reported as overlaps, since git only sees commits. Older git falls back to overlaps alone.
 */
export async function forecastRepo(repo: Repo, sessions: Session[], now = Date.now()): Promise<Conflict[]> {
  const live = sessions.filter((s) => s.repoId === repo.id && forecastable(s)).slice(0, MAX_SESSIONS);
  const out: Conflict[] = [];
  let supported = true;
  const heads = new Map<string, boolean>();
  const exists = async (b: string) => heads.get(b) ?? (heads.set(b, await gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', `refs/heads/${b}`)), heads.get(b)!);
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    if (supported && a.commits.length && (await exists(a.branch))) {
      const r = await mergeTree(repo.localPath, a.branch, a.base);
      if (r === 'unsupported') supported = false;
      else if (r !== 'clean') out.push({ repoId: repo.id, a: a.id, b: a.base.startsWith('origin/') ? a.base : 'origin/' + a.base, files: r.files, kind: 'conflict', at: now });
    }
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      let files: string[] = [];
      let kind: Conflict['kind'] = 'overlap';
      if (supported && a.commits.length && b.commits.length && (await exists(a.branch)) && (await exists(b.branch))) {
        const r = await mergeTree(repo.localPath, a.branch, b.branch);
        if (r === 'unsupported') supported = false;
        else if (r !== 'clean') { files = r.files; kind = 'conflict'; }
      }
      if (!files.length) files = overlap(a, b);
      if (files.length) out.push({ repoId: repo.id, a: a.id, b: b.id, files, kind, at: now });
    }
  }
  return out;
}

export async function writeTemp(text: string): Promise<string> {
  const f = join(tmpdir(), `helm-${uid()}.txt`);
  await writeFile(f, text, 'utf8');
  return f;
}
