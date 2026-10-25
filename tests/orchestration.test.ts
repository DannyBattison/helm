import { describe, expect, it } from 'vitest';
import { inbox, keyAction } from '../src/shared/inbox';
import { feedbackTask, issueTask, pullNumber } from '../src/shared/issues';
import { queueBlock, queueOrder } from '../src/shared/queue';
import type { PendingAsk, Session } from '../src/shared/types';

function s(id: string, over: Partial<Session> = {}): Session {
  return {
    id, repoId: 'o/r', status: 'idle', task: id, step: '', branch: 'agent/' + id, base: 'main', worktree: '/w', model: 'sonnet', permMode: 'ask', startedAt: 100,
    tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 0, budget: 0, ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [], commits: [], removeAfterMerge: true, lastAccess: 100, subagents: [], ...over
  };
}
const ask = (type: PendingAsk['type'], at: number, extra: Partial<PendingAsk> = {}): PendingAsk => ({ id: 'a' + at, type, at, head: 'h', note: '', ...extra });

describe('inbox', () => {
  it('puts blocked agents first, oldest first, then failures, stuck, ready, queued', () => {
    const items = inbox([
      s('ready', { status: 'ready', endedAt: 50 }),
      s('queued', { queued: { since: 1 } }),
      s('stuck', { status: 'working', stuck: 'x' }),
      s('err', { status: 'error', endedAt: 10 }),
      s('late', { status: 'attention', ask: ask('approve', 300) }),
      s('early', { status: 'attention', ask: ask('question', 200) }),
      s('budget', { status: 'attention', ask: ask('budget', 100) })
    ]);
    expect(items.map((i) => i.session.id)).toEqual(['early', 'late', 'budget', 'err', 'stuck', 'ready', 'queued']);
  });
  it('leaves out archived, merged, and ready work that already has a pull request', () => {
    const items = inbox([s('a', { status: 'ready', archivedAt: 1 }), s('b', { status: 'ready', mergedAt: 1 }), s('c', { status: 'ready', prUrl: 'u' }), s('d', { status: 'idle' })]);
    expect(items).toEqual([]);
  });
});

describe('inbox keys', () => {
  const item = (kind: any, a?: Partial<PendingAsk>) => ({ session: s('x', { ask: a ? ask(kind, 1, a) : undefined }), kind, since: 1 } as any);
  it('approves, always-allows only when there is a pattern, and denies', () => {
    expect(keyAction(item('approve', { pattern: 'npm test *' }), 'a')).toEqual({ do: 'approve' });
    expect(keyAction(item('approve', { pattern: 'npm test *' }), 'A')).toEqual({ do: 'always' });
    expect(keyAction(item('approve', {}), 'A')).toBeNull();
    expect(keyAction(item('approve', {}), 'd')).toEqual({ do: 'deny' });
  });
  it('picks question options by number, within the options that exist', () => {
    const q = item('question', { questions: [{ question: 'Q', options: [{ label: 'a' }, { label: 'b' }] }] });
    expect(keyAction(q, '2')).toEqual({ do: 'answer', option: 1 });
    expect(keyAction(q, '3')).toBeNull();
    expect(keyAction(q, 'a')).toBeNull();
  });
  it('does nothing for keys that do not fit, and opens on Enter anywhere', () => {
    expect(keyAction(item('ready'), 'a')).toBeNull();
    expect(keyAction(item('ready'), 'Enter')).toEqual({ do: 'open' });
    expect(keyAction(item('error'), 'r')).toEqual({ do: 'resume' });
    expect(keyAction(item('queued'), 's')).toEqual({ do: 'start' });
    expect(keyAction(item('budget', {}), 'c')).toEqual({ do: 'continue' });
  });
});

describe('queue', () => {
  const a = s('a');
  const b = s('b', { queued: { after: 'a', since: 1 }, startedAt: 2 });
  it('waits for the session it depends on to be merged', () => {
    expect(queueBlock(b, [a, b], 0, 0)).toMatch(/Waiting for a to merge/);
    expect(queueBlock(b, [{ ...a, mergedAt: 5 }, b], 0, 0)).toBeNull();
  });
  it('does not wait for a session that no longer exists', () => {
    expect(queueBlock(b, [b], 0, 0)).toBeNull();
  });
  it('waits for a free slot only when a limit is set', () => {
    const c = s('c', { queued: { since: 1 } });
    expect(queueBlock(c, [c], 3, 0)).toBeNull();
    expect(queueBlock(c, [c], 2, 3)).toBeNull();
    expect(queueBlock(c, [c], 3, 3)).toMatch(/free slot \(3 of 3/);
  });
  it('is not blocked when not queued, and orders oldest first', () => {
    expect(queueBlock(a, [a], 9, 1)).toBeNull();
    expect(queueOrder([s('late', { queued: { since: 1 }, startedAt: 9 }), s('early', { queued: { since: 1 }, startedAt: 3 }), a]).map((x) => x.id)).toEqual(['early', 'late']);
  });
});

describe('issue tasks', () => {
  const issue = { number: 12, title: 'Cart total is wrong', body: 'Steps:\n<!-- hidden -->\n1. add item', url: 'https://github.com/o/r/issues/12', labels: ['bug'], author: 'x', comments: 1, updated: '' };
  it('includes the issue, its labels, the discussion and the number to commit against', () => {
    const t = issueTask(issue, [{ author: 'maint', body: 'Seen on v2', at: '' }]);
    expect(t).toContain('issue #12: Cart total is wrong');
    expect(t).toContain('Labels: bug');
    expect(t).toContain('1. add item');
    expect(t).not.toContain('hidden');
    expect(t).toContain('@maint: Seen on v2');
    expect(t).toContain('refers to #12');
  });
  it('copes with an empty body and keeps only recent comments', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ author: 'u', body: 'c' + i, at: '' }));
    const t = issueTask({ ...issue, body: '', labels: [] }, many);
    expect(t).toContain('(no description)');
    expect(t).toContain('c29');
    expect(t).not.toContain('c0\n');
  });
  it('lists review comments by file and line, then general ones', () => {
    const t = feedbackTask({ number: 4, title: 'Add login', url: 'u' }, [{ author: 'r', body: 'rename this', path: 'a.ts', line: 7, at: '' }, { author: 'r', body: 'looks good otherwise', at: '' }]);
    expect(t.indexOf('a.ts:7')).toBeGreaterThan(0);
    expect(t.indexOf('a.ts:7')).toBeLessThan(t.indexOf('General comments'));
    expect(t).toContain('pull request #4');
  });
  it('reads a pull request number from its URL', () => {
    expect(pullNumber('https://github.com/o/r/pull/45')).toBe(45);
    expect(pullNumber('https://github.com/o/r/issues/45')).toBeNull();
    expect(pullNumber(undefined)).toBeNull();
  });
});

import { inQuietHours, notifyDecision } from '../src/shared/notify';

describe('notification rules', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);
  const quiet = { enabled: true, from: '22:00', to: '08:00', allowAttention: true };
  it('knows quiet hours that cross midnight', () => {
    expect(inQuietHours(quiet, at(23))).toBe(true);
    expect(inQuietHours(quiet, at(3))).toBe(true);
    expect(inQuietHours(quiet, at(8))).toBe(false);
    expect(inQuietHours(quiet, at(12))).toBe(false);
    expect(inQuietHours({ ...quiet, enabled: false }, at(23))).toBe(false);
    expect(inQuietHours({ ...quiet, from: '09:00', to: '17:00' }, at(10))).toBe(true);
    expect(inQuietHours({ ...quiet, from: '09:00', to: '09:00' }, at(9))).toBe(false);
  });
  const st = () => ({ quiet: { enabled: false, from: '22:00', to: '08:00', allowAttention: true }, notifyRepo: {} as Record<string, 'all' | 'attention' | 'off'>, notifyAttention: { desktop: true, sound: true }, notifyReady: { desktop: true, sound: true }, notifyFailed: { desktop: true, sound: true } });
  it('shows with sound by default', () => {
    expect(notifyDecision(st(), 'ready', 'o/r', at(12))).toEqual({ show: true, sound: true });
  });
  it('respects the per-kind desktop switch', () => {
    expect(notifyDecision({ ...st(), notifyReady: { desktop: false, sound: true } }, 'ready', 'o/r', at(12)).show).toBe(false);
  });
  it('applies a per-repository rule', () => {
    const s = { ...st(), notifyRepo: { 'o/quiet': 'off' as const, 'o/need': 'attention' as const } };
    expect(notifyDecision(s, 'attention', 'o/quiet', at(12)).show).toBe(false);
    expect(notifyDecision(s, 'ready', 'o/need', at(12)).show).toBe(false);
    expect(notifyDecision(s, 'failed', 'o/need', at(12)).show).toBe(false);
    expect(notifyDecision(s, 'attention', 'o/need', at(12)).show).toBe(true);
    expect(notifyDecision(s, 'ready', 'o/other', at(12)).show).toBe(true);
  });
  it('quiet hours silence everything but a blocked agent, and even that has no sound', () => {
    const s = { ...st(), quiet };
    expect(notifyDecision(s, 'ready', 'o/r', at(23))).toEqual({ show: false, sound: false });
    expect(notifyDecision(s, 'attention', 'o/r', at(23))).toEqual({ show: true, sound: false });
    expect(notifyDecision({ ...s, quiet: { ...quiet, allowAttention: false } }, 'attention', 'o/r', at(23)).show).toBe(false);
  });
});

import { searchEvents, snippet } from '../src/shared/search';

describe('search', () => {
  it('cuts a snippet around the match, case-insensitively', () => {
    const t = 'x'.repeat(100) + ' The Cart total is wrong ' + 'y'.repeat(100);
    const s = snippet(t, 'cart total');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('Cart total is wrong');
    expect(s.length).toBeLessThan(140);
    expect(snippet('nothing here', 'cart')).toBe('');
    expect(snippet('short cart text', 'cart')).toBe('short cart text');
  });
  it('finds mentions in what was said, run and edited, and skips subagent prompts', () => {
    const events: any[] = [
      { k: 'user', t: 0, text: 'fix the cart rounding' },
      { k: 'user', t: 0, text: 'cart prompt for subagent', from: 'main' },
      { k: 'agent', text: 'Looking at cart.ts' },
      { k: 'bash', id: '1', cmd: 'grep cart src', out: '', ok: true, meta: '', done: true },
      { k: 'edit', file: 'src/cart.ts', add: 1, del: 0, lines: [] },
      { k: 'tools', items: [['Read', 'cart.ts', '']] },
      { k: 'note', tone: 'neutral', text: 'unrelated' }
    ];
    expect(searchEvents(events, 'cart').map((h) => [h.index, h.kind])).toEqual([[0, 'you'], [2, 'claude'], [3, 'command']]);
    expect(searchEvents(events, 'cart', 10).map((h) => h.kind)).toEqual(['you', 'claude', 'command', 'edit']);
    expect(searchEvents(events, '  ')).toEqual([]);
  });
});

import { trayEntries } from '../src/shared/tray';

describe('tray menu', () => {
  it('lists what waits on you with the actions that fit each, and counts them all', () => {
    const many = Array.from({ length: 10 }, (_, i) => s('r' + i, { status: 'ready', endedAt: i }));
    const { entries, total } = trayEntries([
      s('appr', { status: 'attention', ask: ask('approve', 1, { pattern: 'npm test *', command: 'npm test' }) }),
      s('quest', { status: 'attention', ask: ask('question', 2, { questions: [{ question: 'Q?', options: [{ label: 'Yes' }, { label: 'No' }] }] }) }),
      s('multi', { status: 'attention', ask: ask('question', 3, { questions: [{ question: 'A?', options: [{ label: 'x' }] }, { question: 'B?', options: [{ label: 'y' }] }] }) }),
      s('queued', { queued: { since: 1 } }), s('stuck', { status: 'working', stuck: 'x' }), ...many
    ], 4);
    expect(total).toBe(13);
    expect(entries).toHaveLength(4);
    expect(entries[0].actions.map((a) => a.label)).toEqual(['Approve once', 'Always allow npm test *', 'Deny', 'Open session']);
    expect(entries[1].actions.map((a) => a.action)).toEqual([{ do: 'answer', option: 0 }, { do: 'answer', option: 1 }, { do: 'open' }]);
    expect(entries[2].actions.map((a) => a.action.do)).toEqual(['open']);
    expect(entries.some((e) => e.sessionId === 'queued' || e.sessionId === 'stuck')).toBe(false);
  });
});

import { parseDispatch, prepareInputs, runState } from '../src/shared/workflows';

describe('manual workflows', () => {
  it('finds workflow_dispatch in every spelling of `on`', () => {
    expect(parseDispatch('on: workflow_dispatch\njobs: {}').dispatchable).toBe(true);
    expect(parseDispatch('on: [push, workflow_dispatch]\njobs: {}').dispatchable).toBe(true);
    expect(parseDispatch('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\njobs: {}').dispatchable).toBe(true);
    expect(parseDispatch('on: push\njobs: {}').dispatchable).toBe(false);
    expect(parseDispatch('on:\n  pull_request:\njobs: {}').dispatchable).toBe(false);
    expect(parseDispatch(': : not yaml [').dispatchable).toBe(false);
    expect(parseDispatch('').dispatchable).toBe(false);
  });
  const yml = `name: Deploy
on:
  workflow_dispatch:
    inputs:
      environment:
        description: Where to deploy
        required: true
        type: choice
        options: [staging, production]
        default: staging
      dry_run:
        type: boolean
        default: true
      replicas:
        type: number
      note:
        description: Free text
`;
  it('reads inputs with their types, defaults and options', () => {
    const { inputs } = parseDispatch(yml);
    expect(inputs.map((i) => [i.name, i.type, i.required, i.default])).toEqual([['environment', 'choice', true, 'staging'], ['dry_run', 'boolean', false, 'true'], ['replicas', 'number', false, ''], ['note', 'string', false, '']]);
    expect(inputs[0].options).toEqual(['staging', 'production']);
    expect(inputs[3].description).toBe('Free text');
  });
  it('sends strings, uses defaults, leaves empty optional inputs out and says what is wrong', () => {
    const { inputs } = parseDispatch(yml);
    expect(prepareInputs(inputs, {})).toEqual({ inputs: { environment: 'staging', dry_run: 'true' }, errors: {} });
    expect(prepareInputs(inputs, { environment: 'production', dry_run: 'false', replicas: '3', note: ' hi ' }).inputs).toEqual({ environment: 'production', dry_run: 'false', replicas: '3', note: 'hi' });
    expect(prepareInputs(inputs, { environment: 'moon', replicas: 'many' }).errors).toEqual({ environment: 'Pick one of the options', replicas: 'Must be a number' });
    expect(prepareInputs(inputs, { environment: '', }).inputs.environment).toBe('staging');
    expect(prepareInputs([{ ...inputs[0], default: '' }], {}).errors).toEqual({ environment: 'Required' });
  });
  it('names run states', () => {
    expect(runState({ status: 'in_progress', conclusion: null }).label).toBe('Running');
    expect(runState({ status: 'completed', conclusion: 'success' }).tone).toBe('ready');
    expect(runState({ status: 'completed', conclusion: 'failure' }).tone).toBe('error');
    expect(runState({ status: 'waiting', conclusion: null }).tone).toBe('attention');
  });
});
