import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addWorktree, changes, commitDiff, dirtyFiles, fileDiff, imageVersions, fileExists, defaultBranch, initScratch, isGenerated, listFiles, mergeBase, parseGithubUrl, remoteSlug, removeWorktree, searchFiles, userIdentity, gitOk } from '../src/core/git';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
let root: string, repo: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-git-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  writeFileSync(join(repo, 'old.txt'), 'keep me\nline\nline2\nline3\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('github urls', () => {
  it('parses https and ssh remotes', () => {
    expect(parseGithubUrl('https://github.com/o/r.git')).toBe('o/r');
    expect(parseGithubUrl('git@github.com:o/r')).toBe('o/r');
    expect(parseGithubUrl(' https://github.com/o/r/ ')).toBe('o/r');
    expect(parseGithubUrl('https://gitlab.com/o/r')).toBeNull();
  });
  it('flags generated files', () => {
    expect(isGenerated('web/package-lock.json')).toBe(true);
    expect(isGenerated('dist/app.min.js')).toBe(true);
    expect(isGenerated('src/app.ts')).toBe(false);
  });
});

describe('repository helpers', () => {
  it('reads the remote slug and default branch', async () => {
    expect(await remoteSlug(repo)).toBeNull();
    expect(await defaultBranch(repo)).toBe('main');
    g(repo, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
    expect(await remoteSlug(repo)).toBe('o/r');
    expect(await gitOk(repo, 'status')).toBe(true);
    expect(await gitOk(repo, 'nonsense-command')).toBe(false);
    expect((await userIdentity(repo)).name === null || typeof (await userIdentity(repo)).name === 'string').toBe(true);
  });

  it('summarises changes, diffs files, searches and lists', async () => {
    const wt = join(root, 'wt');
    await addWorktree(repo, wt, 'agent/x', 'main');
    expect(await mergeBase(wt, 'main')).toMatch(/^[0-9a-f]{40}$/);
    writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\nfour\n');
    g(wt, 'commit', '-qam', 'edit a');
    g(wt, 'mv', 'old.txt', 'new.txt');
    writeFileSync(join(wt, 'fresh.txt'), 'x\ny\n');
    writeFileSync(join(wt, 'package-lock.json'), '{}\n');
    const c = await changes(wt, 'main');
    const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
    expect(by['a.txt']).toMatchObject({ add: 2, del: 1, status: 'M' });
    expect(by['new.txt'].status).toBe('R');
    expect(by['fresh.txt']).toMatchObject({ add: 2, status: 'A' });
    expect(by['package-lock.json'].generated).toBe(true);
    expect(c.commits.map((x) => x.msg)).toEqual(['edit a']);
    expect(c.dirty).toBeGreaterThan(0);

    const hunks = await fileDiff(wt, 'main', 'a.txt');
    expect(hunks[0].lines.some((l) => l[0] === '+' && l[3] === 'TWO')).toBe(true);
    const fresh = await fileDiff(wt, 'main', 'fresh.txt');
    expect(fresh[0].header).toMatch(/\+1,2/);
    expect(await fileDiff(wt, 'main', 'nothere.txt')).toEqual([]);
    writeFileSync(join(wt, 'pic.png'), Buffer.from([137, 80, 78, 71, 0]));
    expect(await imageVersions(wt, 'main', 'a.txt')).toBeNull();
    const pic = await imageVersions(wt, 'main', 'pic.png');
    expect(pic?.old).toBeNull();
    expect(pic?.new).toBe('data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 0]).toString('base64'));
    const sha = g(wt, 'rev-parse', 'HEAD').trim();
    expect((await commitDiff(wt, sha, 'a.txt'))[0].lines.length).toBeGreaterThan(0);

    const dirty = await dirtyFiles(wt);
    expect(dirty.find((d) => d.path === 'fresh.txt')?.status).toBe('A');
    expect(await listFiles(wt)).toEqual(expect.arrayContaining(['a.txt', 'fresh.txt', 'new.txt']));
    const hits = await searchFiles(wt, 'two', false);
    expect(hits.some((h) => h.path === 'a.txt' && h.line === 2)).toBe(true);
    expect(await searchFiles(wt, 'two', true)).toEqual([]);
    expect(await searchFiles(wt, '  ', true)).toEqual([]);
    expect(await fileExists(join(wt, 'a.txt'))).toBe(true);
    expect(await fileExists(join(wt, 'zzz'))).toBe(false);

    await removeWorktree(repo, wt, 'agent/x');
    expect(existsSync(wt)).toBe(false);
    expect(g(repo, 'branch', '--list', 'agent/x').trim()).toBe('');
  });

  it('makes a scratch folder and lists files without git', async () => {
    const dir = join(root, 'scratch');
    await initScratch(dir);
    writeFileSync(join(dir, 'f.txt'), 'hi');
    mkdirSync(join(dir, 'node_modules'));
    writeFileSync(join(dir, 'node_modules', 'skip.js'), '');
    expect(await listFiles(dir)).toContain('f.txt');
    const plain = join(root, 'plain');
    mkdirSync(join(plain, 'sub'), { recursive: true });
    writeFileSync(join(plain, 'sub', 'x.txt'), '');
    writeFileSync(join(plain, 'y.txt'), '');
    mkdirSync(join(plain, 'node_modules'));
    writeFileSync(join(plain, 'node_modules', 'z.js'), '');
    expect(await listFiles(plain)).toEqual(['sub/x.txt', 'y.txt']);
  });
});

describe('deleting a clone', () => {
  it('reports what would be lost and deletes the clone with its worktrees', async () => {
    const { localLoss, deleteClone } = await import('../src/core/git');
    const c = join(root, 'clone');
    mkdirSync(c);
    g(c, 'init', '-q', '-b', 'main');
    writeFileSync(join(c, 'a.txt'), 'x\n');
    g(c, 'add', '.');
    g(c, 'commit', '-q', '-m', 'init');
    writeFileSync(join(c, 'new.txt'), 'untracked\n');
    writeFileSync(join(c, 'a.txt'), 'changed\n');
    const wt = join(root, 'clone-wt');
    g(c, 'worktree', 'add', '-q', wt, '-b', 'side');
    const loss = await localLoss(c);
    expect(loss).toMatchObject({ untracked: 1, uncommitted: 1, unpushed: 1 });
    expect(loss.worktrees).toHaveLength(1);
    await deleteClone(c);
    expect(existsSync(c)).toBe(false);
    expect(existsSync(wt)).toBe(false);
    await expect(deleteClone(root)).rejects.toThrow(/not a Git clone/);
  });
});
