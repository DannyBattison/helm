import { appendFile, copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RepoFile } from '../shared/types';
import * as G from './git';

/** Largest file that can be uploaded: it travels as base64 (over a WebSocket on the hosted server). */
export const MAX_REPO_FILE = 25 * 1024 * 1024;

let root = '';
/** Where uploaded files are kept, one folder per repository. Set once the data folder is known. */
export const setRepoFilesDir = (dir: string) => { root = dir; };

const folder = (repoId: string) => join(root, repoId.replace(/[^\w.-]/g, '_'));

/** A file name is a single path segment: nothing that can leave the folder. */
export function validName(name: string): boolean {
  return !!name && name === name.trim() && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.length <= 200 && name !== '.git';
}

export async function listRepoFiles(repoId: string): Promise<RepoFile[]> {
  if (!root) return [];
  let names: string[];
  try { names = await readdir(folder(repoId)); } catch { return []; }
  const out: RepoFile[] = [];
  for (const name of names.sort()) {
    const st = await stat(join(folder(repoId), name)).catch(() => null);
    if (st?.isFile()) out.push({ name, size: st.size, modified: st.mtimeMs });
  }
  return out;
}

export async function addRepoFile(repoId: string, name: string, base64: string): Promise<void> {
  if (!root) throw new Error('Uploads are not available yet.');
  if (!validName(name)) throw new Error('That file name is not allowed.');
  const data = Buffer.from(base64, 'base64');
  if (data.length > MAX_REPO_FILE) throw new Error('That file is larger than 25 MB.');
  await mkdir(folder(repoId), { recursive: true });
  await writeFile(join(folder(repoId), name), data);
}

export async function removeRepoFile(repoId: string, name: string): Promise<void> {
  if (!root || !validName(name)) return;
  await rm(join(folder(repoId), name), { force: true });
}

/**
 * Puts the repository's uploaded files at the top of a worktree and keeps git from seeing them: the names go in the worktree's own
 * `info/exclude`, so they are never committed. A file the repository already tracks is left alone. With `overwrite` off, a file already
 * in the worktree (which the agent may have edited) is kept too. Returns the names written.
 */
export async function supplyRepoFiles(repoId: string, wt: string, overwrite: boolean): Promise<string[]> {
  const files = await listRepoFiles(repoId);
  if (!files.length) return [];
  const put: string[] = [];
  for (const f of files) {
    const dest = join(wt, f.name);
    try {
      if (!overwrite && (await stat(dest).catch(() => null))) continue;
      if (await G.gitOk(wt, 'ls-files', '--error-unmatch', '--', f.name)) continue;
      await copyFile(join(folder(repoId), f.name), dest);
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
