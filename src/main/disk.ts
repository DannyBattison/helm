import { readdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { git, gitOk } from './git';
import { run } from './util';

/** Folders that are rebuilt by installing or building, and are nearly always the bulk of a worktree. Only removed when git ignores them. */
export const HEAVY_DIRS = ['node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.turbo', '.parcel-cache', '.cache', 'coverage', 'target', '.venv', 'venv', '__pycache__', '.gradle', '.pytest_cache', '.mypy_cache'];

/** Size of a folder in bytes. `du` where there is one, a bounded walk elsewhere; `partial` when the walk ran out of time. */
export async function dirSize(path: string, budgetMs = 20_000): Promise<{ bytes: number; partial: boolean }> {
  if (process.platform !== 'win32') {
    try {
      const out = await run('du', ['-sk', path], { timeout: budgetMs });
      const kb = +out.split(/\s/)[0];
      if (Number.isFinite(kb)) return { bytes: kb * 1024, partial: false };
    } catch { /* fall through to the walk */ }
  }
  const deadline = Date.now() + budgetMs;
  let bytes = 0;
  const stack = [path];
  while (stack.length) {
    if (Date.now() > deadline) return { bytes, partial: true };
    const dir = stack.pop()!;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    await Promise.all(entries.map(async (e) => {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) return;
      if (e.isDirectory()) { stack.push(p); return; }
      try { bytes += (await lstat(p)).size; } catch { /* vanished */ }
    }));
  }
  return { bytes, partial: false };
}

/** The heavy folders at the top of a worktree that git ignores and has nothing tracked in, so removing them loses nothing that is not rebuilt. */
export async function reclaimable(wt: string): Promise<string[]> {
  const found: string[] = [];
  let names: string[];
  try { names = await readdir(wt); } catch { return found; }
  for (const name of HEAVY_DIRS.filter((d) => names.includes(d))) {
    const ignored = await gitOk(wt, 'check-ignore', '-q', '--', name + '/');
    if (!ignored) continue;
    const tracked = (await git(wt, 'ls-files', '--', name).catch(() => 'x')).trim();
    if (!tracked) found.push(name);
  }
  return found;
}

export async function reclaimableBytes(wt: string): Promise<{ dirs: string[]; bytes: number }> {
  const dirs = await reclaimable(wt);
  let bytes = 0;
  for (const d of dirs) bytes += (await dirSize(join(wt, d), 8000)).bytes;
  return { dirs, bytes };
}

/** Deletes those folders and says how much space it freed. */
export async function cleanHeavy(wt: string): Promise<{ removed: string[]; bytes: number }> {
  const { dirs, bytes } = await reclaimableBytes(wt);
  for (const d of dirs) await rm(join(wt, d), { recursive: true, force: true });
  return { removed: dirs, bytes };
}
