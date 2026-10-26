import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, CHECK_RE, elapsed, fmtTokens, isFreeGroup, laneAxis, laneData, langOf, lifetimeTokens, livePlan, money, prettyModel, reposWithSessions, runningSubagents, sessionTokens, subagentTree, theme, tilde, totals, untilReset, whereLabel } from '../src/renderer/src/lib';
import { FREE_ID } from '../src/shared/types';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('formatting', () => {
  it('shortens paths, tokens and money', () => {
    expect(tilde('/home/u/code/x', '/home/u')).toBe('~/code/x');
    expect(tilde('C:\\Users\\u\\x', 'c:\\users\\u')).toBe('~/x');
    expect(tilde('/etc/x', '')).toBe('/etc/x');
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(12_400)).toBe('12k');
    expect(fmtTokens(1_500_000)).toBe('1.5M');
    expect(lifetimeTokens()).toBe(0);
    expect(lifetimeTokens({ input: 1, output: 2, cacheRead: 3 })).toBe(6);
    expect(money(1.239)).toBe('$1.24');
  });
  it('says how long ago and for how long', () => {
    expect(elapsed(NOW - 10_000)).toBe('<1m');
    expect(elapsed(NOW - 5 * 60_000)).toBe('5m');
    expect(elapsed(NOW - 120 * 60_000)).toBe('2h');
    expect(elapsed(NOW - 125 * 60_000, NOW)).toBe('2h 5m');
    expect(ago(NOW - 5000)).toBe('now');
    expect(ago(NOW - 5 * 60_000)).toBe('5m');
    expect(ago(NOW - 3 * 3600_000)).toBe('3h');
    expect(ago(NOW - 2 * 86400_000)).toBe('2d');
    expect(untilReset((NOW + 30 * 60_000) / 1000)).toBe('30m');
    expect(untilReset((NOW + 5 * 3600_000) / 1000)).toBe('5h');
    expect(untilReset((NOW + 5 * 86400_000) / 1000)).toBe('5d');
  });
  it('names languages and models', () => {
    expect(langOf('a/b.tsx')).toBe('typescript');
    expect(langOf('Makefile')).toBe('plaintext');
    expect(prettyModel({ model: 'sonnet', modelName: 'claude-opus-4-7' } as any)).toBe('Opus 4.7');
    expect(prettyModel({ model: 'sonnet', modelName: 'claude-sonnet-5' } as any)).toBe('Sonnet 5');
    expect(prettyModel({ model: 'haiku' } as any)).toBe('Haiku');
    expect(prettyModel({ model: 'haiku', modelName: 'claude-haiku' } as any)).toBe('Haiku');
    expect(CHECK_RE.test('npm run lint')).toBe(true);
    expect(CHECK_RE.test('ls')).toBe(false);
  });
  it('picks a theme', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(theme('system')).toBe('light');
    expect(theme('light')).toBe('light');
    expect(theme('dark')).toBe('dark');
  });
});

const session = (over: any = {}) => ({ id: 's', repoId: 'r', status: 'working', tokens: { input: 1, output: 2, cacheRead: 3 }, subagents: [], timeline: [], commits: [], branch: 'agent/x', worktree: '/a/b/c', ...over });

describe('app state helpers', () => {
  const app: any = { repos: [{ id: 'r' }], sessions: [session(), session({ id: 't', status: 'ready' }), session({ id: 'u', status: 'ready', archivedAt: 1 }), session({ id: 'f', repoId: FREE_ID, free: true })], weekSpend: { a: 1, b: 2 }, tokensToday: 7, settings: { weeklyLimit: 50 }, plan: { fiveHour: { util: 1, resetsAt: NOW / 1000 + 100 }, weekly: { util: 2, resetsAt: NOW / 1000 - 100 } } };
  it('counts sessions per status and sums spend', () => {
    expect(totals(app)).toMatchObject({ working: 2, ready: 1, spent: 3, cap: 50, tokens: 7 });
    expect(sessionTokens(session() as any)).toBe(6);
  });
  it('groups sessions by repository, free agents first', () => {
    const g = reposWithSessions(app);
    expect(isFreeGroup(g[0].repo)).toBe(true);
    expect(g[1].sessions).toHaveLength(2);
    expect(reposWithSessions(app, true)[1].sessions).toHaveLength(3);
  });
  it('labels where a session works', () => {
    expect(whereLabel(session() as any)).toBe('agent/x');
    expect(whereLabel(session({ free: true }) as any)).toBe('b/c');
  });
  it('drops plan windows that have reset', () => {
    const p = livePlan(app);
    expect(p.fiveHour).toBeDefined();
    expect(p.weekly).toBeUndefined();
  });
  it('walks the subagent tree', () => {
    const s: any = session({ subagents: [{ id: 'a', parentId: null, status: 'working' }, { id: 'b', parentId: 'a', status: 'idle' }, { id: 'c', parentId: null, archived: true, status: 'idle' }] });
    expect(subagentTree(s).map((x) => [x.a.id, x.depth])).toEqual([['a', 0], ['b', 1]]);
    expect(subagentTree(s, true)).toHaveLength(3);
    expect(runningSubagents(s)).toBe(1);
  });
});

describe('lane', () => {
  it('lays out working stretches and commit marks', () => {
    const s: any = session({ timeline: [{ t: NOW - 60 * 60_000, status: 'working' }, { t: NOW - 30 * 60_000, status: 'idle' }, { t: NOW - 10 * 60_000, status: 'attention' }], commits: [{ at: NOW - 20 * 60_000 }, { at: NOW - 500 * 60_000 }] });
    const { segs, marks } = laneData(s, NOW);
    expect(segs.map((x) => x[2])).toEqual(['working', 'attention']);
    expect(marks).toHaveLength(1);
    expect(laneAxis(NOW).at(-1)).toEqual([104, 'now']);
  });
});
