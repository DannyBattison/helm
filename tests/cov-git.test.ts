import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { addWorktree, changes, clone, commitDiff, defaultBranch, dirtyFiles, fileDiff, git, imageVersions, listFiles, parseDiff, remoteSlug, removeWorktree, searchFiles, setGitToken, userIdentity } from '../src/core/git';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
let root: string, repo: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-covgit-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'trunk');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  mkdirSync(join(repo, 'dir'));
  writeFileSync(join(repo, 'dir', 'moved.txt'), 'alpha\nbeta\ngamma\ndelta\nepsilon\n');
  writeFileSync(join(repo, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0, 255]));
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(() => setGitToken(null));

describe('git environment and remotes', () => {
  it('sends the token as an extra header, appended to any existing config parameters', async () => {
    setGitToken('tok123');
    const prev = process.env.GIT_CONFIG_PARAMETERS;
    process.env.GIT_CONFIG_PARAMETERS = "'a.b=c'";
    try {
      const out = await git(repo, 'config', '--show-origin', '--list').catch(() => '');
      expect(out).toContain('http.https://github.com/.extraheader=AUTHORIZATION: basic ' + Buffer.from('x-access-token:tok123').toString('base64'));
      expect(out).toContain('a.b=c');
    } finally {
      if (prev === undefined) delete process.env.GIT_CONFIG_PARAMETERS; else process.env.GIT_CONFIG_PARAMETERS = prev;
    }
    setGitToken(null);
    expect(await git(repo, 'config', '--list')).not.toContain('extraheader');
  });

  it('clones into a folder it creates, and fails cleanly for a bad source', async () => {
    const dest = join(root, 'deep', 'er', 'clone');
    await clone(repo, dest);
    expect(await remoteSlug(dest)).toBeNull(); // origin is a local path, not GitHub
    expect(await defaultBranch(dest)).toBe('trunk');
    await expect(clone(join(root, 'missing'), join(root, 'x', 'y'))).rejects.toThrow();
  });

  it('finds the default branch from origin/main, origin/master, or falls back to HEAD', async () => {
    const mk = (name: string, branch: string) => {
      const d = join(root, name);
      mkdirSync(d);
      g(d, 'init', '-q', '-b', branch);
      writeFileSync(join(d, 'f'), 'x');
      g(d, 'add', '.'); g(d, 'commit', '-q', '-m', 'i');
      return d;
    };
    const master = mk('has-master', 'master');
    g(master, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    expect(await defaultBranch(master)).toBe('master');
    const main = mk('has-main', 'main');
    g(main, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    expect(await defaultBranch(main)).toBe('main');
    const none = mk('no-origin', 'dev');
    expect(await defaultBranch(none)).toBe('dev');
    // A symbolic origin/HEAD wins.
    g(none, 'update-ref', 'refs/remotes/origin/dev', 'HEAD');
    g(none, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev');
    expect(await defaultBranch(none)).toBe('dev');
  });

  it('reads identity, tolerating a missing one', async () => {
    const d = mkdtempSync(join(tmpdir(), 'helm-covid-'));
    try {
      g(d, 'init', '-q');
      g(d, 'config', 'user.name', 'Ann');
      const id = await userIdentity(d);
      expect(id.name).toBe('Ann');
      g(d, 'config', 'user.email', 'a@x');
      expect((await userIdentity(d)).email).toBe('a@x');
      expect(await userIdentity()).toEqual({ name: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string'), email: expect.toSatisfy((v: unknown) => v === null || typeof v === 'string') });
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('git changes and diffs', () => {
  it('reports renames, binary files, empty and unterminated new files, and an unknown base', async () => {
    const wt = join(root, 'wt', 'feat');
    await addWorktree(repo, wt, 'feat', 'trunk');
    mkdirSync(join(wt, 'sub'));
    g(wt, 'mv', 'dir/moved.txt', 'sub/moved.txt');
    writeFileSync(join(wt, 'sub', 'moved.txt'), 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n');
    g(wt, 'mv', 'a.txt', 'renamed.txt');
    writeFileSync(join(wt, 'bin.dat'), Buffer.from([9, 0, 9, 0, 1]));
    g(wt, 'add', '-A');
    g(wt, 'commit', '-q', '-m', 'move things\twith a tab');
    writeFileSync(join(wt, 'empty.txt'), '');
    writeFileSync(join(wt, 'nonl.txt'), 'a\nb');
    writeFileSync(join(wt, 'package-lock.json'), '{}\n');
    symlinkSync(join(root, 'does-not-exist'), join(wt, 'dangling'));
    const c = await changes(wt, 'trunk');
    const by = Object.fromEntries(c.files.map((f) => [f.path, f]));
    expect(by['sub/moved.txt']).toMatchObject({ add: 1, del: 0, status: 'R' });
    expect(by['renamed.txt']).toMatchObject({ status: 'R' });
    expect(by['bin.dat']).toMatchObject({ binary: true, add: 0, del: 0 });
    expect(by['empty.txt']).toMatchObject({ add: 0, status: 'A' });
    expect(by['nonl.txt'].add).toBe(2);
    expect(by['package-lock.json'].generated).toBe(true);
    expect(c.commits).toEqual([{ hash: expect.any(String), msg: 'move things\twith a tab' }]);
    expect(by['dangling']).toMatchObject({ add: 0, status: 'A' });
    expect(c.dirty).toBe(4);

    // A base that does not exist is used as given, which git then rejects.
    await expect(changes(wt, 'nope')).rejects.toThrow();

    expect((await dirtyFiles(wt)).map((d) => d.path).sort()).toEqual(['dangling', 'empty.txt', 'nonl.txt', 'package-lock.json']);
    await removeWorktree(repo, wt, 'feat');
  });

  it('diffs a tracked file, a new empty file and an unreadable one', async () => {
    const wt = join(root, 'wt', 'diffs');
    await addWorktree(repo, wt, 'diffs', 'trunk');
    writeFileSync(join(wt, 'a.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(wt, 'empty.txt'), '');
    writeFileSync(join(wt, 'fresh.txt'), 'x\ny\n');
    const tracked = await fileDiff(wt, 'trunk', 'a.txt');
    expect(tracked[0].lines.some((l) => l[0] === '+' && l[3] === 'TWO')).toBe(true);
    expect(await fileDiff(wt, 'trunk', 'empty.txt')).toEqual([]);
    expect(await fileDiff(wt, 'trunk', 'ghost.txt')).toEqual([]);
    expect((await fileDiff(wt, 'trunk', 'fresh.txt'))[0]).toMatchObject({ header: '@@ -0,0 +1,2 @@ new file' });
    // A file that is added to the index but not committed counts as tracked.
    g(wt, 'add', 'fresh.txt');
    expect((await fileDiff(wt, 'trunk', 'fresh.txt'))[0].lines).toHaveLength(2);
    // A deleted-then-staged file maps to D.
    g(wt, 'rm', '-q', '-f', 'a.txt');
    expect((await dirtyFiles(wt)).find((d) => d.path === 'a.txt')?.status).toBe('D');
    expect((await dirtyFiles(wt)).find((d) => d.path === 'fresh.txt')?.status).toBe('A');
    await removeWorktree(repo, wt, 'diffs');
  });

  it('diffs one file of a commit', async () => {
    const hunks = await commitDiff(repo, 'HEAD', 'a.txt');
    expect(hunks[0].lines.map((l) => l[0])).toEqual(['+', '+', '+']);
  });

  it('parses diffs that have no-newline markers, stray lines and several hunks', () => {
    const h = parseDiff('preamble\n@@ -1 +1 @@\n-a\n+b\n\\ No newline at end of file\n@@ -10,2 +10,2 @@\n c\n-d\n+e\n\nignored');
    expect(h).toHaveLength(2);
    expect(h[0].lines).toEqual([['-', 1, null, 'a'], ['+', null, 1, 'b']]);
    expect(h[1].lines).toEqual([[' ', 10, 10, 'c'], ['-', 11, null, 'd'], ['+', null, 11, 'e']]);
  });

  it('removes a worktree whose branch was already deleted without complaint', async () => {
    const wt = join(root, 'wt', 'gone');
    await addWorktree(repo, wt, 'gone', 'trunk');
    await removeWorktree(repo, wt);
    await removeWorktree(repo, wt, 'gone'); // nothing left to remove
  });
});

describe('git files and images', () => {
  it('lists untracked files once and walks a folder that is not a repo, skipping noise', async () => {
    writeFileSync(join(repo, 'untracked.txt'), 'u');
    const files = await listFiles(repo);
    expect(files).toContain('untracked.txt');
    expect(new Set(files).size).toBe(files.length);

    const plain = join(root, 'plain');
    mkdirSync(join(plain, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(plain, '.git'), { recursive: true });
    mkdirSync(join(plain, 'src', 'deep'), { recursive: true });
    writeFileSync(join(plain, 'node_modules', 'x', 'i.js'), '');
    writeFileSync(join(plain, '.git', 'config'), '');
    writeFileSync(join(plain, 'src', 'deep', 'b.ts'), '');
    writeFileSync(join(plain, 'a.ts'), '');
    symlinkSync(join(plain, 'src'), join(plain, 'link'));
    expect(await listFiles(plain)).toEqual(['a.ts', 'src/deep/b.ts']);
    rmSync(join(repo, 'untracked.txt'));
  });

  it('searches by case, and returns nothing for blank queries or no matches', async () => {
    expect(await searchFiles(repo, '   ', true)).toEqual([]);
    expect(await searchFiles(repo, 'nomatchanywhere', true)).toEqual([]);
    expect((await searchFiles(repo, 'ONE', false)).map((h) => h.path)).toContain('a.txt');
    expect(await searchFiles(repo, 'ONE', true)).toEqual([]);
    expect((await searchFiles(repo, 'one', true))[0]).toMatchObject({ path: 'a.txt', line: 1, text: 'one' });
  });

  it('caps search results and clips long lines', async () => {
    const d = join(root, 'big');
    mkdirSync(d);
    g(d, 'init', '-q');
    writeFileSync(join(d, 'many.txt'), Array.from({ length: 450 }, () => 'needle ' + 'x'.repeat(300)).join('\n'));
    const hits = await searchFiles(d, 'needle', true);
    expect(hits).toHaveLength(400);
    expect(hits[0].text.length).toBe(240);
  });

  it('returns image versions for changed images and null for other files', async () => {
    const wt = join(root, 'wt', 'img');
    await addWorktree(repo, wt, 'img', 'trunk');
    expect(await imageVersions(wt, 'trunk', 'a.txt')).toBeNull();
    expect(await imageVersions(wt, 'trunk', 'noext')).toBeNull();
    writeFileSync(join(wt, 'p.PNG'), Buffer.from([1, 2, 3]));
    const added = await imageVersions(wt, 'trunk', 'p.PNG');
    expect(added).toEqual({ old: null, new: 'data:image/png;base64,' + Buffer.from([1, 2, 3]).toString('base64') });
    g(wt, 'add', '.'); g(wt, 'commit', '-q', '-m', 'img');
    writeFileSync(join(wt, 'p.PNG'), Buffer.alloc(8 * 1024 * 1024 + 1));
    const big = await imageVersions(wt, 'trunk', 'p.PNG');
    expect(big).toEqual({ old: null, new: null });
    g(wt, 'add', '.'); g(wt, 'commit', '-q', '-m', 'big');
    writeFileSync(join(wt, 'p.PNG'), Buffer.from([7]));
    const after = await imageVersions(wt, 'feat-missing-base', 'p.PNG');
    expect(after).toEqual({ old: null, new: 'data:image/png;base64,Bw==' });
    const modified = await imageVersions(wt, 'HEAD~1', 'p.PNG');
    expect(modified).toEqual({ old: 'data:image/png;base64,AQID', new: 'data:image/png;base64,Bw==' });
    await removeWorktree(repo, wt, 'img');
  });
});
