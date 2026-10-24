import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseDiff } from '../src/main/git';
import { checkpointParent, dropCheckpoints, forecastRepo, listCheckpoints, restoreCheckpoint, revertHunk, seedFromCheckpoint, takeCheckpoint } from '../src/main/review';
import type { Repo, Session } from '../src/shared/types';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
let root: string, repo: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-test-'));
  repo = join(root, 'repo');
  mkdirSync(repo);
  g(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
  writeFileSync(join(repo, 'b.txt'), 'bee\n');
  g(repo, 'add', '.');
  g(repo, 'commit', '-q', '-m', 'init');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function worktree(name: string): string {
  const wt = join(root, name);
  g(repo, 'worktree', 'add', '-q', wt, '-b', 'agent/' + name, 'main');
  return wt;
}

describe('checkpoints', () => {
  it('captures uncommitted and untracked files without touching the worktree, branch or index', async () => {
    const wt = worktree('cp1');
    writeFileSync(join(wt, 'a.txt'), 'changed\n');
    writeFileSync(join(wt, 'new.txt'), 'brand new\n');
    const before = g(wt, 'status', '--porcelain');
    await takeCheckpoint(wt, 'cp1', 1, 'Before: first');
    expect(g(wt, 'status', '--porcelain')).toBe(before);
    expect(g(wt, 'rev-parse', 'HEAD')).toBe(g(repo, 'rev-parse', 'main'));
    const list = await listCheckpoints(wt, 'cp1');
    expect(list.map((c) => c.n)).toEqual([1]);
    expect(list[0].label).toBe('Before: first');
    expect(g(wt, 'show', `${list[0].commit}:new.txt`)).toBe('brand new\n');
  });

  it('restores files, deletions, untracked files and the branch, and a safety checkpoint can undo the restore', async () => {
    const wt = worktree('cp2');
    writeFileSync(join(wt, 'a.txt'), 'edited\n');
    writeFileSync(join(wt, 'keep.txt'), 'keep\n');
    rmSync(join(wt, 'b.txt'));
    await takeCheckpoint(wt, 'cp2', 1, 'one');
    const cp1 = (await listCheckpoints(wt, 'cp2'))[0];
    // the agent carries on: commits, edits more, adds and removes files
    g(wt, 'add', '-A'); g(wt, 'commit', '-q', '-m', 'work');
    writeFileSync(join(wt, 'a.txt'), 'edited again\n');
    writeFileSync(join(wt, 'later.txt'), 'later\n');
    g(wt, 'checkout', 'main', '--', 'b.txt');
    await takeCheckpoint(wt, 'cp2', 2, 'safety');
    const safety = (await listCheckpoints(wt, 'cp2'))[1];

    await restoreCheckpoint(wt, cp1.commit);
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('edited\n');
    expect(readFileSync(join(wt, 'keep.txt'), 'utf8')).toBe('keep\n');
    expect(existsSync(join(wt, 'b.txt'))).toBe(false);
    expect(existsSync(join(wt, 'later.txt'))).toBe(false);
    expect(g(wt, 'rev-parse', 'HEAD')).toBe(g(repo, 'rev-parse', 'main'));
    expect(g(wt, 'diff', '--cached', '--name-only')).toBe('');

    // undo the restore
    await restoreCheckpoint(wt, safety.commit);
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('edited again\n');
    expect(readFileSync(join(wt, 'later.txt'), 'utf8')).toBe('later\n');
    expect(g(wt, 'log', '--format=%s', '-1')).toBe('work\n');
  });

  it('seeds a fresh worktree from a checkpoint and drops refs', async () => {
    const wt = worktree('cp3');
    writeFileSync(join(wt, 'x.txt'), 'x\n');
    await takeCheckpoint(wt, 'cp3', 1, 'one');
    const cp = (await listCheckpoints(wt, 'cp3'))[0];
    const fork = join(root, 'fork');
    g(repo, 'worktree', 'add', '-q', fork, '-b', 'agent/fork', await checkpointParent(repo, cp.commit));
    await seedFromCheckpoint(fork, cp.commit);
    expect(readFileSync(join(fork, 'x.txt'), 'utf8')).toBe('x\n');
    await dropCheckpoints(repo, 'cp3');
    expect(await listCheckpoints(wt, 'cp3')).toEqual([]);
  });
});

describe('reverting a hunk', () => {
  it('throws away one hunk and keeps the other', async () => {
    const wt = worktree('hunk1');
    writeFileSync(join(wt, 'a.txt'), 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n');
    const hunks = parseDiff(g(wt, 'diff', '-U1', 'main', '--', 'a.txt'));
    expect(hunks).toHaveLength(2);
    await revertHunk(wt, 'a.txt', hunks[0]);
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nTEN\n');
  });

  it('removes a file that the change added, and restores one it deleted', async () => {
    const wt = worktree('hunk2');
    writeFileSync(join(wt, 'added.txt'), 'hello\n');
    g(wt, 'add', 'added.txt'); g(wt, 'commit', '-q', '-m', 'add');
    rmSync(join(wt, 'b.txt'));
    const added = parseDiff(g(wt, 'diff', 'main', '--', 'added.txt'));
    await revertHunk(wt, 'added.txt', added[0]);
    expect(existsSync(join(wt, 'added.txt'))).toBe(false);
    const gone = parseDiff(g(wt, 'diff', 'main', '--', 'b.txt'));
    await revertHunk(wt, 'b.txt', gone[0]);
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('bee\n');
  });

  it('says so when the file has moved on', async () => {
    const wt = worktree('hunk3');
    writeFileSync(join(wt, 'a.txt'), 'ONE\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n');
    const hunks = parseDiff(g(wt, 'diff', '-U1', 'main', '--', 'a.txt'));
    writeFileSync(join(wt, 'a.txt'), 'totally different\n');
    await expect(revertHunk(wt, 'a.txt', hunks[0])).rejects.toThrow(/no longer applies/);
  });
});

describe('conflict forecast', () => {
  const mk = (id: string, over: Partial<Session> = {}): Session => ({
    id, repoId: 'o/r', status: 'working', task: id, step: '', branch: 'agent/' + id, base: 'main', worktree: '', model: 'sonnet', permMode: 'ask', startedAt: 0,
    tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 0, budget: 0, ctx: 0, add: 0, del: 0, files: 1, filesTouched: {}, timeline: [], commits: [{ hash: 'x', at: 0 }],
    removeAfterMerge: true, lastAccess: 0, subagents: [], ...over
  });
  const r: Repo = { id: 'o/r', owner: 'o', name: 'r', private: false, lang: null, defaultBranch: 'main', localPath: '', cap: 0, addedAt: 0 };

  it('finds two branches that edit the same lines, and passes ones that do not', async () => {
    const a = worktree('fa'), b = worktree('fb'), c = worktree('fc');
    writeFileSync(join(a, 'b.txt'), 'from a\n'); g(a, 'commit', '-q', '-am', 'a');
    writeFileSync(join(b, 'b.txt'), 'from b\n'); g(b, 'commit', '-q', '-am', 'b');
    writeFileSync(join(c, 'a.txt'), 'only c\nTWO\n'); g(c, 'commit', '-q', '-am', 'c');
    const sessions = [mk('fa'), mk('fb'), mk('fc')];
    const found = await forecastRepo({ ...r, localPath: repo }, sessions);
    const pair = found.find((x) => x.a === 'fa' && x.b === 'fb');
    expect(pair).toMatchObject({ kind: 'conflict', files: ['b.txt'] });
    expect(found.filter((x) => x.b === 'fc' || x.a === 'fc')).toEqual([]);
  });

  it('reports an overlap for uncommitted edits to the same file', async () => {
    const found = await forecastRepo({ ...r, localPath: repo }, [
      mk('ua', { commits: [], filesTouched: { 'z.ts': { add: 1, del: 0 } } }),
      mk('ub', { commits: [], filesTouched: { 'z.ts': { add: 2, del: 0 } } })
    ]);
    expect(found).toEqual([expect.objectContaining({ a: 'ua', b: 'ub', kind: 'overlap', files: ['z.ts'] })]);
  });

  it('flags a session whose branch conflicts with a base that has moved', async () => {
    const d = worktree('fd');
    writeFileSync(join(d, 'a.txt'), 'D changes line one\n'); g(d, 'commit', '-q', '-am', 'd');
    writeFileSync(join(repo, 'a.txt'), 'main changes line one\n'); g(repo, 'commit', '-q', '-am', 'main moves');
    const found = await forecastRepo({ ...r, localPath: repo }, [mk('fd')]);
    expect(found).toEqual([expect.objectContaining({ a: 'fd', b: 'origin/main', kind: 'conflict', files: ['a.txt'] })]);
  });
});

describe('reverting a forged hunk', () => {
  it('refuses a header that smuggles in another file', async () => {
    const wt = worktree('forged');
    await expect(revertHunk(wt, 'a.txt', { header: '@@ -1 +1 @@\ndiff --git a/b.txt b/b.txt', lines: [['-', 1, null, 'bee']] })).rejects.toThrow(/not a hunk/);
  });
});

import { changes, initScratch, listFiles } from '../src/main/git';
import { FREE_ID, freeRepo, isFreeRepo, repoLabel } from '../src/shared/types';

describe('free agents', () => {
  it('make a scratch folder with git and an empty first commit, where changes and checkpoints work', async () => {
    const dir = join(root, 'scratch');
    await initScratch(dir);
    expect(g(dir, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(g(dir, 'log', '--format=%s').trim()).toBe('helm: start of free agent');
    writeFileSync(join(dir, 'notes.md'), 'hello\nworld\n');
    const c = await changes(dir, 'main');
    expect(c.files).toEqual([expect.objectContaining({ path: 'notes.md', add: 2, status: 'A' })]);
    await takeCheckpoint(dir, 'free1', 1, 'Before: write notes');
    writeFileSync(join(dir, 'notes.md'), 'changed\n');
    const cp = (await listCheckpoints(dir, 'free1'))[0];
    await restoreCheckpoint(dir, cp.commit);
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('hello\nworld\n');
  });
  it('can list the files of a folder that is not a git repository', async () => {
    const dir = join(root, 'plain');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), '1');
    writeFileSync(join(dir, 'sub', 'b.txt'), '2');
    writeFileSync(join(dir, 'node_modules', 'x', 'c.js'), '3');
    expect(await listFiles(dir)).toEqual(['a.txt', 'sub/b.txt']);
  });
  it('have a stand-in repository for code that wants one', () => {
    expect(isFreeRepo(FREE_ID)).toBe(true);
    expect(isFreeRepo('acme/shop')).toBe(false);
    expect(repoLabel(FREE_ID)).toBe('Free agents');
    expect(repoLabel('acme/shop')).toBe('acme/shop');
    expect(freeRepo('/x')).toMatchObject({ id: FREE_ID, localPath: '/x', cap: 0 });
  });
});
