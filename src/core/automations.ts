import type { Issue, PullRequest } from '../shared/types';
import { applies, automationTask, freshNumbers, scheduleDue, validateAgent, type AutomatedAgent, type AutomationEvent } from '../shared/automations';
import type { Store } from './store';
import { uid } from './util';

/** What the runner needs from the rest of helm, so it can be tested without GitHub or a real session. */
export interface AutomationDeps {
  listPulls(repoId: string): Promise<PullRequest[]>;
  listIssues(repoId: string): Promise<Issue[]>;
  start(repoId: string, base: string, task: string, agent: AutomatedAgent): Promise<void>;
  /** Branches of sessions that automated agents started, so their pull requests do not start more agents. */
  automatedBranches(repoId: string): Set<string>;
  repoName(repoId: string): string;
  defaultBranch(repoId: string): string;
  changed(): void;
}

/** The most sessions one agent starts for one poll, so a burst of events cannot flood helm. */
const PER_POLL = 5;

export class Automations {
  private busy = false;
  constructor(private store: Store, private deps: AutomationDeps, private now: () => number = Date.now) {}

  get agents() { return this.store.data.automations; }

  save(input: Omit<AutomatedAgent, 'id' | 'createdAt' | 'lastRun'> & { id?: string }): string {
    const problem = validateAgent(input);
    if (problem) throw new Error(problem);
    if (input.scope !== 'global' && !this.store.data.repos.some((r) => r.id === input.scope)) throw new Error('Repository not found');
    const old = input.id ? this.agents.find((a) => a.id === input.id) : undefined;
    const next: AutomatedAgent = { ...input, name: input.name.trim(), prompt: input.prompt.trim(), id: old?.id ?? uid(), createdAt: old?.createdAt ?? this.now(), lastRun: old?.lastRun };
    // A changed schedule starts counting from now, so editing it does not fire for a slot that passed earlier.
    if (old && JSON.stringify(old.trigger) !== JSON.stringify(next.trigger)) next.lastRun = this.now();
    if (old) this.agents.splice(this.agents.indexOf(old), 1, next); else this.agents.push(next);
    this.store.save();
    this.deps.changed();
    return next.id;
  }

  remove(id: string) {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) return;
    this.agents.splice(i, 1);
    this.store.save();
    this.deps.changed();
  }

  /** Starts an agent now, once in each repository it covers. */
  async runNow(id: string): Promise<number> {
    const a = this.agents.find((x) => x.id === id);
    if (!a) throw new Error('Automated agent not found');
    const n = await this.fire(a, this.repoIds(a), { kind: 'schedule' });
    a.lastRun = this.now();
    this.store.save();
    this.deps.changed();
    return n;
  }

  private repoIds(a: AutomatedAgent): string[] {
    return this.store.data.repos.filter((r) => applies(a, r.id)).map((r) => r.id);
  }

  private async fire(a: AutomatedAgent, repoIds: string[], ev: AutomationEvent): Promise<number> {
    let started = 0;
    for (const repoId of repoIds) {
      try {
        const base = ev.kind === 'pull_request' && ev.branch ? 'origin/' + ev.branch : ev.base || this.deps.defaultBranch(repoId);
        await this.deps.start(repoId, base, automationTask(a, ev, this.deps.repoName(repoId)), a);
        started++;
      } catch (e) {
        this.store.log({ kind: 'start', who: 'helm', what: `automated agent “${a.name}” could not start`, repo: this.deps.repoName(repoId), detail: String((e as Error)?.message || e), ok: false });
      }
    }
    return started;
  }

  /** Starts schedules that have come due and looks for new pull requests, merges and issues. Safe to call often. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = this.now();
      const on = this.agents.filter((a) => a.enabled);
      for (const a of on) {
        if (!scheduleDue(a, now)) continue;
        a.lastRun = now;
        this.store.save();
        await this.fire(a, this.repoIds(a), { kind: 'schedule' });
      }
      const events = on.filter((a) => a.trigger.type !== 'schedule');
      for (const repo of this.store.data.repos) {
        const here = events.filter((a) => applies(a, repo.id));
        if (here.length) await this.poll(repo.id, here);
      }
    } finally { this.busy = false; this.deps.changed(); }
  }

  private async poll(repoId: string, agents: AutomatedAgent[]) {
    const want = new Set(agents.map((a) => a.trigger.type));
    const seen = (this.store.data.automationSeen[repoId] ||= {});
    const found: AutomationEvent[] = [];
    try {
      if (want.has('pull_request') || want.has('merge')) {
        const prs = await this.deps.listPulls(repoId);
        const own = this.deps.automatedBranches(repoId);
        if (want.has('pull_request')) {
          const r = freshNumbers(seen.pull_request, prs.map((p) => p.number));
          seen.pull_request = r.seen;
          for (const n of r.fresh) {
            const p = prs.find((x) => x.number === n)!;
            if (p.state === 'open' && !own.has(p.branch)) found.push({ kind: 'pull_request', number: n, title: p.title, url: p.url, branch: p.branch, base: p.base });
          }
        }
        if (want.has('merge')) {
          const r = freshNumbers(seen.merge, prs.filter((p) => p.state === 'merged').map((p) => p.number));
          seen.merge = r.seen;
          for (const n of r.fresh) {
            const p = prs.find((x) => x.number === n)!;
            if (!own.has(p.branch)) found.push({ kind: 'merge', number: n, title: p.title, url: p.url, branch: p.branch, base: p.base });
          }
        }
      }
      if (want.has('issue')) {
        const issues = await this.deps.listIssues(repoId);
        const r = freshNumbers(seen.issue, issues.map((i) => i.number));
        seen.issue = r.seen;
        for (const n of r.fresh) { const i = issues.find((x) => x.number === n)!; found.push({ kind: 'issue', number: n, title: i.title, url: i.url }); }
      }
    } catch { return; /* offline, or no access: look again next time */ }
    this.store.save();
    for (const ev of found) {
      for (const a of agents.filter((x) => x.trigger.type === ev.kind)) {
        if (this.firedThisPoll(a) >= PER_POLL) continue;
        a.lastRun = this.now();
        await this.fire(a, [repoId], ev);
        this.counts.set(a.id, this.firedThisPoll(a) + 1);
      }
    }
    this.counts.clear();
  }

  private counts = new Map<string, number>();
  private firedThisPoll(a: AutomatedAgent) { return this.counts.get(a.id) ?? 0; }
}
