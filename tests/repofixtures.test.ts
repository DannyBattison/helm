import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addRepoFixture, addRepoFixtureChunk, repoFixtureProgress, listRepoFixtureFolder, listRepoFixtures, removeRepoFixture, setRepoFixtureDir, setRepoFixtureShared, supplyRepoFixtures, unzipRepoFixture, validName } from '../src/core/repofixtures';

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' });

describe('repo files', () => {
  setRepoFixtureDir(mkdtempSync(join(tmpdir(), 'helm-rf-')));
  const repo = 'o/r';

  it('refuses names that could leave the folder', () => {
    for (const n of ['', '..', 'a/b', 'a\\b', '.git']) expect(validName(n)).toBe(false);
    expect(validName('.env.shared')).toBe(true);
  });

  it('stores, lists and removes files', async () => {
    await addRepoFixture(repo, 'a.txt', Buffer.from('hi').toString('base64'));
    expect((await listRepoFixtures(repo)).map((f) => [f.name, f.size])).toEqual([['a.txt', 2]]);
    await expect(addRepoFixture(repo, '../x', '')).rejects.toThrow();
    await removeRepoFixture(repo, 'a.txt');
    expect(await listRepoFixtures(repo)).toEqual([]);
  });

  it('assembles a file sent in pieces, listing it only when complete', async () => {
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    await addRepoFixtureChunk(repo, 'big.bin', 0, b64('abc'), false);
    expect((await listRepoFixtures(repo)).map((f) => f.name)).not.toContain('big.bin');
    await expect(addRepoFixtureChunk(repo, 'big.bin', 9, b64('x'), true)).rejects.toThrow(/out of step/);
    await addRepoFixtureChunk(repo, 'big.bin', 3, b64('def'), true);
    expect((await listRepoFixtures(repo)).find((f) => f.name === 'big.bin')?.size).toBe(6);
    await removeRepoFixture(repo, 'big.bin');
  });

  it('reports how far an interrupted upload got, only for the same file', async () => {
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    await addRepoFixtureChunk(repo, 'r.bin', 0, b64('abcd'), false, '8:1');
    expect(await repoFixtureProgress(repo, 'r.bin', '8:1')).toBe(4);
    expect(await repoFixtureProgress(repo, 'r.bin', '8:2')).toBe(0);
    await addRepoFixtureChunk(repo, 'r.bin', 4, b64('efgh'), true, '8:1');
    expect(await repoFixtureProgress(repo, 'r.bin', '8:1')).toBe(0);
    await removeRepoFixture(repo, 'r.bin');
  });

  it('reports the bytes copied and leaves no temporary file', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    await addRepoFixture(repo, 'big.bin', Buffer.alloc(5000, 1).toString('base64'));
    let seen = 0;
    await supplyRepoFixtures(repo, wt, true, (n) => { seen += n; });
    await removeRepoFixture(repo, 'big.bin');
    expect(seen).toBe(5000);
    expect(existsSync(join(wt, 'big.bin'))).toBe(true);
    expect(existsSync(join(wt, 'big.bin.helm-copy'))).toBe(false);
  });

  it('copies into a worktree and keeps them out of git', async () => {
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    writeFileSync(join(wt, 'tracked.txt'), 'mine');
    sh(wt, 'add', 'tracked.txt');
    await addRepoFixture(repo, 'notes.md', Buffer.from('n').toString('base64'));
    await addRepoFixture(repo, 'tracked.txt', Buffer.from('theirs').toString('base64'));
    expect((await supplyRepoFixtures(repo, wt, true)).sort()).toEqual(['notes.md']);
    expect(readFileSync(join(wt, 'tracked.txt'), 'utf8')).toBe('mine');
    expect(existsSync(join(wt, 'notes.md'))).toBe(true);
    expect(sh(wt, 'status', '--porcelain')).not.toContain('notes.md');
    writeFileSync(join(wt, 'notes.md'), 'edited');
    expect(await supplyRepoFixtures(repo, wt, false)).toEqual([]);
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
    await addRepoFixture(repo, 'my-zip.zip', readFileSync(join(src, 'my-zip.zip')).toString('base64'));
    expect(await unzipRepoFixture(repo, 'my-zip.zip')).toBe('my-zip');
    const list = await listRepoFixtures(repo);
    const dir = list.find((f) => f.name === 'my-zip')!;
    expect(dir.dir).toBe(true);
    expect(dir.size).toBe(2);
    await expect(unzipRepoFixture(repo, 'my-zip.zip')).rejects.toThrow(/already exists/);
    await expect(unzipRepoFixture(repo, 'notes.md')).rejects.toThrow(/zip/);
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    await supplyRepoFixtures(repo, wt, true);
    expect(readFileSync(join(wt, 'my-zip', 'data', 'deep', 'a.txt'), 'utf8')).toBe('A');
    await removeRepoFixture(repo, 'my-zip');
    await removeRepoFixture(repo, 'my-zip.zip');
  });

  it('refuses a zip with an entry that climbs out of the folder', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'helm-zip-')), 'evil.zip');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${f}', 'w')
z.writestr('../escape.txt', 'x')
z.close()`]);
    await addRepoFixture(repo, 'evil.zip', readFileSync(f).toString('base64'));
    await expect(unzipRepoFixture(repo, 'evil.zip')).rejects.toThrow();
    expect((await listRepoFixtures(repo)).some((x) => x.name === 'evil')).toBe(false);
    await removeRepoFixture(repo, 'evil.zip');
  });

  it('links a shared folder into worktrees, read-only, instead of copying it', async () => {
    const src = mkdtempSync(join(tmpdir(), 'helm-zip-'));
    writeFileSync(join(src, 'f.txt'), 'F');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${join(src, 'big.zip')}', 'w')
z.write('${join(src, 'f.txt')}', 'f.txt')
z.close()`]);
    await addRepoFixture(repo, 'big.zip', readFileSync(join(src, 'big.zip')).toString('base64'));
    await unzipRepoFixture(repo, 'big.zip');
    await setRepoFixtureShared(repo, 'big', true);
    expect((await listRepoFixtures(repo)).find((f) => f.name === 'big')!.shared).toBe(true);
    const wt = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(wt, 'init', '-q');
    let copied = 0;
    await supplyRepoFixtures(repo, wt, true, (n) => { copied += n; });
    expect(lstatSync(join(wt, 'big')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(wt, 'big', 'f.txt'), 'utf8')).toBe('F');
    expect(statSync(join(wt, 'big', 'f.txt')).mode & 0o222).toBe(0);
    expect(sh(wt, 'status', '--porcelain')).not.toContain('big');
    await removeRepoFixture(repo, 'big');
    await removeRepoFixture(repo, 'big.zip');
  });

  it('removing a fixture also clears it from worktrees, and lists a folder one level at a time', async () => {
    const src = mkdtempSync(join(tmpdir(), 'helm-zip-'));
    mkdirSync(join(src, 'd'));
    writeFileSync(join(src, 'd', 'f.txt'), 'F');
    execFileSync('python3', ['-c', `
import zipfile
z = zipfile.ZipFile('${join(src, 'tree.zip')}', 'w')
z.write('${join(src, 'd', 'f.txt')}', 'd/f.txt')
z.close()`]);
    await addRepoFixture(repo, 'tree.zip', readFileSync(join(src, 'tree.zip')).toString('base64'));
    await unzipRepoFixture(repo, 'tree.zip');
    expect((await listRepoFixtureFolder(repo, 'tree')).map((f) => [f.name, !!f.dir])).toEqual([['d', true]]);
    expect((await listRepoFixtureFolder(repo, 'tree/d')).map((f) => f.name)).toEqual(['f.txt']);
    expect(await listRepoFixtureFolder(repo, 'tree/../..')).toEqual([]);
    await setRepoFixtureShared(repo, 'tree', true);
    const copy = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    const link = mkdtempSync(join(tmpdir(), 'helm-wt-'));
    sh(copy, 'init', '-q'); sh(link, 'init', '-q');
    await supplyRepoFixtures(repo, link, true);
    await setRepoFixtureShared(repo, 'tree', false);
    await supplyRepoFixtures(repo, copy, true);
    await removeRepoFixture(repo, 'tree', [copy, link]);
    expect(existsSync(join(copy, 'tree'))).toBe(false);
    expect(() => lstatSync(join(link, 'tree'))).toThrow();
    expect((await listRepoFixtures(repo)).some((f) => f.name === 'tree')).toBe(false);
    await removeRepoFixture(repo, 'tree.zip');
  });
});
