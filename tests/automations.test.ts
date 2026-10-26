import { describe, expect, it } from 'vitest';
import { runOutcome, automationTask, describeTrigger, freshNumbers, lastSlot, scheduleDue, validateAgent } from '../src/shared/automations';
import { Automations, type AutomationDeps } from '../src/core/automations';
import { Store } from '../src/core/store';

const at = (s: string) => new Date(s).getTime();
const daily = { type: 'schedule', every: 'day', time: '09:00', day: 1 } as const;

describe('schedules', () => {
  it('finds the latest slot', () => {
    expect(lastSlot(daily, at('2026-10-26T12:00:00'))).toBe(at('2026-10-26T09:00:00'));
    expect(lastSlot(daily, at('2026-10-26T08:00:00'))).toBe(at('2026-10-25T09:00:00'));
    expect(lastSlot({ type: 'schedule', every: 'hour', time: '', day: 0 }, at('2026-10-26T12:34:00'))).toBe(at('2026-10-26T12:00:00'));
    // 2026-10-25 is a Sunday: the last weekday slot before Monday 08:00 is Friday.
    expect(lastSlot({ ...daily, every: 'weekday' }, at('2026-10-26T08:00:00'))).toBe(at('2026-10-23T09:00:00'));
    expect(lastSlot({ ...daily, every: 'week', day: 3 }, at('2026-10-26T12:00:00'))).toBe(at('2026-10-21T09:00:00'));
  });
  it('is due once per slot, and not for slots before it was made', () => {
    const a = { trigger: daily, createdAt: at('2026-10-26T10:00:00'), lastRun: undefined };
    expect(scheduleDue(a, at('2026-10-26T11:00:00'))).toBe(false);
    expect(scheduleDue(a, at('2026-10-27T09:01:00'))).toBe(true);
    expect(scheduleDue({ ...a, lastRun: at('2026-10-27T09:01:00') }, at('2026-10-27T20:00:00'))).toBe(false);
    expect(scheduleDue({ ...a, trigger: { type: 'merge' } }, at('2030-01-01T00:00:00'))).toBe(false);
  });
  it('describes triggers', () => {
    expect(describeTrigger(daily)).toBe('Every day at 09:00');
    expect(describeTrigger({ type: 'merge' })).toBe('When a pull request is merged');
  });
});

describe('events', () => {
  it('records the first look without firing, then reports new numbers', () => {
    const a = freshNumbers(undefined, [3, 1, 2]);
    expect(a.fresh).toEqual([]);
    const b = freshNumbers(a.seen, [5, 4, 3]);
    expect(b.fresh).toEqual([4, 5]);
    expect(freshNumbers(b.seen, [5]).fresh).toEqual([]);
  });
  it('fills the prompt', () => {
    const t = automationTask({ name: 'Review', prompt: 'Review {{title}} on {{branch}} in {{repo}}', trigger: { type: 'pull_request' } }, { kind: 'pull_request', number: 7, title: 'Fix', url: 'u', branch: 'b' }, 'helm');
    expect(t).toContain('pull request #7 was opened: Fix');
    expect(t).toContain('Review Fix on b in helm');
  });
  it('validates', () => {
    expect(validateAgent({ name: '', prompt: 'x', scope: 'global', trigger: { type: 'merge' }, budget: 1 })).toMatch(/name/);
    expect(validateAgent({ name: 'a', prompt: 'x', scope: 'global', trigger: { type: 'merge' }, budget: 1 })).toBeNull();
  });
});

describe('runner', () => {
  const pr = (number: number, state: 'open' | 'merged', branch = 'b' + number) => ({ number, title: 'T' + number, branch, base: 'main', state, draft: false, url: 'u' + number, checks: 'none' as const });
  function setup(prs: () => any[], runs: () => any[] = () => []) {
    const store = new Store();
    store.data.repos = [{ id: 'o/r', name: 'r', defaultBranch: 'main' } as any, { id: 'o/q', name: 'q', defaultBranch: 'dev' } as any];
    store.save = () => undefined;
    const started: { repo: string; base: string; task: string }[] = [];
    let now = at('2026-10-26T10:00:00');
    const deps: AutomationDeps = {
      listPulls: async () => prs(), listIssues: async () => [], listFinishedRuns: async () => runs(), automatedBranches: () => new Set(['bot']),
      start: async (repo, base, task) => { started.push({ repo, base, task }); },
      repoName: (id) => id.split('/')[1], defaultBranch: (id) => (id === 'o/q' ? 'dev' : 'main'), changed: () => undefined
    };
    const auto = new Automations(store, deps, () => now);
    return { auto, started, advance: (ms: number) => { now += ms; } };
  }
  const base = { prompt: 'p', enabled: true, model: 'sonnet', permMode: 'ask', budget: 1 } as const;

  it('starts an agent on new pull requests only, skipping automated branches', async () => {
    let list = [pr(1, 'open')];
    const { auto, started } = setup(() => list);
    auto.save({ ...base, name: 'rev', scope: 'o/r', trigger: { type: 'pull_request' } });
    await auto.tick();
    expect(started).toHaveLength(0);
    list = [pr(3, 'open', 'bot'), pr(2, 'open'), pr(1, 'open')];
    await auto.tick();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ repo: 'o/r', base: 'origin/b2' });
    await auto.tick();
    expect(started).toHaveLength(1);
  });

  it('fires on merge and runs a global schedule in every repository', async () => {
    let list = [pr(1, 'open')];
    const { auto, started, advance } = setup(() => list);
    auto.save({ ...base, name: 'm', scope: 'global', trigger: { type: 'merge' } });
    auto.save({ ...base, name: 's', scope: 'global', trigger: { type: 'schedule', every: 'hour', time: '', day: 0 } });
    await auto.tick();
    list = [pr(1, 'merged')];
    await auto.tick();
    expect(started.map((s) => s.repo)).toEqual(['o/r', 'o/q']);
    expect(started[0].task).toContain('was merged');
    advance(3600_000);
    await auto.tick();
    expect(started).toHaveLength(4);
  });

  it('does not fire when disabled, and runNow ignores the trigger', async () => {
    const { auto, started } = setup(() => []);
    const id = auto.save({ ...base, enabled: false, name: 'x', scope: 'o/q', trigger: { type: 'issue' } });
    await auto.tick();
    expect(started).toHaveLength(0);
    expect(await auto.runNow(id)).toBe(1);
    expect(started[0].base).toBe('dev');
    expect(() => auto.save({ ...base, name: 'y', scope: 'nope/x', trigger: { type: 'issue' } })).toThrow();
    auto.remove(id);
    expect(auto.agents).toHaveLength(0);
  });

  it('starts agents when a workflow run fails or succeeds, skipping cancelled and automated runs', async () => {
    const run = (id: number, conclusion: string, branch = 'feat') => ({ id, number: id, title: 'CI: build', status: 'completed', conclusion, branch, event: 'push', actor: 'a', url: 'u', at: '' });
    let list = [run(1, 'failure')];
    const { auto, started } = setup(() => [], () => list);
    auto.save({ ...base, name: 'fix', scope: 'o/r', trigger: { type: 'workflow_failure' } });
    auto.save({ ...base, name: 'ship', scope: 'o/r', trigger: { type: 'workflow_success' } });
    await auto.tick();
    expect(started).toHaveLength(0);
    list = [run(5, 'failure', 'bot'), run(4, 'cancelled'), run(3, 'success'), run(2, 'failure'), run(1, 'failure')];
    await auto.tick();
    expect(started).toHaveLength(2);
    expect(started.map((s) => s.task).join('\n')).toContain('failed on feat');
    expect(started.map((s) => s.task).join('\n')).toContain('succeeded on feat');
    expect(started[0].base).toBe('origin/feat');
  });

  it('classifies run conclusions', () => {
    expect(runOutcome('success')).toBe('workflow_success');
    expect(runOutcome('timed_out')).toBe('workflow_failure');
    expect(runOutcome('cancelled')).toBeNull();
    expect(runOutcome(null)).toBeNull();
  });
});
