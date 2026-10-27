import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRepoArtifact, addRepoArtifactChunk, repoArtifactProgress, listRepoArtifacts, removeRepoArtifact, setRepoArtifactDir, supplyRepoArtifacts, validName } from '../src/core/repoartifacts';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

describe('repo files', () => {
  setRepoArtifactDir(mkdtempSync(join(tmpdir(), 'helm-rf-')));
  const repo = 'o/r';

  it('refuses names that could leave the folder', () => {
    for (const n of ['', '..', 'a/b', 'a\\b', '.git']) expect(validName(n)).toBe(false);
    expect(validName('.env.shared')).toBe(true);
  });

  it('stores, lists and removes files', async () => {
    await addRepoArtifact(repo, 'a.txt', Buffer.from('hi').toString('base64'));
    expect((await listRepoArtifacts(repo)).map((f) => [f.name, f.size])).toEqual([['a.txt', 2]]);
    await expect(addRepoArtifact(repo, '../x', '')).rejects.toThrow();
    await removeRepoArtifact(repo, 'a.txt');
    expect(await listRepoArtifacts(repo)).toEqual([]);
  });

  it('assembles a file sent in pieces, listing it only when complete', async () => {
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    await addRepoArtifactChunk(repo, 'big.bin', 0, b64('abc'), false);
    expect((await listRepoArtifacts(repo)).map((f) => f.name)).not.toContain('big.bin');
    await expect(addRepoArtifactChunk(repo, 'big.bin', 9, b64('x'), true)).rejects.toThrow(/out of step/);
    await addRepoArtifactChunk(repo, 'big.bin', 3, b64('def'), true);
    expect((await listRepoArtifacts(repo)).find((f) => f.name === 'big.bin')?.size).toBe(6);
    await removeRepoArtifact(repo, 'big.bin');
  });

  it('reports how far an interrupted upload got, only for the same file', async () => {
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    await addRepoArtifactChunk(repo, 'r.bin', 0, b64('abcd'), false, '8:1');
    expect(await repoArtifactProgress(repo, 'r.bin', '8:1')).toBe(4);
    expect(await repoArtifactProgress(repo, 'r.bin', '8:2')).toBe(0);
    await addRepoArtifactChunk(repo, 'r.bin', 4, b64('efgh'), true, '8:1');
    expect(await repoArtifactProgress(repo, 'r.bin', '8:1')).toBe(0);
    await removeRepoArtifact(repo, 'r.bin');
  });

  it('copies into a worktree and keeps them out of git', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    writeFileSync(join(wt, 'tracked.txt'), 'mine');
    sh(wt, 'add', 'tracked.txt');
    await addRepoArtifact(repo, 'notes.md', Buffer.from('n').toString('base64'));
    await addRepoArtifact(repo, 'tracked.txt', Buffer.from('theirs').toString('base64'));
    expect((await supplyRepoArtifacts(repo, wt, true)).sort()).toEqual(['notes.md']);
    expect(readFileSync(join(wt, 'tracked.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(wt, 'notes.md'))).toBe(true);
    expect(sh(wt, 'status', '--porcelain')).not.toContain('notes.md');
    writeFileSync(join(wt, 'notes.md'), 'edited');
    expect(await supplyRepoArtifacts(repo, wt, false)).toEqual([]);
    expect(readFileSync(join(wt, 'notes.md'), 'utf8')).toBe('edited');
  });
});
