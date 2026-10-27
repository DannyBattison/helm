import { constants } from 'node:fs';
import { appendFile, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RepoArtifact } from '../shared/types';
import * as G from './git';

let root = '';
/** Where uploaded files are kept, one folder per repository. Set once the data folder is known. */
export const setRepoArtifactDir = (dir: string) => { root = dir; };

/** Uploads in progress are written here, so a half-sent file is never listed or copied into a worktree. */
const PARTIAL = '.partial';
/** What each unfinished upload is of (the file's size and date), so an interrupted one is only continued by the same file. */
const PARTIAL_META = '.partial-meta';
const folder = (repoId: string) => join(root, repoId.replace(/[^\w.-]/g, '_'));

/** A file name is a single path segment: nothing that can leave the folder. */
export function validName(name: string): boolean {
  return !!name && name === name.trim() && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.length <= 200 && name !== '.git' && name !== PARTIAL && name !== PARTIAL_META;
}

export async function listRepoArtifacts(repoId: string): Promise<RepoArtifact[]> {
  if (!root) return [];
  let names: string[];
  try { names = await readdir(folder(repoId)); } catch { return []; }
  const out: RepoArtifact[] = [];
  for (const name of names.sort()) {
    const st = await stat(join(folder(repoId), name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, modified: st.mtimeMs });
  }
  return out;
}

/**
 * Adds one piece of a file. A file of any size is sent in pieces (each base64 over the socket) and written in place, so nothing
 * is held in memory whole. The piece at offset 0 starts the file afresh; later ones must continue exactly where the last ended.
 * The file appears under its name only when `done` is set.
 */
export async function addRepoArtifactChunk(repoId: string, name: string, offset: number, base64: string, done: boolean, fingerprint = ''): Promise<void> {
  if (!root) throw new Error('Uploads are not available yet.');
  if (!validName(name)) throw new Error('That file name is not allowed.');
  const dir = join(folder(repoId), PARTIAL);
  const part = join(dir, name);
  await mkdir(dir, { recursive: true });
  const data = Buffer.from(base64, 'base64');
  const meta = join(folder(repoId), PARTIAL_META, name);
  if (offset === 0) {
    await rm(part, { force: true });
    await mkdir(join(meta, '..'), { recursive: true });
    await writeFile(meta, fingerprint);
  }
  else if ((await stat(part).catch(() => null))?.size !== offset) throw new Error('The upload got out of step; try again.');
  const fh = await open(part, 'a');
  try { await fh.write(data); } finally { await fh.close(); }
  if (done) { await rename(part, join(folder(repoId), name)); await rm(meta, { force: true }); }
}

/** How much of an interrupted upload of this file is already kept, so the client can carry on from there. 0 when there is none or it is of a different file. */
export async function repoArtifactProgress(repoId: string, name: string, fingerprint: string): Promise<number> {
  if (!root || !validName(name) || !fingerprint) return 0;
  const have = await readFile(join(folder(repoId), PARTIAL_META, name), 'utf8').catch(() => null);
  if (have !== fingerprint) return 0;
  return (await stat(join(folder(repoId), PARTIAL, name)).catch(() => null))?.size ?? 0;
}

export const addRepoArtifact = (repoId: string, name: string, base64: string) => addRepoArtifactChunk(repoId, name, 0, base64, true);

export async function removeRepoArtifact(repoId: string, name: string): Promise<void> {
  if (!root || !validName(name)) return;
  await rm(join(folder(repoId), name), { force: true });
}

/**
 * Puts the repository's uploaded files at the top of a worktree and keeps git from seeing them: the names go in the worktree's own
 * `info/exclude`, so they are never committed. A file the repository already tracks is left alone. With `overwrite` off, a file already
 * in the worktree (which the agent may have edited) is kept too. Returns the names written.
 */
export async function supplyRepoArtifacts(repoId: string, wt: string, overwrite: boolean): Promise<string[]> {
  const files = await listRepoArtifacts(repoId);
  if (!files.length) return [];
  const put: string[] = [];
  for (const f of files) {
    const dest = join(wt, f.name);
    try {
      if (!overwrite && (await stat(dest).catch(() => null))) continue;
      if (await G.gitOk(wt, 'ls-files', '--error-unmatch', '--', f.name)) continue;
      // A copy-on-write clone where the filesystem has them, so a very large file costs no extra disk or time per worktree.
      await copyFile(join(folder(repoId), f.name), dest, constants.COPYFILE_FICLONE);
      put.push(f.name);
    } catch { /* an unreadable file must not stop the session starting */ }
  }
  if (put.length) {
    try {
      const rel = (await G.git(wt, 'rev-parse', '--git-path', 'info/exclude')).trim();
      const file = resolve(wt, rel);
      await mkdir(join(file, '..'), { recursive: true });
      const have = new Set((await readFile(file, 'utf8').catch(() => '')).split(/\r?\n/));
      const add = put.map((n) => '/' + n.replace(/^([#!])/, '\\$1')).filter((l) => !have.has(l));
      if (add.length) await appendFile(file, (have.size && !have.has('') ? '\n' : '') + add.join('\n') + '\n', 'utf8');
    } catch { /* worst case the files show as untracked */ }
  }
  return put;
}
