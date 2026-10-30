import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: () => ({}), getSessionInfo: async () => null, getSubagentMessages: async () => [], getSessionMessages: async () => [], forkSession: async () => ({ sessionId: 'f' }), renameSession: async () => undefined }));

import { SessionManager } from '../src/core/sessions';
import { Store } from '../src/core/store';
import { SyncService } from '../src/core/sync';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const root = mkdtempSync(join(tmpdir(), 'helm-take-'));
afterAll(async () => { await new Promise((r) => setTimeout(r, 800)); rmSync(root, { recursive: true, force: true }); });

const machine = async (name: string, origin: string) => {
  const clone = join(root, name, 'clone');
  mkdirSync(join(root, name), { recursive: true });
  execFileSync('git', ['clone', '-q', origin, clone]);
  const store = new Store();
  await store.load(join(root, name, 'data'));
  Object.assign(store.data.settings, { worktreeRoot: join(root, name, 'wt'), fetchBeforeSession: false });
  store.data.repos.push({ id: 'o/r', owner: 'o', name: 'r', private: false, lang: null, defaultBranch: 'main', localPath: clone, cap: 0, addedAt: 0 });
  const sm = new SessionManager(store, { emitState: vi.fn(), emitTranscript: vi.fn(), toast: vi.fn(), notify: vi.fn(), claudePath: () => '/bin/claude' } as any);
  const sync = new SyncService(store, () => ({ dataDir: join(root, name, 'data') }) as any, { isRunning: () => false, changed: () => undefined, canServe: () => false, emitTranscript: () => undefined, name: () => name, release: async () => undefined });
  return { store, sm, sync, clone };
};

describe('taking control of a synced session', () => {
  it('brings the branch and uncommitted work to a worktree of its own, and makes the session ours', async () => {
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    const seed = join(root, 'seed');
    execFileSync('git', ['clone', '-q', origin, seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'init'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');

    const a = await machine('a', origin), b = await machine('b', origin);
    const wtA = join(root, 'a', 'wt', 'r', 'job');
    g(a.clone, 'worktree', 'add', '-q', wtA, '-b', 'agent/job', 'main');
    writeFileSync(join(wtA, 'b.txt'), 'committed\n'); g(wtA, 'add', '.'); g(wtA, 'commit', '-q', '-m', 'work');
    writeFileSync(join(wtA, 'a.txt'), 'edited, not committed\n');
    writeFileSync(join(wtA, 'new.txt'), 'untracked\n');
    const rec = { id: 'job', repoId: 'o/r', status: 'idle', task: 'job', step: '', branch: 'agent/job', base: 'main', worktree: wtA, subagents: [], timeline: [], startedAt: 1, updatedAt: 1, owner: { id: a.store.data.instanceId, at: 1 } } as any;
    a.store.data.sessions.push(rec);

    // Off by default: nothing is published.
    expect(await a.sync.publish()).toBe(0);
    a.store.data.settings.syncWhat.branches = true;
    a.store.data.settings.syncWhat.worktrees = true;
    expect(await a.sync.publish()).toBe(1);

    b.store.data.sessions.push({ ...rec, worktree: join(root, 'a-path-here'), worktreeGone: true, remoteOwner: 'a', owner: { id: a.store.data.instanceId, name: 'a', at: 1 } });
    await b.sm.takeControl('job');
    const s = b.store.data.sessions[0];
    expect(s.remoteOwner).toBeUndefined();
    expect(s.owner!.id).toBe(b.store.data.instanceId);
    expect(s.worktreeGone).toBe(false);
    const text = (f: string) => readFileSync(join(s.worktree, f), 'utf8').split(String.fromCharCode(13)).join('');
    expect(text('b.txt')).toBe('committed\n');
    expect(text('a.txt')).toBe('edited, not committed\n');
    expect(existsSync(join(s.worktree, 'new.txt'))).toBe(true);
    expect(g(s.worktree, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('agent/job');
    await expect(b.sm.takeControl('job')).rejects.toThrow(/already controlled/);
  });

  it('says what to turn on when the other side never pushed the work', async () => {
    const origin = join(root, 'origin2.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
    const seed = join(root, 'seed2');
    execFileSync('git', ['clone', '-q', origin, seed]);
    writeFileSync(join(seed, 'a.txt'), 'one\n');
    g(seed, 'add', '.'); g(seed, 'commit', '-q', '-m', 'init'); g(seed, 'branch', '-M', 'main'); g(seed, 'push', '-q', 'origin', 'main');
    const b = await machine('c', origin);
    b.store.data.sessions.push({ id: 'x', repoId: 'o/r', status: 'idle', task: 'x', step: '', branch: 'agent/x', base: 'main', worktree: '/gone', worktreeGone: true, remoteOwner: 'laptop', subagents: [], timeline: [], startedAt: 1, updatedAt: 1, owner: { id: 'other', at: 1 } } as any);
    await expect(b.sm.takeControl('x')).rejects.toThrow(/Turn on Branches/);
    expect(b.store.data.sessions[0].remoteOwner).toBe('laptop');
  });
});
