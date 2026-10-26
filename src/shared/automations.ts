/** Automated agents: a prompt that helm starts a session for on a schedule, or when something happens on GitHub. */

export type ScheduleEvery = 'hour' | 'day' | 'weekday' | 'week';

export type AutomationTrigger =
  | { type: 'schedule'; every: ScheduleEvery; /** HH:MM local time, for day, weekday and week. */ time: string; /** 0 (Sunday) to 6, for week. */ day: number }
  | { type: 'pull_request' }
  | { type: 'merge' }
  | { type: 'issue' }
  | { type: 'workflow_success' }
  | { type: 'workflow_failure' };

export interface AutomatedAgent {
  id: string;
  name: string;
  /** What the agent is asked to do each time it starts. May use {{repo}}, {{number}}, {{title}}, {{url}} and {{branch}}; for a workflow run {{number}} is the run number and {{title}} names the workflow. */
  prompt: string;
  /** `global` runs in every repository; otherwise a repository id (`owner/name`). */
  scope: string;
  trigger: AutomationTrigger;
  enabled: boolean;
  model: 'sonnet' | 'opus' | 'haiku';
  permMode: 'ask' | 'edits' | 'plan' | 'all';
  /** Spend limit for each session it starts. */
  budget: number;
  createdAt: number;
  /** When it last fired, for a schedule to know what it has missed. */
  lastRun?: number;
}

/** What an event trigger saw on a repository: the numbers already dealt with, per kind. A kind that is missing has not been looked at yet. */
export type AutomationSeen = Partial<Record<(typeof EVENT_KINDS)[number], number[]>>;

/** One thing that happened, which starts a session. */
export interface AutomationEvent {
  kind: (typeof EVENT_KINDS)[number] | 'schedule';
  number?: number;
  title?: string;
  url?: string;
  branch?: string;
  base?: string;
}

export const EVENT_KINDS = ['pull_request', 'merge', 'issue', 'workflow_success', 'workflow_failure'] as const;

export const TRIGGER_LABELS: Record<AutomationTrigger['type'], string> = {
  schedule: 'On a schedule',
  pull_request: 'When a pull request is opened',
  merge: 'When a pull request is merged',
  issue: 'When an issue is opened',
  workflow_success: 'When a GitHub Actions run succeeds',
  workflow_failure: 'When a GitHub Actions run fails'
};

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const parseTime = (t: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  const h = m ? Math.min(23, +m[1]) : 9;
  const mi = m ? Math.min(59, +m[2]) : 0;
  return [h, mi];
};

export function describeTrigger(t: AutomationTrigger): string {
  if (t.type !== 'schedule') return TRIGGER_LABELS[t.type];
  const [h, m] = parseTime(t.time);
  const at = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return t.every === 'hour' ? 'Every hour' : t.every === 'day' ? `Every day at ${at}` : t.every === 'weekday' ? `Weekdays at ${at}` : `${DAYS[t.day] ?? 'Monday'}s at ${at}`;
}

/** The latest moment at or before `now` that a schedule was due. */
export function lastSlot(t: Extract<AutomationTrigger, { type: 'schedule' }>, now: number): number {
  const d = new Date(now);
  if (t.every === 'hour') { d.setMinutes(0, 0, 0); return d.getTime(); }
  const [h, m] = parseTime(t.time);
  d.setHours(h, m, 0, 0);
  const ok = (x: Date) => (t.every === 'weekday' ? x.getDay() >= 1 && x.getDay() <= 5 : t.every === 'week' ? x.getDay() === t.day : true);
  // Step back day by day (setDate keeps the wall-clock time across daylight saving changes) until a slot that is not in the future.
  for (let i = 0; i < 8; i++) {
    if (d.getTime() <= now && ok(d)) return d.getTime();
    d.setDate(d.getDate() - 1);
  }
  return d.getTime();
}

/** Whether a schedule has come due since it last ran. A schedule that missed several slots fires once. */
export function scheduleDue(a: Pick<AutomatedAgent, 'trigger' | 'lastRun' | 'createdAt'>, now: number): boolean {
  if (a.trigger.type !== 'schedule') return false;
  return (a.lastRun ?? a.createdAt) < lastSlot(a.trigger, now);
}

/**
 * Compares what GitHub lists now with what was seen before. The first look at a kind only records, so existing pull requests and
 * issues do not all start agents. Returns the new numbers (oldest first) and the numbers to remember.
 */
export function freshNumbers(seen: number[] | undefined, current: number[], cap = 500): { fresh: number[]; seen: number[] } {
  const known = new Set(seen ?? []);
  const fresh = seen ? current.filter((n) => !known.has(n)).sort((a, b) => a - b) : [];
  const all = [...new Set([...(seen ?? []), ...current])].sort((a, b) => a - b);
  return { fresh, seen: all.length > cap ? all.slice(all.length - cap) : all };
}

export const applies = (a: Pick<AutomatedAgent, 'scope'>, repoId: string) => a.scope === 'global' || a.scope === repoId;

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in vars ? vars[k] : m));

/** Whether a finished run counts as a success, a failure, or neither (cancelled and skipped runs start nothing). */
export function runOutcome(conclusion: string | null): 'workflow_success' | 'workflow_failure' | null {
  if (conclusion === 'success') return 'workflow_success';
  return conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' ? 'workflow_failure' : null;
}

/** The task a session starts with: what set it off, then the agent's prompt. */
export function automationTask(a: Pick<AutomatedAgent, 'name' | 'prompt' | 'trigger'>, ev: AutomationEvent, repoName: string): string {
  const vars = { repo: repoName, number: ev.number != null ? String(ev.number) : '', title: ev.title ?? '', url: ev.url ?? '', branch: ev.branch ?? '' };
  const what =
    ev.kind === 'pull_request' ? `pull request #${ev.number} was opened: ${ev.title}` :
    ev.kind === 'merge' ? `pull request #${ev.number} was merged: ${ev.title}` :
    ev.kind === 'issue' ? `issue #${ev.number} was opened: ${ev.title}` :
    ev.kind === 'workflow_success' ? `GitHub Actions run ${ev.title} succeeded${ev.branch ? ' on ' + ev.branch : ''}` :
    ev.kind === 'workflow_failure' ? `GitHub Actions run ${ev.title} failed${ev.branch ? ' on ' + ev.branch : ''}` : `its schedule (${describeTrigger(a.trigger).toLowerCase()}) came due`;
  const head = `Automated agent “${a.name}” in ${repoName}: ${what}.${ev.url ? '\n' + ev.url : ''}`;
  return `${head}\n\n${fill(a.prompt.trim(), vars)}`;
}

/** A problem with an agent's settings, in words, or null. */
export function validateAgent(a: Pick<AutomatedAgent, 'name' | 'prompt' | 'scope' | 'trigger' | 'budget'>): string | null {
  if (!a.name.trim()) return 'Give the agent a name.';
  if (!a.prompt.trim()) return 'Say what the agent should do.';
  if (!a.scope) return 'Choose where the agent runs.';
  if (!(a.budget >= 0)) return 'The budget must be a number.';
  if (a.trigger.type === 'schedule' && a.trigger.every !== 'hour' && !/^\d{1,2}:\d{2}$/.test(a.trigger.time)) return 'Enter the time as HH:MM.';
  return null;
}
