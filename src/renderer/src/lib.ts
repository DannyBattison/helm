import type { AppState, Repo, Session, Status } from '@shared/types';

export const STATUS_LABEL: Record<Status, string> = { working: 'Working', attention: 'Needs you', ready: 'Ready for review', idle: 'Done', error: 'Failed' };

export const tilde = (p: string, home: string) => (home && p.toLowerCase().startsWith(home.toLowerCase()) ? '~' + p.slice(home.length).replace(/\\/g, '/') : p.replace(/\\/g, '/'));

export function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2).replace(/0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
}

export const lifetimeTokens = (l?: { input: number; output: number; cacheRead: number }) => (l ? l.input + l.output + l.cacheRead : 0);

export const money = (n: number) => '$' + n.toFixed(2);

export function elapsed(from: number, to?: number): string {
  const m = Math.max(0, Math.floor(((to ?? Date.now()) - from) / 60000));
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h ' + (m % 60 ? (m % 60) + 'm' : '').trim();
}

export function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

export const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function relTime(t: number): string {
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return clock(t);
  const days = Math.floor((today.getTime() - t) / 86400000);
  if (days <= 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export const sessionTokens = (s: Session) => s.tokens.input + s.tokens.output + s.tokens.cacheRead;

export function totals(app: AppState) {
  const c = (st: Status) => app.sessions.filter((s) => s.status === st).length;
  const spent = Object.values(app.weekSpend).reduce((a, b) => a + b, 0);
  return { working: c('working'), attention: c('attention'), ready: c('ready'), idle: c('idle'), spent, cap: app.settings.weeklyLimit, tokens: app.tokensToday };
}

export const reposWithSessions = (app: AppState) => app.repos.map((r) => ({ repo: r, sessions: app.sessions.filter((s) => s.repoId === r.id) }));

export const repoOf = (app: AppState, s: Session): Repo | undefined => app.repos.find((r) => r.id === s.repoId);

export const MODEL_LABEL = { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku' } as const;

export function prettyModel(s: Session): string {
  const m = s.modelName?.match(/(opus|sonnet|haiku)[-_ ]?(\d+)?[-_.]?(\d+)?/i);
  if (!m) return MODEL_LABEL[s.model];
  const name = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
  return m[2] ? `${name} ${m[2]}${m[3] && m[3].length < 3 ? '.' + m[3] : ''}` : name;
}

/** Lane geometry: a 110 minute window ending 6 minutes after now, so "now" sits at 104/110. */
export const LANE_MIN = 110;
export const NOW_AT = 104;
export function laneData(s: Session, now = Date.now()) {
  const start = now - NOW_AT * 60000;
  const toMin = (t: number) => (t - start) / 60000;
  const segs: [number, number, Status][] = [];
  s.timeline.forEach((e, i) => {
    if (e.status === 'idle' || e.status === 'error') return;
    const end = i + 1 < s.timeline.length ? s.timeline[i + 1].t : s.endedAt ?? now;
    const a = Math.max(0, toMin(e.t)), b = Math.min(NOW_AT, toMin(end));
    if (b > a) segs.push([a, Math.max(b, a + 0.6), e.status]);
  });
  const marks = s.commits.map((c) => toMin(c.at)).filter((m) => m >= 0 && m <= NOW_AT);
  return { segs, marks };
}

export function laneAxis(now = Date.now()): [number, string][] {
  const start = now - NOW_AT * 60000;
  const out: [number, string][] = [];
  const t = new Date(start);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() < 30 ? 30 : 60);
  for (let d = t.getTime(); d < now - 8 * 60000; d += 30 * 60000) {
    const dd = new Date(d);
    out.push([(d - start) / 60000, dd.getHours() + ':' + String(dd.getMinutes()).padStart(2, '0')]);
  }
  out.push([NOW_AT, 'now']);
  return out;
}

export function theme(pref: string): 'dark' | 'light' {
  if (pref === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref === 'light' ? 'light' : 'dark';
}

export function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html', py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', rb: 'ruby', sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'ini', sql: 'sql', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', tf: 'hcl', xml: 'xml', vue: 'html' };
  return map[ext] || 'plaintext';
}

/** Checks the agent ran: tests, linters, type checks and builds that succeeded. */
export const CHECK_RE = /\b(test|vitest|jest|pytest|lint|eslint|golangci-lint|typecheck|tsc|build|check|clippy|mypy|cargo test|go test)\b/i;

export function untilReset(resetsAtSec: number): string {
  const m = Math.max(0, Math.round((resetsAtSec * 1000 - Date.now()) / 60000));
  if (m < 90) return m + 'm';
  if (m < 48 * 60) return Math.round(m / 60) + 'h';
  return Math.round(m / 1440) + 'd';
}

/** Plan windows that have not reset yet. A window past its reset time reads as unknown, not as the old number. */
export function livePlan(app: AppState) {
  const ok = (w?: { util: number; resetsAt: number }) => (w && w.resetsAt * 1000 > Date.now() ? w : undefined);
  return { fiveHour: ok(app.plan.fiveHour), weekly: ok(app.plan.weekly) };
}

export const subagentTree = (s: Session) => {
  const out: { a: Session['subagents'][number]; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of s.subagents || []) if (a.parentId === parent) { out.push({ a, depth }); walk(a.id, depth + 1); }
  };
  walk(null, 0);
  return out;
};
export const runningSubagents = (s: Session) => (s.subagents || []).filter((a) => a.status === 'working').length;
