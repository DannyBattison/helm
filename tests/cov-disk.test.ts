import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ run: vi.fn(), gitOk: vi.fn(), git: vi.fn() }));
vi.mock('../src/core/util', async (orig) => ({ ...(await orig<any>()), run: (...a: any[]) => h.run(...a) }));
vi.mock('../src/core/git', async (orig) => ({ ...(await orig<any>()), git: (...a: any[]) => h.git(...a), gitOk: (...a: any[]) => h.gitOk(...a) }));

import { cleanHeavy, dirSize, reclaimable, reclaimableBytes } from '../src/core/disk';

let dir: string;
const platform = process.platform;
const setPlatform = (p: string) => Object.defineProperty(process, 'platform', { value: p });
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'helm-cov-disk-'));
  h.run.mockReset(); h.git.mockReset(); h.gitOk.mockReset();
});
afterEach(() => { setPlatform(platform); vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

describe('dirSize', () => {
  it('reads du output in kilobytes', async () => {
    h.run.mockResolvedValue('12\t/x\n');
    expect(await dirSize(dir)).toEqual({ bytes: 12 * 1024, partial: false });
    expect(h.run.mock.calls[0][1]).toEqual(['-sk', dir]);
  });
  it('walks the folder when du fails or prints nonsense, counting files and skipping symlinks', async () => {
    mkdirSync(join(dir, 'a', 'b'), { recursive: true });
    writeFileSync(join(dir, 'f1'), '12345');
    writeFileSync(join(dir, 'a', 'b', 'f2'), '123');
    symlinkSync(join(dir, 'f1'), join(dir, 'link'));
    h.run.mockRejectedValueOnce(new Error('no du'));
    expect(await dirSize(dir)).toEqual({ bytes: 8, partial: false });
    h.run.mockResolvedValueOnce('oops');
    expect(await dirSize(dir)).toEqual({ bytes: 8, partial: false });
  });
  it('walks on Windows without calling du, and counts nothing for an unreadable folder', async () => {
    setPlatform('win32');
    expect(await dirSize(join(dir, 'missing'))).toEqual({ bytes: 0, partial: false });
    expect(h.run).not.toHaveBeenCalled();
  });
  it('reports a partial size when the time budget runs out', async () => {
    setPlatform('win32');
    writeFileSync(join(dir, 'f'), 'x');
    expect(await dirSize(dir, -1)).toEqual({ bytes: 0, partial: true });
  });
});

describe('reclaimable', () => {
  it('is empty when the folder cannot be read', async () => {
    expect(await reclaimable(join(dir, 'nope'))).toEqual([]);
  });
  it('lists only heavy folders that git ignores and tracks nothing in', async () => {
    for (const d of ['node_modules', 'dist', 'build', 'src', 'out']) mkdirSync(join(dir, d));
    h.gitOk.mockImplementation(async (_wt: string, ...a: string[]) => a[a.length - 1] !== 'out/');
    h.git.mockImplementation(async (_wt: string, ...a: string[]) => (a[a.length - 1] === 'build' ? 'build/keep.txt\n' : a[a.length - 1] === 'dist' ? Promise.reject(new Error('git')) : ''));
    // `dist` errors in ls-files, which is treated as "something tracked"; `out` is not ignored; `src` is not heavy.
    expect(await reclaimable(dir)).toEqual(['node_modules']);
  });
});

describe('reclaimableBytes and cleanHeavy', () => {
  it('adds up the folders found, and removes them', async () => {
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, 'coverage'));
    writeFileSync(join(dir, 'keep.txt'), 'k');
    h.gitOk.mockResolvedValue(true);
    h.git.mockResolvedValue('');
    h.run.mockResolvedValue('4\tx');
    expect(await reclaimableBytes(dir)).toEqual({ dirs: ['node_modules', 'coverage'], bytes: 8192 });
    expect(await cleanHeavy(dir)).toEqual({ removed: ['node_modules', 'coverage'], bytes: 8192 });
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
    expect(existsSync(join(dir, 'coverage'))).toBe(false);
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true);
  });
  it('removes nothing when nothing qualifies', async () => {
    expect(await cleanHeavy(dir)).toEqual({ removed: [], bytes: 0 });
  });
});
