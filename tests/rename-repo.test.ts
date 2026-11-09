import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/core/github', () => ({ renameRepo: vi.fn(async (slug: string, name: string) => slug.split('/')[0] + '/' + name) }));
import * as GH from '../src/core/github';
import { renamedRemote, renameRepository } from '../src/core/renameRepo';
import { RepoService } from '../src/core/repos';
import { validRepoName } from '../src/shared/repoName';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
let root: string, clone: string, wt: string;
const store: any = { data: null, save: vi.fn(), log: vi.fn(), tombstone: vi.fn() };
let live: any[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-rn-'));
  clone = join(root, 'clones', 'o', 'old');
  mkdirSync(clone, { recursive: true });
  g(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'a.txt'), 'x');
  g(clone, 'add', '.');
  g(clone, 'commit', '-q', '-m', 'init');
  g(clone, 'remote', 'add', 'origin', 'https://github.com/o/old.git');
  wt = join(root, 'worktrees', 'old', 's1');
  mkdirSync(join(root, 'worktrees', 'old'), { recursive: true });
  g(clone, 'worktree', 'add', wt, '-b', 'helm/s1');
  store.data = {
    repos: [{ id: 'o/old', owner: 'o', name: 'old', localPath: clone }],
    sessions: [{ id: 's1', repoId: 'o/old', worktree: wt, status: 'ready' }, { id: 'f', repoId: '', free: { managed: true }, worktree: join(root, 'free') }],
    totals: { 'o/old': { cost: 1 } }, usage: [{ repoId: 'o/old' }], daily: [{ repoId: 'o/old' }], automationSeen: { 'o/old': {} },
    automations: [{ scope: 'o/old' }, { scope: 'global' }]
  };
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('renaming a repository', () => {
  it('validates names and rewrites remotes', () => {
    expect(validRepoName('good-name_1.x')).toBeNull();
    for (const n of ['', 'a b', 'a/b', '..', 'x.git']) expect(validRepoName(n)).not.toBeNull();
    expect(renamedRemote('https://github.com/o/old.git', 'new')).toBe('https://github.com/o/new.git');
    expect(renamedRemote('git@github.com:o/old', 'new')).toBe('git@github.com:o/new');
  });

  it('refuses while an agent is running, touching nothing', async () => {
    const repos = new RepoService(store, () => undefined);
    live = [{ id: 's1' }];
    await expect(renameRepository({ store, repos, live: () => live, who: () => 'me' }, 'o/old', 'new')).rejects.toThrow(/running agent/);
    expect(GH.renameRepo).not.toHaveBeenCalled();
    expect(store.data.repos[0].id).toBe('o/old');
  });

  it('renames on GitHub, moves folders, repairs worktrees and rekeys records', async () => {
    const repos = new RepoService(store, () => undefined);
    live = [];
    const r = await renameRepository({ store, repos, live: () => live, who: () => 'me' }, 'o/old', 'new');
    expect(r).toEqual({ id: 'o/new', warnings: [] });
    expect(GH.renameRepo).toHaveBeenCalledWith('o/old', 'new');
    const nc = join(root, 'clones', 'o', 'new'), nw = join(root, 'worktrees', 'new', 's1');
    expect(existsSync(clone)).toBe(false);
    expect(existsSync(join(root, 'worktrees', 'old'))).toBe(false);
    expect(g(nc, 'remote', 'get-url', 'origin').trim()).toBe('https://github.com/o/new.git');
    expect(g(nw, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('helm/s1');
    expect(readFileSync(join(nc, '.git', 'worktrees', 's1', 'gitdir'), 'utf8').trim()).toBe(join(nw, '.git'));
    expect(g(nc, 'worktree', 'list', '--porcelain')).toContain(nw);
    expect(store.data.repos[0]).toMatchObject({ id: 'o/new', name: 'new', localPath: nc });
    expect(store.data.sessions[0]).toMatchObject({ repoId: 'o/new', worktree: nw });
    expect(store.data.sessions[1].worktree).toBe(join(root, 'free'));
    expect(Object.keys(store.data.totals)).toEqual(['o/new']);
    expect(store.data.usage[0].repoId).toBe('o/new');
    expect(store.data.daily[0].repoId).toBe('o/new');
    expect(Object.keys(store.data.automationSeen)).toEqual(['o/new']);
    expect(store.data.automations.map((a: any) => a.scope)).toEqual(['o/new', 'global']);
    expect(store.tombstone).toHaveBeenCalledWith('repo', 'o/old');
  });
});
