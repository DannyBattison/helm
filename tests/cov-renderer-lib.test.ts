import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ago, clock, laneAxis, laneData, livePlan, prettyModel, relTime, repoOf, subagentTree, theme, totals, untilReset, whereLabel, elapsed, fmtTokens, langOf, runningSubagents, lifetimeTokens } from '../src/renderer/src/lib';

const NOW = new Date(2026, 9, 21, 12, 0).getTime();
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const S = (o: any = {}) => ({ id: 's', repoId: 'o/r', status: 'idle', model: 'sonnet', branch: 'agent/x', worktree: '/a/b/c', timeline: [], commits: [], subagents: [], tokens: { input: 1, output: 2, cacheRead: 3 }, ...o });

describe('time formatting', () => {
  it('words ages at each scale', () => {
    expect(ago(NOW - 5000)).toBe('now');
    expect(ago(NOW - 5 * MIN)).toBe('5m');
    expect(ago(NOW - 3 * HOUR)).toBe('3h');
    expect(ago(NOW - 2 * DAY)).toBe('2d');
  });

  it('words a time as a clock, yesterday, a weekday or a date', () => {
    expect(relTime(NOW - HOUR)).toBe(clock(NOW - HOUR));
    expect(relTime(NOW - 20 * HOUR)).toBe('Yesterday');
    expect(relTime(NOW - 3 * DAY)).toBe(new Date(NOW - 3 * DAY).toLocaleDateString([], { weekday: 'short' }));
    expect(relTime(NOW - 30 * DAY)).toBe(new Date(NOW - 30 * DAY).toLocaleDateString([], { day: 'numeric', month: 'short' }));
  });

  it('words elapsed time with an explicit end and hours with and without minutes', () => {
    expect(elapsed(NOW - 10_000)).toBe('<1m');
    expect(elapsed(NOW - 2 * HOUR, NOW)).toBe('2h');
    expect(elapsed(NOW - 2 * HOUR - 5 * MIN)).toBe('2h 5m');
    expect(elapsed(NOW + HOUR)).toBe('<1m');
  });

  it('words the time until a reset', () => {
    expect(untilReset((NOW - HOUR) / 1000)).toBe('0m');
    expect(untilReset((NOW + 30 * MIN) / 1000)).toBe('30m');
    expect(untilReset((NOW + 5 * HOUR) / 1000)).toBe('5h');
    expect(untilReset((NOW + 5 * DAY) / 1000)).toBe('5d');
  });

  it('shortens tokens', () => {
    expect(fmtTokens(2_500_000)).toBe('2.5M');
    expect(fmtTokens(1_000_000)).toBe('1.0M'.replace('.0', '.0'));
    expect(fmtTokens(1500)).toBe('2k');
    expect(fmtTokens(999)).toBe('999');
    expect(lifetimeTokens()).toBe(0);
    expect(lifetimeTokens({ input: 1, output: 2, cacheRead: 3 })).toBe(6);
  });
});

describe('session helpers', () => {
  it('names where a session works and its model', () => {
    expect(whereLabel(S() as any)).toBe('agent/x');
    expect(whereLabel(S({ free: true }) as any)).toBe('b/c');
    expect(whereLabel(S({ free: true, worktree: 'C:\\w\\proj\\' }) as any)).toBe('w/proj');
    expect(prettyModel(S() as any)).toBe('Sonnet');
    expect(prettyModel(S({ modelName: 'claude-opus-4-1-20250805' }) as any)).toBe('Opus 4.1');
    expect(prettyModel(S({ modelName: 'claude-sonnet-4-5' }) as any)).toBe('Sonnet 4.5');
    expect(prettyModel(S({ modelName: 'claude-opus-4' }) as any)).toBe('Opus 4');
    expect(prettyModel(S({ modelName: 'claude-3-haiku' }) as any)).toBe('Haiku');
    expect(prettyModel(S({ modelName: 'claude-opus-4-20250514' }) as any)).toBe('Opus 4');
    expect(prettyModel(S({ modelName: 'mystery', model: 'haiku' }) as any)).toBe('Haiku');
  });

  it('finds a repo for a session', () => {
    const app: any = { repos: [{ id: 'o/r' }] };
    expect(repoOf(app, S() as any)).toEqual({ id: 'o/r' });
    expect(repoOf(app, S({ repoId: 'x/y' }) as any)).toBeUndefined();
  });

  it('totals live sessions by status', () => {
    const app: any = { sessions: [S({ status: 'working' }), S({ status: 'working', archivedAt: 1 }), S({ status: 'attention' }), S({ status: 'ready' }), S()], weekSpend: { a: 1.5, b: 2 }, settings: { weeklyLimit: 10 }, tokensToday: 99 };
    expect(totals(app)).toEqual({ working: 1, attention: 1, ready: 1, idle: 1, spent: 3.5, cap: 10, tokens: 99 });
    expect(totals({ ...app, weekSpend: {} }).spent).toBe(0);
  });

  it('only shows plan windows that have not reset', () => {
    const app: any = { plan: { fiveHour: { util: 0.5, resetsAt: (NOW + HOUR) / 1000 }, weekly: { util: 0.9, resetsAt: (NOW - HOUR) / 1000 } } };
    expect(livePlan(app)).toEqual({ fiveHour: app.plan.fiveHour, weekly: undefined });
    expect(livePlan({ plan: {} } as any)).toEqual({ fiveHour: undefined, weekly: undefined });
  });

  it('lists subagents as a tree, hiding archived ones unless asked', () => {
    const s: any = S({ subagents: [
      { id: 'a', parentId: null, status: 'working' }, { id: 'b', parentId: 'a', status: 'idle' },
      { id: 'c', parentId: 'a', status: 'done', archived: true }, { id: 'd', parentId: 'b', status: 'working' }
    ] });
    expect(subagentTree(s).map((x) => [x.a.id, x.depth])).toEqual([['a', 0], ['b', 1], ['d', 2]]);
    expect(subagentTree(s, true).map((x) => x.a.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(runningSubagents(s)).toBe(2);
    expect(subagentTree({ ...s, subagents: undefined })).toEqual([]);
    expect(runningSubagents({ ...s, subagents: undefined })).toBe(0);
  });
});

describe('lanes, theme and languages', () => {
  it('draws segments clipped to the window, skipping idle and error, and marks commits', () => {
    const s: any = S({
      timeline: [
        { t: NOW - 200 * MIN, status: 'working' }, // starts before the window
        { t: NOW - 60 * MIN, status: 'idle' },
        { t: NOW - 50 * MIN, status: 'attention' },
        { t: NOW - 40 * MIN, status: 'error' },
        { t: NOW - 10 * MIN, status: 'working' }
      ],
      endedAt: NOW - 10 * MIN + 1000,
      commits: [{ at: NOW - 30 * MIN }, { at: NOW - 500 * MIN }, { at: NOW + 60 * MIN }]
    });
    const { segs, marks } = laneData(s, NOW);
    expect(segs[0]).toEqual([0, 44, 'working']);
    expect(segs[1]).toEqual([54, 64, 'attention']);
    expect(segs[2][2]).toBe('working');
    expect(segs[2][0]).toBe(94);
    expect(segs[2][1]).toBeCloseTo(94.6); // a sliver is still drawn
    expect(marks).toEqual([74]);
    // A session that never ended runs up to now; one wholly outside the window draws nothing.
    expect(laneData(S({ timeline: [{ t: NOW - 20 * MIN, status: 'working' }] }) as any, NOW).segs).toEqual([[84, 104, 'working']]);
    expect(laneData(S({ timeline: [{ t: NOW - 300 * MIN, status: 'working' }, { t: NOW - 200 * MIN, status: 'ready' }, { t: NOW - 150 * MIN, status: 'idle' }] }) as any, NOW).segs).toEqual([]);
    expect(laneData(S() as any).segs).toEqual([]);
  });

  it('labels the lane axis on the half hour, then "now"', () => {
    const ax = laneAxis(NOW);
    expect(ax.at(-1)).toEqual([104, 'now']);
    expect(ax[0][1]).toMatch(/^\d+:(00|30)$/);
    expect(ax).toEqual([[14, '10:30'], [44, '11:00'], [74, '11:30'], [104, 'now']]);
    // A window that starts before the half hour gets that half hour as its first tick.
    const early = laneAxis(new Date(2026, 9, 21, 12, 10).getTime());
    expect(early[0][1]).toMatch(/:30$/);
    expect(laneAxis().length).toBeGreaterThan(1);
  });

  it('picks the theme, asking the system for "system"', () => {
    expect(theme('light')).toBe('light');
    expect(theme('dark')).toBe('dark');
    expect(theme('whatever')).toBe('dark');
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: true, media: q }) });
    expect(theme('system')).toBe('dark');
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(theme('system')).toBe('light');
  });

  it('maps file extensions to languages', () => {
    expect(langOf('src/a.TSX')).toBe('typescript');
    expect(langOf('x.yml')).toBe('yaml');
    expect(langOf('Makefile')).toBe('plaintext');
    expect(langOf('a.unknownext')).toBe('plaintext');
    expect(langOf('')).toBe('plaintext');
  });
});
