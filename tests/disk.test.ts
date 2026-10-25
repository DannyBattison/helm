import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanHeavy, dirSize, reclaimable } from '../src/main/disk';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-disk-'));
  g(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\ndist/\n.env\n');
  writeFileSync(join(root, '.env'), 'SECRET=1\n');
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x'.repeat(50_000));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'a.js'), 'y'.repeat(10_000));
  // `build` is not ignored and holds a tracked file: it must never be touched.
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'keep.txt'), 'tracked');
  // `out` is not ignored either, but is untracked.
  mkdirSync(join(root, 'out'));
  writeFileSync(join(root, 'out', 'x'), 'z');
  g(root, 'add', '-A'); g(root, 'commit', '-q', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('disk', () => {
  it('measures a folder', async () => {
    const r = await dirSize(join(root, 'node_modules'));
    expect(r.bytes).toBeGreaterThanOrEqual(50_000);
    expect(r.partial).toBe(false);
  });
  it('offers only ignored folders with nothing tracked in them', async () => {
    expect((await reclaimable(root)).sort()).toEqual(['dist', 'node_modules']);
  });
  it('removes them, keeps everything else including ignored files that are not build output, and reports the bytes', async () => {
    const r = await cleanHeavy(root);
    expect(r.removed.sort()).toEqual(['dist', 'node_modules']);
    expect(r.bytes).toBeGreaterThanOrEqual(60_000);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(existsSync(join(root, '.env'))).toBe(true);
    expect(existsSync(join(root, 'build', 'keep.txt'))).toBe(true);
    expect(existsSync(join(root, 'out', 'x'))).toBe(true);
    expect(await reclaimable(root)).toEqual([]);
  });
});
