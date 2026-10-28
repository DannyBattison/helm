import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRepoArtifact, addRepoArtifactChunk, repoArtifactProgress, listRepoArtifacts, removeRepoArtifact, setRepoArtifactDir, setRepoArtifactShared, supplyRepoArtifacts, unzipRepoArtifact, validName } from '../src/core/repoartifacts';

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

  it('reports the bytes copied and leaves no temporary file', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    await addRepoArtifact(repo, 'big.bin', Buffer.alloc(5000, 1).toString('base64'));
    let seen = 0;
    await supplyRepoArtifacts(repo, wt, true, (n) => { seen += n; });
    await removeRepoArtifact(repo, 'big.bin');
    expect(seen).toBe(5000);
    expect(existsSync(join(wt, 'big.bin'))).toBe(true);
    expect(existsSync(join(wt, 'big.bin.helm-copy'))).toBe(false);
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

  it('unpacks a zip into a folder named after it, keeping its structure and leaving out macOS junk', async () => {
    const src = mkdtempSync(join(tmpdir(), 'helm-zip-'));
    mkdirSync(join(src, 'data', 'deep'), { recursive: true });
    writeFileSync(join(src, 'data', 'deep', 'a.txt'), 'A');
    writeFileSync(join(src, 'top.txt'), 'T');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${join(src, 'my-zip.zip')}', 'w')
z.write('${join(src, 'data', 'deep', 'a.txt')}', 'data/deep/a.txt')
z.write('${join(src, 'top.txt')}', 'top.txt')
z.writestr('__MACOSX/junk', 'x')
z.close()`]);
    await addRepoArtifact(repo, 'my-zip.zip', readFileSync(join(src, 'my-zip.zip')).toString('base64'));
    expect(await unzipRepoArtifact(repo, 'my-zip.zip')).toBe('my-zip');
    const list = await listRepoArtifacts(repo);
    const dir = list.find((f) => f.name === 'my-zip')!;
    expect(dir.dir).toBe(true);
    expect(dir.size).toBe(2);
    await expect(unzipRepoArtifact(repo, 'my-zip.zip')).rejects.toThrow(/already exists/);
    await expect(unzipRepoArtifact(repo, 'notes.md')).rejects.toThrow(/zip/);
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    await supplyRepoArtifacts(repo, wt, true);
    expect(readFileSync(join(wt, 'my-zip', 'data', 'deep', 'a.txt'), 'utf8')).toBe('A');
    await removeRepoArtifact(repo, 'my-zip');
    await removeRepoArtifact(repo, 'my-zip.zip');
  });

  it('refuses a zip with an entry that climbs out of the folder', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'helm-zip-')), 'evil.zip');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${f}', 'w')
z.writestr('../escape.txt', 'x')
z.close()`]);
    await addRepoArtifact(repo, 'evil.zip', readFileSync(f).toString('base64'));
    await expect(unzipRepoArtifact(repo, 'evil.zip')).rejects.toThrow();
    expect((await listRepoArtifacts(repo)).some((x) => x.name === 'evil')).toBe(false);
    await removeRepoArtifact(repo, 'evil.zip');
  });

  it('links a shared folder into worktrees, read-only, instead of copying it', async () => {
    const src = mkdtempSync(join(tmpdir(), 'helm-zip-'));
    writeFileSync(join(src, 'f.txt'), 'F');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${join(src, 'big.zip')}', 'w')
z.write('${join(src, 'f.txt')}', 'f.txt')
z.close()`]);
    await addRepoArtifact(repo, 'big.zip', readFileSync(join(src, 'big.zip')).toString('base64'));
    await unzipRepoArtifact(repo, 'big.zip');
    await setRepoArtifactShared(repo, 'big', true);
    expect((await listRepoArtifacts(repo)).find((f) => f.name === 'big')!.shared).toBe(true);
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    let copied = 0;
    await supplyRepoArtifacts(repo, wt, true, (n) => { copied += n; });
    expect(lstatSync(join(wt, 'big')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(wt, 'big', 'f.txt'), 'utf8')).toBe('F');
    expect(statSync(join(wt, 'big', 'f.txt')).mode & 0o222).toBe(0);
    expect(sh(wt, 'status', '--porcelain')).not.toContain('big');
    await removeRepoArtifact(repo, 'big');
    await removeRepoArtifact(repo, 'big.zip');
  });
});
