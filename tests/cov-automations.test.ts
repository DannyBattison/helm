import { describe, expect, it } from 'vitest';
import { applies, automationTask, describeTrigger, freshCommits, freshNumbers, lastSlot, onBranch, runOutcome, scheduleDue, validateAgent, type AutomatedAgent } from '../src/shared/automations';
import { Automations, type AutomationDeps } from '../src/core/automations';
import { Store } from '../src/core/store';

const at = (s: string) => new Date(s).getTime();

describe('automation helpers', () => {
  it('describes triggers, falling back for a malformed time or day', () => {
    expect(describeTrigger({ type: 'schedule', every: 'hour', time: '', day: 0 })).toBe('Every hour');
    expect(describeTrigger({ type: 'schedule', every: 'day', time: 'soon', day: 0 })).toBe('Every day at 09:00');
    expect(describeTrigger({ type: 'schedule', every: 'day', time: '99:99', day: 0 })).toBe('Every day at 23:59');
    expect(describeTrigger({ type: 'schedule', every: 'weekday', time: '7:05', day: 0 })).toBe('Weekdays at 07:05');
    expect(describeTrigger({ type: 'schedule', every: 'week', time: '18:30', day: 5 })).toBe('Fridays at 18:30');
    expect(describeTrigger({ type: 'schedule', every: 'week', time: '18:30', day: 9 })).toBe('Mondays at 18:30');
    expect(describeTrigger({ type: 'commit' })).toBe('When commits are pushed to a branch');
  });

  it('finds the latest slot for each cadence', () => {
    const now = at('2026-10-28T10:30:00'); // a Wednesday
    expect(lastSlot({ type: 'schedule', every: 'hour', time: '', day: 0 }, now)).toBe(at('2026-10-28T10:00:00'));
    expect(lastSlot({ type: 'schedule', every: 'day', time: '11:00', day: 0 }, now)).toBe(at('2026-10-27T11:00:00'));
    expect(lastSlot({ type: 'schedule', every: 'day', time: '10:00', day: 0 }, now)).toBe(at('2026-10-28T10:00:00'));
    // On a Sunday morning the last weekday slot was Friday.
    expect(lastSlot({ type: 'schedule', every: 'weekday', time: '09:00', day: 0 }, at('2026-11-01T08:00:00'))).toBe(at('2026-10-30T09:00:00'));
    expect(lastSlot({ type: 'schedule', every: 'week', time: '09:00', day: 1 }, now)).toBe(at('2026-10-26T09:00:00'));
    expect(lastSlot({ type: 'schedule', every: 'week', time: '12:00', day: 3 }, now)).toBe(at('2026-10-21T12:00:00'));
  });

  it('is never due for event triggers, and uses createdAt when it has never run', () => {
    const now = at('2026-10-28T10:30:00');
    const sch = { type: 'schedule', every: 'hour', time: '', day: 0 } as const;
    expect(scheduleDue({ trigger: { type: 'issue' }, createdAt: 0 }, now)).toBe(false);
    expect(scheduleDue({ trigger: sch, createdAt: at('2026-10-28T09:30:00') }, now)).toBe(true);
    expect(scheduleDue({ trigger: sch, createdAt: at('2026-10-28T10:10:00') }, now)).toBe(false);
    expect(scheduleDue({ trigger: sch, createdAt: 0, lastRun: at('2026-10-28T10:10:00') }, now)).toBe(false);
  });

  it('remembers at most the cap of numbers and hashes', () => {
    expect(freshNumbers(undefined, [3, 1])).toEqual({ fresh: [], seen: [1, 3] });
    expect(freshNumbers([1, 2], [3, 2, 4], 3)).toEqual({ fresh: [3, 4], seen: [2, 3, 4] });
    expect(freshCommits(['a'], ['d', 'c', 'a'], 2)).toEqual({ fresh: ['c', 'd'], seen: ['d', 'c'] });
    expect(freshCommits(undefined, ['b'])).toEqual({ fresh: [], seen: ['b'] });
  });

  it('matches branches and scopes', () => {
    expect(onBranch({ branch: ' x ' }, undefined, 'x')).toBe(true);
    expect(onBranch({ branch: '  ' }, 'y')).toBe(true);
    expect(onBranch({}, 'y')).toBe(true);
    expect(applies({ scope: 'global' }, 'a/b')).toBe(true);
    expect(applies({ scope: 'a/b' }, 'a/b')).toBe(true);
    expect(applies({ scope: 'a/c' }, 'a/b')).toBe(false);
  });

  it('classifies every conclusion', () => {
    expect(runOutcome('success')).toBe('workflow_success');
    for (const c of ['failure', 'timed_out', 'startup_failure']) expect(runOutcome(c)).toBe('workflow_failure');
    for (const c of ['cancelled', 'skipped', null]) expect(runOutcome(c)).toBeNull();
  });

  it('words the task for every kind of event', () => {
    const a = { name: 'bot', prompt: ' Look at {{ repo }} #{{number}} {{title}} {{url}} {{branch}} {{unknown}} ', trigger: { type: 'issue' } } as Pick<AutomatedAgent, 'name' | 'prompt' | 'trigger'>;
    const t = (ev: any, agent = a) => automationTask(agent, ev, 'repo');
    expect(t({ kind: 'issue', number: 4, title: 'T', url: 'U', branch: 'B' })).toBe('Automated agent “bot” in repo: issue #4 was opened: T.\nU\n\nLook at repo #4 T U B {{unknown}}');
    expect(t({ kind: 'pull_request', number: 1, title: 'x' })).toContain('pull request #1 was opened: x.');
    expect(t({ kind: 'merge', number: 1, title: 'x' })).toContain('was merged: x.');
    expect(t({ kind: 'commit', count: 1, branch: 'm', title: 'x' })).toContain('a commit was pushed to m: x');
    expect(t({ kind: 'commit', count: 2, branch: 'm', title: 'x' })).toContain('2 commits were pushed to m: x');
    expect(t({ kind: 'workflow_success', title: 'CI' })).toContain('run CI succeeded.');
    expect(t({ kind: 'workflow_failure', title: 'CI', branch: 'f' })).toContain('run CI failed on f.');
    expect(t({ kind: 'schedule' }, { ...a, trigger: { type: 'schedule', every: 'hour', time: '', day: 0 } })).toContain('its schedule (every hour) came due');
    // No url: no second line; no number: empty variable.
    expect(t({ kind: 'schedule' }, { ...a, prompt: 'n={{number}}', trigger: { type: 'schedule', every: 'hour', time: '', day: 0 } })).toMatch(/due\.\n\nn=$/);
  });

  it('validates every setting', () => {
    const ok = { name: 'n', prompt: 'p', scope: 'global', trigger: { type: 'issue' }, budget: 1 } as const;
    expect(validateAgent(ok)).toBeNull();
    expect(validateAgent({ ...ok, name: ' ' })).toMatch(/name/);
    expect(validateAgent({ ...ok, prompt: '' })).toMatch(/what the agent should do/);
    expect(validateAgent({ ...ok, scope: '' })).toMatch(/where/);
    expect(validateAgent({ ...ok, budget: NaN })).toMatch(/budget/);
    expect(validateAgent({ ...ok, budget: -1 })).toMatch(/budget/);
    expect(validateAgent({ ...ok, branch: 'a b' })).toMatch(/spaces/);
    expect(validateAgent({ ...ok, branch: 'ab' })).toBeNull();
    expect(validateAgent({ ...ok, trigger: { type: 'schedule', every: 'day', time: 'x', day: 0 } })).toMatch(/HH:MM/);
    expect(validateAgent({ ...ok, trigger: { type: 'schedule', every: 'hour', time: 'x', day: 0 } })).toBeNull();
    expect(validateAgent({ ...ok, trigger: { type: 'schedule', every: 'week', time: '9:00', day: 1 } })).toBeNull();
  });
});

describe('automation runner edge cases', () => {
  const pr = (number: number, state: 'open' | 'merged' | 'closed', branch = 'b' + number, base = 'main') => ({ number, title: 'T' + number, branch, base, state, draft: false, url: 'u' + number, checks: 'none' as const });
  const base = { prompt: 'p', enabled: true, model: 'sonnet', permMode: 'ask', budget: 1 } as const;

  function setup(over: Partial<AutomationDeps> = {}) {
    const store = new Store();
    store.data.repos = [{ id: 'o/r', name: 'r', defaultBranch: 'main' } as any];
    store.save = () => undefined;
    const started: { repo: string; base: string; task: string }[] = [];
    let now = at('2026-10-26T10:00:00');
    const deps: AutomationDeps = {
      listPulls: async () => [], listIssues: async () => [], listFinishedRuns: async () => [], listCommits: async () => [], automatedBranches: () => new Set(['bot']),
      start: async (repo, b, task) => { started.push({ repo, base: b, task }); },
      repoName: (id) => id.split('/')[1], defaultBranch: () => 'main', changed: () => undefined, ...over
    };
    const auto = new Automations(store, deps, () => now);
    return { auto, store, started, advance: (ms: number) => { now += ms; }, now: () => now };
  }

  it('trims what it saves, keeps lastRun for an unchanged trigger and resets it for a changed one', () => {
    const { auto, now, advance } = setup();
    const id = auto.save({ ...base, name: '  a ', prompt: ' do ', branch: '  ', scope: 'o/r', trigger: { type: 'issue' } });
    expect(auto.agents[0]).toMatchObject({ name: 'a', prompt: 'do', branch: undefined, createdAt: now() });
    auto.agents[0].lastRun = 5;
    advance(1000);
    auto.save({ ...base, id, name: 'a2', scope: 'o/r', branch: ' dev ', trigger: { type: 'issue' } });
    expect(auto.agents).toHaveLength(1);
    expect(auto.agents[0]).toMatchObject({ name: 'a2', lastRun: 5, branch: 'dev', createdAt: now() - 1000 });
    auto.save({ ...base, id, name: 'a2', scope: 'o/r', trigger: { type: 'merge' } });
    expect(auto.agents[0].lastRun).toBe(now());
    // An unknown id is a new agent.
    const other = auto.save({ ...base, id: 'ghost', name: 'z', scope: 'o/r', trigger: { type: 'issue' } });
    expect(other).not.toBe('ghost');
    expect(() => auto.save({ ...base, name: '', scope: 'o/r', trigger: { type: 'issue' } })).toThrow('Give the agent a name.');
  });

  it('ignores removing or running an agent that does not exist', async () => {
    const { auto } = setup();
    auto.remove('nope');
    await expect(auto.runNow('nope')).rejects.toThrow('Automated agent not found');
  });

  it('logs when a session cannot start, and falls back to the default branch for runs and commits', async () => {
    const logs: any[] = [];
    const tries: string[] = [];
    const run = (id: number) => ({ id, number: id, title: 'CI', status: 'completed', conclusion: 'failure', branch: 'gone', event: 'push', actor: 'a', url: 'u', at: '' });
    let runs = [run(1)];
    const { auto, store, started } = setup({
      listFinishedRuns: async () => runs,
      start: async (repo, b, task) => { tries.push(b); if (b === 'origin/gone') throw new Error('no such branch'); started.push({ repo, base: b, task }); }
    });
    store.log = (e: any) => { logs.push(e); return undefined as any; };
    const started2 = started;
    auto.save({ ...base, name: 'fix', scope: 'o/r', trigger: { type: 'workflow_failure' } });
    await auto.tick();
    runs = [run(2), run(1)];
    await auto.tick();
    expect(tries).toEqual(['origin/gone', 'main']);
    expect(started2[0].base).toBe('main');
    expect(logs).toEqual([]);

    // For a pull request there is no second try: the failure is logged.
    const { auto: auto2, store: store2 } = setup({ listPulls: async () => pulls, start: async () => { throw new Error('boom'); } });
    let pulls = [pr(1, 'open')];
    store2.log = (e: any) => { logs.push(e); return undefined as any; };
    auto2.save({ ...base, name: 'rev', scope: 'o/r', trigger: { type: 'pull_request' } });
    await auto2.tick();
    pulls = [pr(2, 'open'), pr(1, 'open')];
    await auto2.tick();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'start', ok: false, repo: 'r', detail: 'boom' });
    expect(logs[0].what).toContain('“rev”');

    // Both tries failing is logged too, and a thrown string is reported.
    const { auto: auto3, store: store3 } = setup({ listFinishedRuns: async () => runs, start: async () => { throw 'plain'; } });
    store3.log = (e: any) => { logs.push(e); return undefined as any; };
    auto3.save({ ...base, name: 'again', scope: 'o/r', trigger: { type: 'workflow_failure' } });
    runs = [run(1)];
    await auto3.tick();
    runs = [run(2), run(1)];
    await auto3.tick();
    expect(logs.at(-1).detail).toBe('plain');
  });

  it('runs a schedule that has come due only once, and does not overlap ticks', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const { auto, started, advance } = setup({ start: async (repo, b, task) => { await gate; started.push({ repo, base: b, task }); } });
    auto.save({ ...base, name: 's', scope: 'o/r', trigger: { type: 'schedule', every: 'hour', time: '', day: 0 } });
    advance(3600_000);
    const first = auto.tick();
    await auto.tick(); // returns at once while the first is busy
    expect(started).toHaveLength(0);
    release();
    await first;
    expect(started).toHaveLength(1);
    await auto.tick();
    expect(started).toHaveLength(1);
  });

  it('starts at most five sessions per agent per poll', async () => {
    let list = [pr(100, 'open')];
    const { auto, started } = setup({ listPulls: async () => list });
    auto.save({ ...base, name: 'rev', scope: 'o/r', trigger: { type: 'pull_request' } });
    await auto.tick();
    list = [1, 2, 3, 4, 5, 6, 7, 100].map((n) => pr(n, 'open'));
    await auto.tick();
    expect(started).toHaveLength(5);
  });

  it('skips closed pull requests and the pull requests of automated branches, and narrows by target branch', async () => {
    let list = [pr(1, 'open')];
    const { auto, started } = setup({ listPulls: async () => list });
    auto.save({ ...base, name: 'rev', scope: 'o/r', branch: 'release', trigger: { type: 'pull_request' } });
    auto.save({ ...base, name: 'merged', scope: 'o/r', trigger: { type: 'merge' } });
    await auto.tick();
    list = [pr(2, 'closed'), pr(3, 'open', 'x', 'release'), pr(4, 'open', 'y', 'main'), pr(5, 'merged', 'bot'), pr(6, 'merged', 'z'), pr(1, 'open')];
    await auto.tick();
    expect(started.map((s) => s.task.split(':')[1].trim().split(' ').slice(0, 5).join(' '))).toEqual(['pull request #3 was opened', 'pull request #6 was merged']);
  });

  it('starts an agent for each new issue', async () => {
    let issues = [{ number: 1, title: 'old', url: 'u1' }] as any[];
    const { auto, started } = setup({ listIssues: async () => issues });
    auto.save({ ...base, name: 'triage', scope: 'o/r', trigger: { type: 'issue' } });
    await auto.tick();
    issues = [{ number: 3, title: 'new', url: 'u3' }, ...issues];
    await auto.tick();
    expect(started).toHaveLength(1);
    expect(started[0].task).toContain('issue #3 was opened: new');
    expect(started[0].base).toBe('main');
  });

  it('watches the named branch for commits, ignores quiet and automated ones, and reports one for a single commit', async () => {
    const c = (sha: string, message = 'm') => ({ sha, message, author: 'a', url: 'u' });
    let by: Record<string, any[]> = { dev: [c('a')], bot: [c('x')] };
    const { auto, started, store } = setup({ listCommits: async (_r, b) => by[b] ?? [] });
    auto.save({ ...base, name: 'dev', scope: 'o/r', branch: ' dev ', trigger: { type: 'commit' } });
    auto.save({ ...base, name: 'bot', scope: 'o/r', branch: 'bot', trigger: { type: 'commit' } });
    auto.save({ ...base, name: 'main', scope: 'o/r', trigger: { type: 'commit' } });
    await auto.tick();
    await auto.tick(); // nothing new
    expect(started).toHaveLength(0);
    by = { dev: [c('b', 'one\nmore'), c('a')], bot: [c('y'), c('x')], main: [c('q'), c('p')] };
    await auto.tick();
    expect(started).toHaveLength(2); // dev and main; bot is an automated branch
    expect(started.some((s) => s.task.includes('a commit was pushed to dev: one'))).toBe(true);
    expect(store.data.automationSeen['o/r'].commits!.bot).toEqual(['y', 'x']);
  });

  it('stays quiet when GitHub cannot be reached', async () => {
    const { auto, started, store } = setup({ listPulls: async () => { throw new Error('offline'); } });
    auto.save({ ...base, name: 'rev', scope: 'o/r', trigger: { type: 'pull_request' } });
    await expect(auto.tick()).resolves.toBeUndefined();
    expect(started).toHaveLength(0);
    expect(store.data.automationSeen['o/r']).toEqual({});
  });

  it('does not poll a repository no event agent covers, and skips disabled agents', async () => {
    let calls = 0;
    const { auto, store } = setup({ listIssues: async () => { calls++; return []; } });
    store.data.repos.push({ id: 'o/q', name: 'q', defaultBranch: 'main' } as any);
    auto.save({ ...base, name: 'a', scope: 'o/q', trigger: { type: 'issue' } });
    auto.save({ ...base, enabled: false, name: 'b', scope: 'o/r', trigger: { type: 'issue' } });
    await auto.tick();
    expect(calls).toBe(1);
  });
});
