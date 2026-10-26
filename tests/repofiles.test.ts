import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRepoFile, listRepoFiles, removeRepoFile, setRepoFilesDir, supplyRepoFiles, validName } from '../src/core/repofiles';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

describe('repo files', () => {
  setRepoFilesDir(mkdtempSync(join(tmpdir(), 'helm-rf-')));
  const repo = 'o/r';

  it('refuses names that could leave the folder', () => {
    for (const n of ['', '..', 'a/b', 'a\\b', '.git']) expect(validName(n)).toBe(false);
    expect(validName('.env.shared')).toBe(true);
  });

  it('stores, lists and removes files', async () => {
    await addRepoFile(repo, 'a.txt', Buffer.from('hi').toString('base64'));
    expect((await listRepoFiles(repo)).map((f) => [f.name, f.size])).toEqual([['a.txt', 2]]);
    await expect(addRepoFile(repo, '../x', '')).rejects.toThrow();
    await removeRepoFile(repo, 'a.txt');
    expect(await listRepoFiles(repo)).toEqual([]);
  });

  it('copies into a worktree and keeps them out of git', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    writeFileSync(join(wt, 'tracked.txt'), 'mine');
    sh(wt, 'add', 'tracked.txt');
    await addRepoFile(repo, 'notes.md', Buffer.from('n').toString('base64'));
    await addRepoFile(repo, 'tracked.txt', Buffer.from('theirs').toString('base64'));
    expect((await supplyRepoFiles(repo, wt, true)).sort()).toEqual(['notes.md']);
    expect(readFileSync(join(wt, 'tracked.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(wt, 'notes.md'))).toBe(true);
    expect(sh(wt, 'status', '--porcelain')).not.toContain('notes.md');
    writeFileSync(join(wt, 'notes.md'), 'edited');
    expect(await supplyRepoFiles(repo, wt, false)).toEqual([]);
    expect(readFileSync(join(wt, 'notes.md'), 'utf8')).toBe('edited');
  });
});
