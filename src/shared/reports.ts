/** Reports are computed from what helm already keeps: sessions, the per-day usage ledger and the audit log. Nothing here touches Electron or the disk. */
import type { AuditEntry, DailyUsage, ModelAlias, PlanUsage, Session, Status } from './types';

export const DAY = 86_400_000;
/** Context window assumed when working out how full a session is. */
export const CONTEXT_WINDOW = 200_000;

export interface ReportInput {
  sessions: Session[];
  daily: DailyUsage[];
  audit: AuditEntry[];
  alwaysAllow: string[];
  plan?: PlanUsage;
  now: number;
  /** How many days back the report reaches. */
  days: number;
}

// ---------------------------------------------------------------- helpers
export const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Monday 00:00 local of the week containing t. */
export function weekOf(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const since = (input: ReportInput) => input.now - input.days * DAY;

/** The first one or two words of a command, which is what an "always allow" pattern would be built from. */
export function commandKey(cmd: string): string {
  const words = cmd.trim().split(/\s+/);
  if (!words[0]) return '';
  const two = ['git', 'npm', 'pnpm', 'yarn', 'go', 'cargo', 'make', 'docker', 'terraform', 'kubectl'].includes(words[0]);
  return (two ? words.slice(0, 2) : words.slice(0, 1)).join(' ');
}

/** Where a plan window is heading: at this pace, the usage by the time it resets, and when it would hit 100%. */
export function projectWindow(util: number, resetsAtSec: number, windowMs: number, now: number): { projected: number; hitsAt?: number } | null {
  const resets = resetsAtSec * 1000;
  const start = resets - windowMs;
  const elapsed = now - start;
  if (resets <= now || elapsed < windowMs * 0.02 || util <= 0) return null;
  const projected = util * (windowMs / elapsed);
  return { projected, hitsAt: projected > 1 ? start + elapsed / util : undefined };
}

// ---------------------------------------------------------------- spend
export interface SpendReport {
  total: { cost: number; tokens: number };
  days: { day: string; cost: number; tokens: number }[];
  byRepo: { id: string; cost: number; tokens: number }[];
  byModel: { id: ModelAlias; cost: number; tokens: number }[];
  byEffort: { id: string; cost: number; sessions: number }[];
  topSessions: { id: string; repoId: string; cost: number; tokens: number; model: ModelAlias }[];
  /** Share of input that was served from the prompt cache. */
  cacheHit: number;
  perDay: number;
  /** Cost over the last 30 days at the pace of the period. */
  perMonth: number;
  fiveHour: ReturnType<typeof projectWindow>;
  weekly: ReturnType<typeof projectWindow>;
}

export function spendReport(input: ReportInput): SpendReport {
  const from = dayKey(since(input));
  const rows = input.daily.filter((d) => d.day >= from);
  const tok = (d: DailyUsage) => d.input + d.output + d.cacheRead;
  const byDay = new Map<string, { cost: number; tokens: number }>();
  // Every day in the period appears, so a quiet day is a gap in the chart rather than a missing bar.
  for (let i = input.days - 1; i >= 0; i--) byDay.set(dayKey(input.now - i * DAY), { cost: 0, tokens: 0 });
  const group = <K extends string>(key: (d: DailyUsage) => K) => {
    const m = new Map<K, { cost: number; tokens: number }>();
    for (const d of rows) {
      const g = m.get(key(d)) ?? { cost: 0, tokens: 0 };
      g.cost += d.cost; g.tokens += tok(d);
      m.set(key(d), g);
    }
    return [...m].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.cost - a.cost);
  };
  for (const d of rows) {
    const g = byDay.get(d.day);
    if (g) { g.cost += d.cost; g.tokens += tok(d); }
  }
  const inputs = sum(rows.map((d) => d.input + d.cacheRead));
  const mine = input.sessions.filter((s) => s.startedAt >= since(input));
  const effort = new Map<string, { cost: number; sessions: number }>();
  for (const s of mine) {
    const e = effort.get(s.effort ?? 'default') ?? { cost: 0, sessions: 0 };
    e.cost += s.cost; e.sessions++;
    effort.set(s.effort ?? 'default', e);
  }
  const total = { cost: sum(rows.map((d) => d.cost)), tokens: sum(rows.map(tok)) };
  const perDay = total.cost / Math.max(1, input.days);
  return {
    total,
    days: [...byDay].map(([day, v]) => ({ day, ...v })),
    byRepo: group((d) => d.repoId),
    byModel: group((d) => d.model) as SpendReport['byModel'],
    byEffort: [...effort].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.cost - a.cost),
    topSessions: [...mine].sort((a, b) => b.cost - a.cost).slice(0, 8).map((s) => ({ id: s.id, repoId: s.repoId, cost: s.cost, tokens: s.tokens.input + s.tokens.output + s.tokens.cacheRead, model: s.model })),
    cacheHit: inputs ? sum(rows.map((d) => d.cacheRead)) / inputs : 0,
    perDay,
    perMonth: perDay * 30,
    fiveHour: input.plan?.fiveHour ? projectWindow(input.plan.fiveHour.util, input.plan.fiveHour.resetsAt, 5 * 3600_000, input.now) : null,
    weekly: input.plan?.weekly ? projectWindow(input.plan.weekly.util, input.plan.weekly.resetsAt, 7 * DAY, input.now) : null
  };
}

// ---------------------------------------------------------------- outcomes and throughput
export type Outcome = 'merged' | 'pr' | 'abandoned' | 'open';

/** Where a session ended up: merged, in a pull request, archived without either, or still in progress. */
export const outcomeOf = (s: Session): Outcome => (s.mergedAt ? 'merged' : s.prUrl ? 'pr' : s.archivedAt ? 'abandoned' : 'open');

export interface OutcomeReport {
  counts: Record<Outcome, number>;
  cost: Record<Outcome, number>;
  costPerMerged: number | null;
  costPerCommitMerged: number | null;
  /** Cost per hundred lines of merged change. */
  costPer100Lines: number | null;
  /** Spend that went on sessions that were abandoned, as a share of all spend in the period. */
  wasteShare: number;
  rows: { id: string; repoId: string; outcome: Outcome; cost: number; commits: number; lines: number; startedAt: number }[];
}

export function outcomeReport(input: ReportInput): OutcomeReport {
  const mine = input.sessions.filter((s) => s.startedAt >= since(input));
  const counts: Record<Outcome, number> = { merged: 0, pr: 0, abandoned: 0, open: 0 };
  const cost: Record<Outcome, number> = { merged: 0, pr: 0, abandoned: 0, open: 0 };
  const rows: OutcomeReport['rows'] = [];
  for (const s of mine) {
    const o = outcomeOf(s);
    counts[o]++; cost[o] += s.cost;
    rows.push({ id: s.id, repoId: s.repoId, outcome: o, cost: s.cost, commits: s.commits.length, lines: s.add + s.del, startedAt: s.startedAt });
  }
  const merged = mine.filter((s) => s.mergedAt);
  const commits = sum(merged.map((s) => s.commits.length));
  const lines = sum(merged.map((s) => s.add + s.del));
  const all = sum(mine.map((s) => s.cost));
  return {
    counts, cost,
    costPerMerged: merged.length ? cost.merged / merged.length : null,
    costPerCommitMerged: commits ? cost.merged / commits : null,
    costPer100Lines: lines ? (cost.merged / lines) * 100 : null,
    wasteShare: all ? cost.abandoned / all : 0,
    rows: rows.sort((a, b) => b.cost - a.cost)
  };
}

export interface ThroughputReport {
  weeks: { start: number; started: number; merged: number; abandoned: number }[];
  /** Medians in ms from the session's start. */
  leadTime: { firstCommit: number | null; pullRequest: number | null; merged: number | null };
  /** Time in each state, summed over sessions. Only working and needs-you are open-ended. */
  statusTime: Partial<Record<Status, number>>;
  /** Time agents sat waiting for you, and which sessions waited longest. */
  waiting: { total: number; share: number; sessions: { id: string; repoId: string; ms: number }[] };
}

/** How long a session spent in each status, from its timeline. */
export function timeInStatus(s: Session, now: number): Partial<Record<Status, number>> {
  const out: Partial<Record<Status, number>> = {};
  const tl = s.timeline;
  for (let i = 0; i < tl.length; i++) {
    const end = tl[i + 1]?.t ?? (tl[i].status === 'working' || tl[i].status === 'attention' ? now : tl[i].t);
    out[tl[i].status] = (out[tl[i].status] ?? 0) + Math.max(0, end - tl[i].t);
  }
  return out;
}

export function throughputReport(input: ReportInput): ThroughputReport {
  const weeks = new Map<number, { started: number; merged: number; abandoned: number }>();
  const wk = (t: number) => { const k = weekOf(t); const w = weeks.get(k) ?? { started: 0, merged: 0, abandoned: 0 }; weeks.set(k, w); return w; };
  const first = weekOf(since(input));
  for (let t = first; t <= input.now; t += 7 * DAY) wk(t);
  for (const s of input.sessions) {
    if (s.startedAt >= first) wk(s.startedAt).started++;
    if (s.mergedAt && s.mergedAt >= first) wk(s.mergedAt).merged++;
    else if (!s.mergedAt && !s.prUrl && s.archivedAt && s.archivedAt >= first) wk(s.archivedAt).abandoned++;
  }
  const mine = input.sessions.filter((s) => s.startedAt >= since(input));
  const statusTime: ThroughputReport['statusTime'] = {};
  const waits: { id: string; repoId: string; ms: number }[] = [];
  for (const s of mine) {
    const t = timeInStatus(s, input.now);
    for (const [k, v] of Object.entries(t)) statusTime[k as Status] = (statusTime[k as Status] ?? 0) + v!;
    if (t.attention) waits.push({ id: s.id, repoId: s.repoId, ms: t.attention });
  }
  const active = (statusTime.working ?? 0) + (statusTime.attention ?? 0);
  const num = (xs: (number | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && x >= 0);
  return {
    weeks: [...weeks].sort((a, b) => a[0] - b[0]).map(([start, v]) => ({ start, ...v })),
    leadTime: {
      firstCommit: median(num(mine.map((s) => (s.commits[0] ? s.commits[0].at - s.startedAt : undefined)))),
      pullRequest: median(num(mine.map((s) => (s.prAt ? s.prAt - s.startedAt : undefined)))),
      merged: median(num(mine.map((s) => (s.mergedAt ? s.mergedAt - s.startedAt : undefined))))
    },
    statusTime,
    waiting: { total: statusTime.attention ?? 0, share: active ? (statusTime.attention ?? 0) / active : 0, sessions: waits.sort((a, b) => b.ms - a.ms).slice(0, 6) }
  };
}

// ---------------------------------------------------------------- approvals
export interface ApprovalReport {
  total: number;
  approved: number;
  always: number;
  denied: number;
  medianWaitMs: number | null;
  byCommand: { key: string; approved: number; always: number; denied: number }[];
  /** Commands approved over and over that are not on the always-allow list. */
  suggestions: { key: string; pattern: string; count: number }[];
  /** Commands the agent ran that needed no approval, to show how much the allow-list already covers. */
  commandsRun: number;
}

/** Approvals needed before helm offers to always allow a command. */
export const SUGGEST_AFTER = 5;

export function approvalReport(input: ReportInput): ApprovalReport {
  const from = since(input);
  const rows = input.audit.filter((a) => a.t >= from);
  const asks = rows.filter((a) => a.kind === 'approval');
  const by = new Map<string, { approved: number; always: number; denied: number }>();
  for (const a of asks) {
    const k = commandKey(a.text) || a.text;
    const g = by.get(k) ?? { approved: 0, always: 0, denied: 0 };
    g[a.decision ?? 'approved']++;
    by.set(k, g);
  }
  const list = [...by].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.approved + b.always + b.denied - (a.approved + a.always + a.denied));
  const covered = (pattern: string) => input.alwaysAllow.includes(pattern);
  return {
    total: asks.length,
    approved: asks.filter((a) => a.decision === 'approved').length,
    always: asks.filter((a) => a.decision === 'always').length,
    denied: asks.filter((a) => a.decision === 'denied').length,
    medianWaitMs: median(asks.map((a) => a.waitMs ?? 0)),
    byCommand: list.slice(0, 15),
    suggestions: list.filter((x) => x.approved >= SUGGEST_AFTER && x.denied === 0 && x.key && !covered(x.key + ' *')).map((x) => ({ key: x.key, pattern: x.key + ' *', count: x.approved })).slice(0, 6),
    commandsRun: rows.filter((a) => a.kind === 'command').length
  };
}

// ---------------------------------------------------------------- quality
export interface QualityReport {
  tools: { name: string; n: number; err: number }[];
  stuck: { id: string; repoId: string; reason: string }[];
  context: { id: string; repoId: string; ctx: number; pct: number; model: ModelAlias }[];
  hotFiles: { repoId: string; path: string; sessions: number; add: number; del: number; edits: number }[];
  /** Files edited many times in one session without a commit. */
  churn: { id: string; repoId: string; file: string; edits: number }[];
}

export function qualityReport(input: ReportInput): QualityReport {
  const mine = input.sessions.filter((s) => s.startedAt >= since(input));
  const tools = new Map<string, { n: number; err: number }>();
  for (const s of mine) for (const [name, v] of Object.entries(s.tools ?? {})) {
    const t = tools.get(name) ?? { n: 0, err: 0 };
    t.n += v.n; t.err += v.err;
    tools.set(name, t);
  }
  const files = new Map<string, { repoId: string; path: string; sessions: Set<string>; add: number; del: number; edits: number }>();
  for (const s of mine) {
    for (const [path, v] of Object.entries(s.filesTouched ?? {})) {
      const k = s.repoId + '\0' + path;
      const f = files.get(k) ?? { repoId: s.repoId, path, sessions: new Set<string>(), add: 0, del: 0, edits: 0 };
      f.sessions.add(s.id); f.add += v.add; f.del += v.del; f.edits += s.fileEdits?.[path] ?? 0;
      files.set(k, f);
    }
  }
  return {
    tools: [...tools].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n),
    stuck: input.sessions.filter((s) => s.stuck && !s.archivedAt).map((s) => ({ id: s.id, repoId: s.repoId, reason: s.stuck! })),
    context: input.sessions
      .filter((s) => !s.archivedAt && s.ctx > 0)
      .map((s) => ({ id: s.id, repoId: s.repoId, ctx: s.ctx, pct: s.ctx / CONTEXT_WINDOW, model: s.model }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10),
    hotFiles: [...files.values()].map((f) => ({ ...f, sessions: f.sessions.size })).sort((a, b) => b.sessions - a.sessions || b.add + b.del - (a.add + a.del)).slice(0, 15),
    churn: mine.flatMap((s) => Object.entries(s.fileEdits ?? {}).filter(([, n]) => n >= 5).map(([file, edits]) => ({ id: s.id, repoId: s.repoId, file, edits }))).sort((a, b) => b.edits - a.edits).slice(0, 10)
  };
}

// ---------------------------------------------------------------- everything
export interface Report {
  days: number;
  at: number;
  spend: SpendReport;
  outcomes: OutcomeReport;
  throughput: ThroughputReport;
  approvals: ApprovalReport;
  quality: QualityReport;
}

export const buildReport = (input: ReportInput): Report => ({
  days: input.days, at: input.now,
  spend: spendReport(input), outcomes: outcomeReport(input), throughput: throughputReport(input), approvals: approvalReport(input), quality: qualityReport(input)
});

// ---------------------------------------------------------------- exports
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export const spendCsv = (input: ReportInput) =>
  toCsv([['day', 'repository', 'model', 'cost_usd', 'input_tokens', 'output_tokens', 'cache_read_tokens'], ...input.daily.filter((d) => d.day >= dayKey(since(input))).map((d) => [d.day, d.repoId, d.model, d.cost.toFixed(4), d.input, d.output, d.cacheRead])]);

export const sessionsCsv = (input: ReportInput) =>
  toCsv([
    ['session', 'repository', 'outcome', 'model', 'effort', 'started', 'cost_usd', 'tokens', 'commits', 'files', 'lines_added', 'lines_removed'],
    ...input.sessions.filter((s) => s.startedAt >= since(input)).map((s) => [s.id, s.repoId, outcomeOf(s), s.model, s.effort ?? '', new Date(s.startedAt).toISOString(), s.cost.toFixed(4), s.tokens.input + s.tokens.output + s.tokens.cacheRead, s.commits.length, s.files, s.add, s.del])
  ]);

export const auditCsv = (input: ReportInput) =>
  toCsv([['time', 'session', 'repository', 'kind', 'text', 'ok', 'decision', 'waited_ms'], ...input.audit.filter((a) => a.t >= since(input)).map((a) => [new Date(a.t).toISOString(), a.sessionId, a.repoId, a.kind, a.text, a.ok ?? '', a.decision ?? '', a.waitMs ?? ''])]);

export const fmtDuration = (ms: number | null): string => {
  if (ms == null) return '–';
  const m = ms / 60_000;
  if (m < 1) return Math.max(1, Math.round(ms / 1000)) + 's';
  if (m < 90) return Math.round(m) + 'm';
  const h = m / 60;
  return h < 48 ? h.toFixed(1).replace(/\.0$/, '') + 'h' : Math.round(h / 24) + 'd';
};

/** A Markdown summary of the period, for pasting into a standup, a PR or a channel. `usd` formats an amount in the display currency. */
export function digestMarkdown(input: ReportInput, usd: (v: number) => string): string {
  const r = buildReport(input);
  const from = new Date(since(input)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const to = new Date(input.now).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const mine = input.sessions.filter((s) => s.startedAt >= since(input) || (s.mergedAt ?? 0) >= since(input));
  const merged = mine.filter((s) => s.mergedAt && s.mergedAt >= since(input));
  const open = input.sessions.filter((s) => !s.archivedAt && !s.mergedAt);
  const title = (s: Session) => s.customTitle || s.title || s.task;
  const L: string[] = [`# helm digest · ${from} – ${to}`, ''];
  L.push(`**${r.spend.total.cost ? usd(r.spend.total.cost) : 'No spend'}** across ${r.outcomes.rows.length} sessions · ${merged.length} merged · ${r.outcomes.counts.abandoned} abandoned · ${r.approvals.total} approvals asked of you.`, '');
  L.push('## Merged');
  L.push(...(merged.length ? merged.map((s) => `- **${s.repoId}** ${title(s)} (${usd(s.cost)}, ${s.commits.length} commits, +${s.add}/−${s.del})`) : ['- Nothing merged in this period.']), '');
  const waiting = open.filter((s) => s.status === 'attention' || s.status === 'ready' || s.status === 'error' || s.stuck);
  L.push('## Needs attention');
  L.push(...(waiting.length ? waiting.map((s) => `- **${s.repoId}** ${title(s)}: ${s.stuck ? 'looks stuck, ' + s.stuck : s.status === 'ready' ? 'ready for review' : s.status === 'attention' ? 'waiting on you' : 'failed'}`) : ['- Nothing is waiting.']), '');
  L.push('## Spend');
  L.push(...r.spend.byRepo.slice(0, 5).map((x) => `- ${x.id}: ${usd(x.cost)}`));
  if (r.outcomes.costPerMerged != null) L.push(`- Average cost per merged session: ${usd(r.outcomes.costPerMerged)}`);
  if (r.outcomes.wasteShare > 0.01) L.push(`- ${Math.round(r.outcomes.wasteShare * 100)}% of spend went on sessions that were abandoned.`);
  L.push('', '## Time');
  L.push(`- Agents waited on you for ${fmtDuration(r.throughput.waiting.total)} (${Math.round(r.throughput.waiting.share * 100)}% of their active time).`);
  L.push(`- Median start to first commit ${fmtDuration(r.throughput.leadTime.firstCommit)}, to merge ${fmtDuration(r.throughput.leadTime.merged)}.`);
  if (r.approvals.suggestions.length) L.push('', '## Suggested allow rules', ...r.approvals.suggestions.map((x) => `- \`${x.pattern}\` (approved ${x.count} times)`));
  if (r.quality.stuck.length) L.push('', '## Stuck', ...r.quality.stuck.map((x) => `- ${x.repoId} ${x.id}: ${x.reason}`));
  return L.join('\n') + '\n';
}
