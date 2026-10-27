import { describe, expect, it } from 'vitest';
import { auditText, redact } from '../src/shared/redact';
import { approvalReport, buildReport, commandKey, DAY, digestMarkdown, median, outcomeOf, projectWindow, qualityReport, spendReport, throughputReport, timeInStatus, toCsv, weekOf, type ReportInput } from '../src/shared/reports';
import { stuckReason } from '../src/shared/stuck';
import type { AuditEntry, DailyUsage, Session } from '../src/shared/types';

const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime(); // a Wednesday

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's', repoId: 'o/r', status: 'idle', task: 't', step: '', branch: 'agent/s', base: 'main', worktree: '/w', model: 'sonnet', permMode: 'ask',
    startedAt: NOW - 2 * DAY, tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 1, budget: 10, ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [], commits: [],
    removeAfterMerge: true, lastAccess: NOW, subagents: [], ...over
  };
}
const day = (n: number) => { const d = new Date(NOW - n * DAY); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const use = (n: number, o: Partial<DailyUsage> = {}): DailyUsage => ({ day: day(n), repoId: 'o/r', model: 'sonnet', cost: 1, input: 100, output: 50, cacheRead: 300, ...o });
const ask = (text: string, decision: AuditEntry['decision'], waitMs = 1000, t = NOW - DAY): AuditEntry => ({ t, sessionId: 's', repoId: 'o/r', kind: 'approval', text, decision, waitMs });
const input = (o: Partial<ReportInput> = {}): ReportInput => ({ sessions: [], daily: [], audit: [], alwaysAllow: [], now: NOW, days: 7, ...o });

describe('redact', () => {
  it('masks tokens, keys and secret-named assignments', () => {
    expect(redact('git clone https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y')).not.toContain('ghp_abc');
    expect(redact('export API_KEY=abc123 && run')).toBe('export API_KEY=[secret] && run');
    expect(redact('curl -H "Authorization: Bearer abcdefghijklmnop1234" x')).toContain('[secret]');
    expect(redact('echo sk-ant-api03-abcdefghijklmnop')).toBe('echo [key]');
    expect(redact('git clone https://user:hunter2@host/x')).toBe('git clone https://user:[secret]@host/x');
  });
  it('leaves ordinary commands alone', () => {
    expect(redact('npm test -- --run')).toBe('npm test -- --run');
  });
  it('flattens and cuts', () => {
    expect(auditText('a\n  b', 10)).toBe('a b');
    expect(auditText('x'.repeat(50), 10)).toHaveLength(10);
  });
});

describe('stuck', () => {
  it('flags the tenth edit and the third failure', () => {
    expect(stuckReason({ file: 'a.ts', edits: 9 })).toBeUndefined();
    expect(stuckReason({ file: 'a.ts', edits: 10 })).toContain('a.ts');
    expect(stuckReason({ command: 'npm test', fails: 2 })).toBeUndefined();
    expect(stuckReason({ command: 'npm test', fails: 3 })).toContain('npm test');
  });
});

describe('helpers', () => {
  it('median', () => { expect(median([])).toBeNull(); expect(median([3, 1, 2])).toBe(2); expect(median([1, 2, 3, 4])).toBe(2.5); });
  it('commandKey takes two words for git-like tools', () => {
    expect(commandKey('git commit -m x')).toBe('git commit');
    expect(commandKey('ls -la')).toBe('ls');
    expect(commandKey('')).toBe('');
  });
  it('weekOf is Monday', () => { expect(new Date(weekOf(NOW)).getDay()).toBe(1); expect(weekOf(NOW)).toBeLessThanOrEqual(NOW); });
  it('toCsv quotes', () => { expect(toCsv([['a,b', 'c"d', 1]])).toBe('"a,b","c""d",1\n'); });
  it('projectWindow extrapolates and says when the cap is hit', () => {
    const week = 7 * DAY;
    const resets = (NOW + week / 2) / 1000; // half way through
    const p = projectWindow(0.6, resets, week, NOW)!;
    expect(p.projected).toBeCloseTo(1.2);
    expect(p.hitsAt).toBeGreaterThan(NOW - 1);
    expect(p.hitsAt).toBeLessThan(NOW + week / 2);
    expect(projectWindow(0.2, resets, week, NOW)!.hitsAt).toBeUndefined();
    expect(projectWindow(0.2, (NOW - 1000) / 1000, week, NOW)).toBeNull();
  });
});

describe('spend', () => {
  it('totals the period only, fills quiet days, and splits by repo and model', () => {
    const r = spendReport(input({ daily: [use(0), use(1, { repoId: 'o/q', model: 'opus', cost: 3 }), use(30)] }));
    expect(r.total.cost).toBe(4);
    expect(r.days).toHaveLength(7);
    expect(r.days.filter((d) => d.cost === 0)).toHaveLength(5);
    expect(r.byRepo[0]).toMatchObject({ id: 'o/q', cost: 3 });
    expect(r.byModel.map((m) => m.id)).toEqual(['opus', 'sonnet']);
    expect(r.perMonth).toBeCloseTo((4 / 7) * 30);
  });
  it('cache hit is cache reads over all input', () => {
    expect(spendReport(input({ daily: [use(0, { input: 100, cacheRead: 300 })] })).cacheHit).toBeCloseTo(0.75);
  });
  it('never reports negative spend', () => {
    expect(spendReport(input({ daily: [use(0, { cost: -2 }), use(0, { cost: 1 })] })).total.cost).toBe(1);
  });
  it('is empty without data', () => {
    const r = spendReport(input());
    expect(r.total.cost).toBe(0);
    expect(r.cacheHit).toBe(0);
    expect(r.fiveHour).toBeNull();
  });
});

describe('outcomes', () => {
  const merged = session({ id: 'm', mergedAt: NOW - DAY, cost: 4, commits: [{ hash: 'a', at: NOW - 2 * DAY + 1 }, { hash: 'b', at: NOW }], add: 80, del: 20 });
  const pr = session({ id: 'p', prUrl: 'u', cost: 2 });
  const dead = session({ id: 'd', archivedAt: NOW - DAY, cost: 6 });
  const open = session({ id: 'o', cost: 0 });
  it('classifies', () => {
    expect([merged, pr, dead, open].map(outcomeOf)).toEqual(['merged', 'pr', 'abandoned', 'open']);
  });
  it('costs per merged session, commit and hundred lines, and the waste share', () => {
    const r = buildReport(input({ sessions: [merged, pr, dead, open] })).outcomes;
    expect(r.costPerMerged).toBe(4);
    expect(r.costPerCommitMerged).toBe(2);
    expect(r.costPer100Lines).toBe(4);
    expect(r.wasteShare).toBeCloseTo(6 / 12);
    expect(r.rows[0].id).toBe('d');
  });
  it('has no cost per merged when nothing merged', () => {
    expect(buildReport(input({ sessions: [dead] })).outcomes.costPerMerged).toBeNull();
  });
});

describe('throughput', () => {
  it('measures time waiting on you from the timeline', () => {
    const s = session({ timeline: [{ t: NOW - 3000, status: 'working' }, { t: NOW - 2000, status: 'attention' }, { t: NOW - 500, status: 'working' }, { t: NOW - 100, status: 'ready' }] });
    expect(timeInStatus(s, NOW)).toEqual({ working: 1000 + 400, attention: 1500, ready: 0 });
    const r = throughputReport(input({ sessions: [s] }));
    expect(r.waiting.total).toBe(1500);
    expect(r.waiting.share).toBeCloseTo(1500 / 2900);
  });
  it('lead times are medians from the start', () => {
    const mk = (id: string, commit: number, merge: number) => session({ id, commits: [{ hash: 'x', at: NOW - 2 * DAY + commit }], mergedAt: NOW - 2 * DAY + merge, prAt: NOW - 2 * DAY + merge - 10 });
    const r = throughputReport(input({ sessions: [mk('a', 100, 1000), mk('b', 300, 3000), mk('c', 200, 2000)] }));
    expect(r.leadTime).toEqual({ firstCommit: 200, pullRequest: 1990, merged: 2000 });
  });
  it('counts started, merged and abandoned per week', () => {
    const r = throughputReport(input({ days: 14, sessions: [session({ id: 'a', mergedAt: NOW - DAY }), session({ id: 'b', archivedAt: NOW - DAY })] }));
    const total = (k: 'started' | 'merged' | 'abandoned') => r.weeks.reduce((n, w) => n + w[k], 0);
    expect([total('started'), total('merged'), total('abandoned')]).toEqual([2, 1, 1]);
  });
});

describe('approvals', () => {
  it('counts decisions and groups by command', () => {
    const audit = [ask('npm test --run', 'approved', 2000), ask('npm test', 'always', 4000), ask('rm -rf build', 'denied', 6000), { ...ask('ls', 'approved'), t: NOW - 20 * DAY }];
    const r = approvalReport(input({ audit }));
    expect([r.total, r.approved, r.always, r.denied]).toEqual([3, 1, 1, 1]);
    expect(r.medianWaitMs).toBe(4000);
    expect(r.byCommand[0]).toMatchObject({ key: 'npm test', approved: 1, always: 1 });
  });
  it('suggests commands approved five times, never denied, not already allowed', () => {
    const many = (cmd: string, n: number) => Array.from({ length: n }, () => ask(cmd, 'approved'));
    const audit = [...many('npm test', 6), ...many('make build', 5), ...many('docker run x', 7), ask('docker run y', 'denied'), ...many('git push', 4)];
    const r = approvalReport(input({ audit, alwaysAllow: ['make build *'] }));
    expect(r.suggestions.map((x) => x.pattern)).toEqual(['npm test *']);
  });
});

describe('quality', () => {
  it('sums tools, finds stuck sessions and the fullest contexts, and hot files across sessions', () => {
    const a = session({ id: 'a', tools: { Read: { n: 5, err: 1 }, Bash: { n: 2, err: 0 } }, stuck: 'x', ctx: 150_000, filesTouched: { 'src/a.ts': { add: 3, del: 1 } }, fileEdits: { 'src/a.ts': 6 } });
    const b = session({ id: 'b', tools: { Read: { n: 1, err: 0 } }, ctx: 20_000, filesTouched: { 'src/a.ts': { add: 1, del: 0 }, 'src/b.ts': { add: 9, del: 9 } } });
    const r = qualityReport(input({ sessions: [a, b] }));
    expect(r.tools[0]).toEqual({ name: 'Read', n: 6, err: 1 });
    expect(r.stuck).toEqual([{ id: 'a', repoId: 'o/r', reason: 'x' }]);
    expect(r.context[0]).toMatchObject({ id: 'a', pct: 0.75 });
    expect(r.hotFiles[0]).toMatchObject({ path: 'src/a.ts', sessions: 2, edits: 6 });
    expect(r.churn).toEqual([{ id: 'a', repoId: 'o/r', file: 'src/a.ts', edits: 6 }]);
  });
  it('leaves archived sessions out of the stuck list', () => {
    expect(qualityReport(input({ sessions: [session({ stuck: 'x', archivedAt: 1 })] })).stuck).toEqual([]);
  });
});

describe('digest', () => {
  it('is Markdown naming what merged and what waits', () => {
    const md = digestMarkdown(input({ daily: [use(0, { cost: 5 })], sessions: [session({ id: 'm', title: 'Add login', mergedAt: NOW - DAY, cost: 5 }), session({ id: 'w', status: 'attention', title: 'Fix cart' })] }), (v) => '$' + v.toFixed(2));
    expect(md).toContain('# helm digest');
    expect(md).toContain('Add login');
    expect(md).toMatch(/Fix cart: waiting on you/);
    expect(md).toContain('$5.00');
  });
  it('copes with nothing at all', () => {
    expect(digestMarkdown(input(), (v) => String(v))).toContain('Nothing merged');
  });
});

import { hunkId, hunkPatch, validHunk } from '../src/shared/hunks';
import { forecastable, overlap, parseMergeTree } from '../src/shared/forecast';
import { blockers, parseReview } from '../src/shared/selfreview';
import type { DiffHunk } from '../src/shared/types';

describe('hunks', () => {
  const h: DiffHunk = { header: '@@ -3,4 +3,4 @@ fn', lines: [[' ', 3, 3, 'a'], ['-', 4, null, 'old'], ['+', null, 4, 'new'], [' ', 5, 5, 'b']] };
  it('has an id that ignores line numbers and context', () => {
    const moved: DiffHunk = { header: '@@ -30,4 +30,4 @@', lines: [[' ', 30, 30, 'zzz'], ['-', 31, null, 'old'], ['+', null, 31, 'new']] };
    expect(hunkId('f.ts', h)).toBe(hunkId('f.ts', moved));
    expect(hunkId('g.ts', h)).not.toBe(hunkId('f.ts', h));
    expect(hunkId('f.ts', { ...h, lines: [['+', null, 4, 'other']] })).not.toBe(hunkId('f.ts', h));
  });
  it('builds a patch git can apply', () => {
    const p = hunkPatch('src/f.ts', h);
    expect(p).toContain('--- a/src/f.ts\n+++ b/src/f.ts\n@@ -3,4 +3,4 @@ fn\n a\n-old\n+new\n b\n');
  });
  it('accepts the shape the diff reader makes and nothing else', () => {
    expect(validHunk(h)).toBe(true);
    expect(validHunk({ ...h, header: '@@ -1 +1 @@\ndiff --git a/../../etc/passwd b/../../etc/passwd' })).toBe(false);
    expect(validHunk({ ...h, header: 'diff --git a/x b/x' })).toBe(false);
    expect(validHunk({ ...h, lines: [['+', null, 1, 'a\n--- a/other']] })).toBe(false);
    expect(validHunk({ ...h, lines: [['!', null, 1, 'a']] as any })).toBe(false);
    expect(validHunk({ ...h, lines: [] })).toBe(false);
    expect(validHunk(null as any)).toBe(false);
  });
  it('marks added and removed files', () => {
    expect(hunkPatch('n.ts', { header: '@@ -0,0 +1,1 @@ new file', lines: [['+', null, 1, 'x']] })).toContain('new file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,1 @@\n+x');
    expect(hunkPatch('d.ts', { header: '@@ -1,1 +0,0 @@', lines: [['-', 1, null, 'x']] })).toContain('deleted file mode 100644\n--- a/d.ts\n+++ /dev/null');
  });
});

describe('conflict forecast', () => {
  it('reads conflicted paths from merge-tree output', () => {
    expect(parseMergeTree('abc123\nsrc/a.ts\nsrc/b.ts\n\nAuto-merging x\n')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(parseMergeTree('abc123\n')).toEqual([]);
  });
  it('finds files two sessions both touched', () => {
    const a = session({ filesTouched: { 'a.ts': { add: 1, del: 0 }, 'b.ts': { add: 1, del: 0 } } });
    const b = session({ filesTouched: { 'b.ts': { add: 1, del: 0 }, 'c.ts': { add: 1, del: 0 } } });
    expect(overlap(a, b)).toEqual(['b.ts']);
  });
  it('compares only live sessions with changes', () => {
    expect(forecastable(session({ files: 1 }))).toBe(true);
    expect(forecastable(session())).toBe(false);
    expect(forecastable(session({ files: 1, mergedAt: 1 }))).toBe(false);
    expect(forecastable(session({ files: 1, archivedAt: 1 }))).toBe(false);
  });
});

describe('self review', () => {
  it('reads structured output and normalises findings', () => {
    const r = parseReview({ summary: ' ok ', findings: [{ severity: 'blocker', file: 'a.ts', line: 3, text: 'bad' }, { severity: 'weird', text: 'hm' }, { text: '  ' }] }, '');
    expect(r).toEqual({ summary: 'ok', findings: [{ severity: 'blocker', file: 'a.ts', line: 3, text: 'bad' }, { severity: 'note', file: undefined, line: undefined, text: 'hm' }] });
  });
  it('falls back to JSON in the text, fenced or bare', () => {
    expect(parseReview(undefined, 'Here:\n```json\n{"summary":"fine","findings":[]}\n```')).toEqual({ summary: 'fine', findings: [] });
    expect(parseReview(undefined, 'blah {"summary":"fine","findings":[]} end')).toEqual({ summary: 'fine', findings: [] });
    expect(parseReview(undefined, 'no json here')).toBeNull();
  });
  it('counts blockers only for a finished review', () => {
    const base = { at: 1, head: 'h', summary: '', findings: [{ severity: 'blocker' as const, text: 'x' }, { severity: 'note' as const, text: 'y' }] };
    expect(blockers({ ...base, state: 'done' })).toBe(1);
    expect(blockers({ ...base, state: 'running' })).toBe(0);
    expect(blockers(undefined)).toBe(0);
  });
});
