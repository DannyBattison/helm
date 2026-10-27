import { describe, expect, it } from 'vitest';
import { approvalReport, auditCsv, buildReport, commandKey, DAY, dayKey, digestMarkdown, fmtDuration, median, outcomeOf, outcomeReport, projectWindow, qualityReport, sessionsCsv, spendCsv, spendReport, throughputReport, timeInStatus, toCsv, weekOf, type ReportInput } from '../src/shared/reports';
import type { AuditEntry, DailyUsage, Session } from '../src/shared/types';

const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime(); // a Wednesday

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's', repoId: 'o/r', status: 'idle', task: 't', step: '', branch: 'agent/s', base: 'main', worktree: '/w', model: 'sonnet', permMode: 'ask',
    startedAt: NOW - 2 * DAY, tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 1, budget: 10, ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [], commits: [],
    removeAfterMerge: true, lastAccess: NOW, subagents: [], ...over
  };
}
const use = (n: number, o: Partial<DailyUsage> = {}): DailyUsage => ({ day: dayKey(NOW - n * DAY), repoId: 'o/r', model: 'sonnet', cost: 1, input: 100, output: 50, cacheRead: 300, ...o });
const input = (o: Partial<ReportInput> = {}): ReportInput => ({ sessions: [], daily: [], audit: [], alwaysAllow: [], now: NOW, days: 7, ...o });
const entry = (o: Partial<AuditEntry>): AuditEntry => ({ t: NOW - DAY, sessionId: 's', repoId: 'o/r', kind: 'approval', text: 'git push', ...o });

describe('report helpers', () => {
  it('formats days and weeks, and takes medians', () => {
    expect(dayKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
    expect(new Date(weekOf(new Date(2026, 9, 25, 15).getTime())).getDate()).toBe(19); // Sunday belongs to the week of the Monday before
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('builds a command key from one or two words', () => {
    expect(commandKey('   ')).toBe('');
    expect(commandKey('  git   push origin')).toBe('git push');
    expect(commandKey('ls -la')).toBe('ls');
    expect(commandKey('git')).toBe('git');
  });

  it('projects a plan window only when there is something to project', () => {
    const W = 5 * 3600_000;
    const resets = (NOW + W / 2) / 1000;
    expect(projectWindow(0.2, resets, W, NOW)).toEqual({ projected: 0.4, hitsAt: undefined });
    const hot = projectWindow(0.8, resets, W, NOW)!;
    expect(hot.projected).toBeCloseTo(1.6);
    expect(hot.hitsAt).toBe(NOW - W / 2 + (W / 2) / 0.8);
    expect(projectWindow(0.5, (NOW - 1000) / 1000, W, NOW)).toBeNull(); // already reset
    expect(projectWindow(0.5, (NOW + W - 1000) / 1000, W, NOW)).toBeNull(); // too early in the window
    expect(projectWindow(0, resets, W, NOW)).toBeNull();
  });

  it('formats durations', () => {
    expect(fmtDuration(null)).toBe('–');
    expect(fmtDuration(100)).toBe('1s');
    expect(fmtDuration(30_000)).toBe('30s');
    expect(fmtDuration(5 * 60_000)).toBe('5m');
    expect(fmtDuration(89 * 60_000)).toBe('89m');
    expect(fmtDuration(2 * 3600_000)).toBe('2h');
    expect(fmtDuration(2.5 * 3600_000)).toBe('2.5h');
    expect(fmtDuration(72 * 3600_000)).toBe('3d');
  });

  it('quotes CSV cells and blanks null values', () => {
    expect(toCsv([['a,b', 'say "hi"', 'line\nbreak', null, undefined, 0]])).toBe('"a,b","say ""hi""","line\nbreak",,,0\n');
  });
});

describe('spend and outcome edge cases', () => {
  it('clamps negative days, groups by effort and handles a period with no input', () => {
    const r = spendReport(input({
      daily: [use(1, { cost: -5, input: 0, cacheRead: 0 }), use(2, { cost: 2, input: 0, cacheRead: 0, repoId: 'o/q', model: 'opus' }), use(400)],
      sessions: [session({ id: 'a', effort: 'high', cost: 3 }), session({ id: 'b', cost: 1 }), session({ id: 'c', effort: 'high', cost: 1 }), session({ id: 'old', startedAt: NOW - 100 * DAY })]
    }));
    expect(r.total.cost).toBe(2);
    expect(r.cacheHit).toBe(0);
    expect(r.days).toHaveLength(7);
    expect(r.byRepo.map((x) => x.id)).toEqual(['o/q', 'o/r']);
    expect(r.byEffort).toEqual([{ id: 'high', cost: 4, sessions: 2 }, { id: 'default', cost: 1, sessions: 1 }]);
    expect(r.topSessions.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(r.fiveHour).toBeNull();
    expect(r.weekly).toBeNull();
  });

  it('ignores usage on days outside the listed window and includes the plan windows', () => {
    const W = 5 * 3600_000;
    const r = spendReport(input({
      days: 1, daily: [use(0), { ...use(0), day: '2999-01-01' }],
      plan: { at: NOW, fiveHour: { util: 0.5, resetsAt: (NOW + W / 2) / 1000 }, weekly: { util: 0.1, resetsAt: (NOW + 3 * DAY) / 1000 } } as any
    }));
    expect(r.days).toHaveLength(1);
    expect(r.fiveHour!.projected).toBeCloseTo(1);
    expect(r.weekly!.projected).toBeGreaterThan(0.1);
    expect(r.cacheHit).toBeCloseTo(300 / 400);
  });

  it('works out each outcome and the cost ratios', () => {
    const merged = session({ id: 'm', mergedAt: NOW, cost: 4, add: 30, del: 10, commits: [{ hash: 'h', msg: 'x', at: NOW - DAY }] as any });
    const pr = session({ id: 'p', prUrl: 'u', cost: 2 });
    const dead = session({ id: 'd', archivedAt: NOW, cost: 4 });
    const open = session({ id: 'o', cost: 0 });
    expect([merged, pr, dead, open].map(outcomeOf)).toEqual(['merged', 'pr', 'abandoned', 'open']);
    const r = outcomeReport(input({ sessions: [merged, pr, dead, open] }));
    expect(r.counts).toEqual({ merged: 1, pr: 1, abandoned: 1, open: 1 });
    expect(r.costPerMerged).toBe(4);
    expect(r.costPerCommitMerged).toBe(4);
    expect(r.costPer100Lines).toBe(10);
    expect(r.wasteShare).toBe(0.4);
    expect(r.rows.map((x) => x.id)).toEqual(['m', 'd', 'p', 'o']);
    const none = outcomeReport(input({ sessions: [open] }));
    expect(none).toMatchObject({ costPerMerged: null, costPerCommitMerged: null, costPer100Lines: null, wasteShare: 0 });
  });
});

describe('throughput edge cases', () => {
  it('measures status time with open and closed ends', () => {
    const s = session({ timeline: [{ t: NOW - 3000, status: 'working' }, { t: NOW - 2000, status: 'attention' }, { t: NOW - 500, status: 'ready' }, { t: NOW - 100, status: 'idle' }] as any });
    expect(timeInStatus(s, NOW)).toEqual({ working: 1000, attention: 1500, ready: 400, idle: 0 });
    expect(timeInStatus(session({ timeline: [{ t: NOW - 100, status: 'attention' }] as any }), NOW)).toEqual({ attention: 100 });
    expect(timeInStatus(session({ timeline: [{ t: NOW + 100, status: 'working' }] as any }), NOW)).toEqual({ working: 0 });
  });

  it('counts weeks, lead times and the sessions that waited longest', () => {
    const a = session({ id: 'a', startedAt: NOW - 2 * DAY, mergedAt: NOW - DAY, prAt: NOW - 1.5 * DAY, commits: [{ hash: 'h', msg: '', at: NOW - 2 * DAY + 5000 }] as any, timeline: [{ t: NOW - 2 * DAY, status: 'attention' }, { t: NOW - 2 * DAY + 4000, status: 'working' }, { t: NOW - 2 * DAY + 10000, status: 'idle' }] as any });
    const b = session({ id: 'b', startedAt: NOW - 3 * DAY, archivedAt: NOW - DAY });
    const c = session({ id: 'c', startedAt: NOW - 400 * DAY, mergedAt: NOW - 399 * DAY, archivedAt: NOW - 399 * DAY });
    const d = session({ id: 'd', startedAt: NOW - 300 * DAY, prUrl: 'u', archivedAt: NOW - 1 * DAY });
    const r = throughputReport(input({ sessions: [a, b, c, d] }));
    const thisWeek = r.weeks.find((w) => w.start === weekOf(NOW))!;
    expect(thisWeek).toMatchObject({ started: 1, merged: 1, abandoned: 1 });
    expect(r.weeks.every((w, i, all) => !i || all[i - 1].start < w.start)).toBe(true);
    expect(r.leadTime).toEqual({ firstCommit: 5000, pullRequest: 0.5 * DAY, merged: DAY });
    expect(r.waiting.sessions).toEqual([{ id: 'a', repoId: 'o/r', ms: 4000 }]);
    expect(r.waiting.share).toBeCloseTo(4000 / 10000);
    const empty = throughputReport(input());
    expect(empty.leadTime).toEqual({ firstCommit: null, pullRequest: null, merged: null });
    expect(empty.waiting).toEqual({ total: 0, share: 0, sessions: [] });
  });

  it('ignores a negative lead time', () => {
    const s = session({ prAt: NOW - 5 * DAY });
    expect(throughputReport(input({ sessions: [s] })).leadTime.pullRequest).toBeNull();
  });
});

describe('approvals and quality edge cases', () => {
  it('counts decisions, defaulting an unrecorded one to approved, and suggests allow rules', () => {
    const rows: AuditEntry[] = [
      ...Array.from({ length: 5 }, () => entry({ text: 'npm run build', decision: 'approved', waitMs: 2000 })),
      ...Array.from({ length: 6 }, () => entry({ text: 'git status', decision: 'approved' })),
      ...Array.from({ length: 5 }, () => entry({ text: 'ls', decision: 'approved' })),
      entry({ text: 'ls', decision: 'denied' }),
      ...Array.from({ length: 5 }, () => entry({ text: 'make test', decision: undefined })),
      entry({ text: '   ', decision: 'always' }),
      entry({ kind: 'command', text: 'x' }),
      entry({ t: NOW - 100 * DAY, text: 'old' })
    ];
    const r = approvalReport(input({ audit: rows, alwaysAllow: ['git status *'] }));
    expect(r.total).toBe(23);
    expect(r.always).toBe(1);
    expect(r.denied).toBe(1);
    expect(r.commandsRun).toBe(1);
    // A blank command has no key, so its own text is used.
    expect(r.byCommand.find((x) => x.key === '   ')).toMatchObject({ always: 1 });
    expect(r.byCommand.find((x) => x.key === 'make test')).toMatchObject({ approved: 5 });
    // Covered by the allow list, denied once, or too few: only npm run build and make test remain.
    expect(r.suggestions.map((s) => s.pattern).sort()).toEqual(['make test *', 'npm run *']);
    expect(r.suggestions.some((s) => s.pattern === 'git status *')).toBe(false);
    expect(r.suggestions.some((s) => s.pattern === 'ls *')).toBe(false);
    expect(r.medianWaitMs).toBe(0); // most rows recorded no wait
    expect(approvalReport(input({ audit: [entry({ waitMs: 1000 }), entry({ waitMs: 3000 })] })).medianWaitMs).toBe(2000);
    expect(approvalReport(input()).medianWaitMs).toBeNull();
  });

  it('collects tools, stuck sessions, context use, hot files and churn', () => {
    const a = session({ id: 'a', tools: { Bash: { n: 3, err: 1 }, Edit: { n: 1, err: 0 } } as any, filesTouched: { 'x.ts': { add: 2, del: 1 }, 'y.ts': { add: 9, del: 0 } } as any, fileEdits: { 'x.ts': 6, 'y.ts': 2 } as any, ctx: 100_000, stuck: 'loops' });
    const b = session({ id: 'b', tools: { Bash: { n: 2, err: 2 } } as any, filesTouched: { 'x.ts': { add: 1, del: 1 } } as any, ctx: 50_000, model: 'opus' });
    const c = session({ id: 'c', archivedAt: NOW, stuck: 'old', ctx: 190_000 });
    const d = session({ id: 'd', startedAt: NOW - 90 * DAY, filesTouched: { 'x.ts': { add: 100, del: 0 } } as any });
    const r = qualityReport(input({ sessions: [a, b, c, d] }));
    expect(r.tools).toEqual([{ name: 'Bash', n: 5, err: 3 }, { name: 'Edit', n: 1, err: 0 }]);
    expect(r.stuck).toEqual([{ id: 'a', repoId: 'o/r', reason: 'loops' }]);
    expect(r.context.map((x) => [x.id, x.pct])).toEqual([['a', 0.5], ['b', 0.25]]);
    expect(r.hotFiles[0]).toMatchObject({ path: 'x.ts', sessions: 2, add: 3, del: 2, edits: 6 });
    expect(r.hotFiles[1]).toMatchObject({ path: 'y.ts', sessions: 1 });
    expect(r.churn).toEqual([{ id: 'a', repoId: 'o/r', file: 'x.ts', edits: 6 }]);
    // Sessions without tool or file records are fine.
    const bare = qualityReport(input({ sessions: [{ ...session(), tools: undefined, filesTouched: undefined, fileEdits: undefined } as any] }));
    expect(bare).toMatchObject({ tools: [], hotFiles: [], churn: [] });
  });
});

describe('exports and digest', () => {
  it('writes the three CSVs for the period only', () => {
    const inp = input({
      daily: [use(1, { cost: 1.23456 }), use(100)],
      sessions: [session({ id: 'k', effort: undefined, tokens: { input: 1, output: 2, cacheRead: 3 }, commits: [{} as any] }), session({ id: 'old', startedAt: NOW - 99 * DAY })],
      audit: [entry({ ok: false, decision: 'denied', waitMs: 5 }), entry({ kind: 'command' }), entry({ t: NOW - 99 * DAY })]
    });
    expect(spendCsv(inp).trim().split('\n')).toEqual(['day,repository,model,cost_usd,input_tokens,output_tokens,cache_read_tokens', `${dayKey(NOW - DAY)},o/r,sonnet,1.2346,100,50,300`]);
    const s = sessionsCsv(inp).trim().split('\n');
    expect(s).toHaveLength(2);
    expect(s[1]).toContain('k,o/r,open,sonnet,,');
    expect(s[1].endsWith(',1.0000,6,1,0,0,0')).toBe(true);
    const a = auditCsv(inp).trim().split('\n');
    expect(a).toHaveLength(3);
    expect(a[1]).toMatch(/,s,o\/r,approval,git push,false,denied,5$/);
    expect(a[2]).toMatch(/,command,git push,,,$/);
  });

  it('writes a digest of a quiet period', () => {
    const md = digestMarkdown(input(), (v) => '$' + v.toFixed(2));
    expect(md).toContain('**No spend** across 0 sessions · 0 merged · 0 abandoned · 0 approvals');
    expect(md).toContain('- Nothing merged in this period.');
    expect(md).toContain('- Nothing is waiting.');
    expect(md).not.toContain('Suggested allow rules');
    expect(md).not.toContain('## Stuck');
    expect(md).toContain('Median start to first commit –, to merge –.');
  });

  it('writes a digest of a busy one', () => {
    const merged = session({ id: 'm', customTitle: 'Custom', mergedAt: NOW - DAY, cost: 3, add: 4, del: 2, commits: [{ hash: 'h', msg: '', at: NOW - DAY }] as any, startedAt: NOW - 3 * DAY });
    const dead = session({ id: 'd', archivedAt: NOW - DAY, cost: 7, title: 'Titled' });
    const stuck = session({ id: 's1', stuck: 'repeating edits', task: 'the task' });
    const ready = session({ id: 'r', status: 'ready', title: 'Ready one' });
    const attn = session({ id: 'a', status: 'attention', title: 'Needs you' });
    const err = session({ id: 'e', status: 'error', title: 'Broke' });
    const audit = Array.from({ length: 5 }, () => entry({ text: 'make all', decision: 'approved' }));
    const md = digestMarkdown(input({ sessions: [merged, dead, stuck, ready, attn, err], daily: [use(1, { cost: 10 })], audit }), (v) => '$' + v.toFixed(2));
    expect(md).toContain('**$10.00** across');
    expect(md).toContain('- **o/r** Custom ($3.00, 1 commits, +4/−2)');
    expect(md).toContain(': looks stuck, repeating edits');
    expect(md).toContain('Ready one: ready for review');
    expect(md).toContain('Needs you: waiting on you');
    expect(md).toContain('Broke: failed');
    expect(md).toContain('Average cost per merged session: $3.00');
    expect(md).toMatch(/\d+% of spend went on sessions that were abandoned\./);
    expect(md).toContain('`make all *` (approved 5 times)');
    expect(md).toContain('## Stuck');
    expect(buildReport(input()).days).toBe(7);
  });
});
