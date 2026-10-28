import { constants, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { appendFile, chmod, copyFile, lstat, mkdir, open, readdir, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import yauzl from 'yauzl';
import type { RepoArtifact } from '../shared/types';
import * as G from './git';

let root = '';
/** Where uploaded files are kept, one folder per repository. Set once the data folder is known. */
export const setRepoArtifactDir = (dir: string) => { root = dir; };

/** Uploads in progress are written here, so a half-sent file is never listed or copied into a worktree. */
const PARTIAL = '.partial';
/** What each unfinished upload is of (the file's size and date), so an interrupted one is only continued by the same file. */
const PARTIAL_META = '.partial-meta';
/** Which top-level entries are shared (linked into worktrees, read-only) instead of copied. */
const SHARED_META = '.shared.json';
const folder = (repoId: string) => join(root, repoId.replace(/[^\w.-]/g, '_'));

/** A file name is a single path segment: nothing that can leave the folder. */
export function validName(name: string): boolean {
  return !!name && name === name.trim() && name !== '.' && name !== '..' && !/[\\/\0]/.test(name) && name.length <= 200 && name !== '.git' && name !== PARTIAL && name !== PARTIAL_META && name !== SHARED_META;
}

const sharedNames = async (repoId: string): Promise<Set<string>> => {
  try { return new Set(JSON.parse(await readFile(join(folder(repoId), SHARED_META), 'utf8'))); } catch { return new Set(); }
};

/** Total size and newest change of a file or of everything in a folder. */
async function measure(path: string): Promise<{ size: number; modified: number; dir: boolean } | null> {
  const st = await lstat(path).catch(() => null);
  if (!st) return null;
  if (!st.isDirectory()) return st.isFile() ? { size: st.size, modified: st.mtimeMs, dir: false } : null;
  let size = 0, modified = st.mtimeMs;
  for (const n of await readdir(path).catch(() => [] as string[])) {
    const m = await measure(join(path, n));
    if (m) { size += m.size; modified = Math.max(modified, m.modified); }
  }
  return { size, modified, dir: true };
}

export async function listRepoArtifacts(repoId: string): Promise<RepoArtifact[]> {
  if (!root) return [];
  let names: string[];
  try { names = await readdir(folder(repoId)); } catch { return []; }
  const shared = await sharedNames(repoId);
  const out: RepoArtifact[] = [];
  for (const name of names.sort()) {
    if (!validName(name)) continue;
    const m = await measure(join(folder(repoId), name));
    if (m) out.push({ name, size: m.size, modified: m.modified, dir: m.dir || undefined, shared: shared.has(name) || undefined });
  }
  return out;
}

/** Makes a file or folder (and all in it) read-only, or writable again. */
async function setWritable(path: string, writable: boolean): Promise<void> {
  const st = await lstat(path).catch(() => null);
  if (!st || st.isSymbolicLink()) return;
  if (st.isDirectory()) {
    // A folder must be writable while its contents change, and is locked last.
    await chmod(path, 0o755).catch(() => undefined);
    for (const n of await readdir(path)) await setWritable(join(path, n), writable);
    if (!writable) await chmod(path, 0o555).catch(() => undefined);
  } else await chmod(path, writable ? 0o644 : 0o444).catch(() => undefined);
}

/**
 * Shares a file or folder: worktrees get a link to it instead of a copy (no time, no extra disk), and it is made read-only so an
 * agent cannot change what every session sees. Worktrees that already hold a copy keep it.
 */
export async function setRepoArtifactShared(repoId: string, name: string, shared: boolean): Promise<void> {
  if (!root || !validName(name)) throw new Error('That file name is not allowed.');
  const path = join(folder(repoId), name);
  if (!(await lstat(path).catch(() => null))) throw new Error('That artifact no longer exists.');
  const set = await sharedNames(repoId);
  if (shared) set.add(name); else set.delete(name);
  await writeFile(join(folder(repoId), SHARED_META), JSON.stringify([...set].sort()));
  await setWritable(path, !shared);
}

const isSymlinkMode = (attrs: number) => ((attrs >>> 16) & 0o170000) === 0o120000;

/**
 * Unpacks `<name>.zip` into a folder `<name>` beside it, keeping the zip's own folder structure. Entries that would land outside the
 * folder, links, and macOS resource folders are skipped. Returns the folder's name. The zip itself is kept.
 */
export async function unzipRepoArtifact(repoId: string, name: string): Promise<string> {
  if (!root || !validName(name)) throw new Error('That file name is not allowed.');
  if (!/\.zip$/i.test(name) || name.length <= 4) throw new Error('Only .zip files can be unpacked.');
  const out = name.slice(0, -4);
  if (!validName(out)) throw new Error('That file name is not allowed.');
  const dest = join(folder(repoId), out);
  if (await lstat(dest).catch(() => null)) throw new Error(`"${out}" already exists. Remove it first.`);
  const tmp = join(folder(repoId), PARTIAL, out + '.unzip');
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  try {
    await new Promise<void>((done, fail) => {
      yauzl.open(join(folder(repoId), name), { lazyEntries: true, autoClose: true }, (err, zip) => {
        if (err || !zip) return fail(err || new Error('Could not read the zip.'));
        zip.on('error', fail);
        zip.on('end', () => done());
        zip.on('entry', (entry: yauzl.Entry) => {
          const rel = entry.fileName.replace(/\\/g, '/');
          const target = resolve(tmp, rel);
          const skip = !rel || rel.startsWith('__MACOSX/') || isSymlinkMode(entry.externalFileAttributes) || (target !== tmp && !target.startsWith(tmp + sep));
          if (skip) return zip.readEntry();
          if (rel.endsWith('/')) return void mkdir(target, { recursive: true }).then(() => zip.readEntry(), fail);
          mkdir(dirname(target), { recursive: true }).then(() => zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(e || new Error('Could not read ' + rel));
            pipeline(stream, createWriteStream(target)).then(() => zip.readEntry(), fail);
          }), fail);
        });
        zip.readEntry();
      });
    });
    await rename(tmp, dest);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
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
  if (done) {
    await rename(part, join(folder(repoId), name));
    await rm(meta, { force: true });
    if ((await sharedNames(repoId)).has(name)) await setWritable(join(folder(repoId), name), false);
  }
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
  const path = join(folder(repoId), name);
  await setWritable(path, true); // a shared (read-only) folder cannot be deleted until it is unlocked
  await rm(path, { recursive: true, force: true });
  const shared = await sharedNames(repoId);
  if (shared.delete(name)) await writeFile(join(folder(repoId), SHARED_META), JSON.stringify([...shared].sort()));
}

/**
 * Puts the repository's uploaded files at the top of a worktree and keeps git from seeing them: the names go in the worktree's own
 * `info/exclude`, so they are never committed. A file the repository already tracks is left alone. With `overwrite` off, a file already
 * in the worktree (which the agent may have edited) is kept too. Returns the names written.
 */
/** One file copied (cloned where the filesystem allows it, so a very large one costs no extra disk), reporting bytes as it goes. */
async function copyOne(src: string, dest: string, progress?: (bytes: number) => void): Promise<void> {
  try {
    await copyFile(src, dest, constants.COPYFILE_FICLONE_FORCE);
    progress?.((await stat(dest)).size);
  } catch {
    // No cloning here: a real copy.
    let done = 0;
    const rs = createReadStream(src);
    rs.on('data', (c) => { done += c.length; progress?.(c.length); });
    await pipeline(rs, createWriteStream(dest)).catch((e) => { progress?.(-done); throw e; });
  }
  await chmod(dest, 0o644).catch(() => undefined); // a copy is the agent's own, whatever the source's mode
}

async function copyTree(src: string, dest: string, progress?: (bytes: number) => void): Promise<void> {
  const st = await lstat(src);
  if (!st.isDirectory()) return copyOne(src, dest, progress);
  await mkdir(dest, { recursive: true });
  for (const n of await readdir(src)) await copyTree(join(src, n), join(dest, n), progress);
}

export async function supplyRepoArtifacts(repoId: string, wt: string, overwrite: boolean, progress?: (bytes: number) => void): Promise<string[]> {
  const files = await listRepoArtifacts(repoId);
  if (!files.length) return [];
  const put: string[] = [];
  for (const f of files) {
    const dest = join(wt, f.name);
    try {
      if (!overwrite && (await lstat(dest).catch(() => null))) continue;
      if (await G.gitOk(wt, 'ls-files', '--error-unmatch', '--', f.name)) continue;
      const src = join(folder(repoId), f.name);
      if (f.shared) {
        // A link, not a copy: nothing to wait for and no disk used. The source is read-only.
        await rm(dest, { recursive: true, force: true });
        await symlink(src, dest, f.dir ? 'junction' : 'file');
      } else {
        // Written under a temporary name and renamed, so a copy cut short never leaves a truncated file that a later start would take for complete.
        const tmp = dest + '.helm-copy';
        await rm(tmp, { recursive: true, force: true });
        await copyTree(src, tmp, progress);
        await rm(dest, { recursive: true, force: true });
        await rename(tmp, dest);
      }
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
