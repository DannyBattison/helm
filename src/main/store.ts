import { app } from 'electron';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActivityEvent, Lifetime, PlanUsage, Repo, Session, Settings, TranscriptEvent, User } from '../shared/types';
import { dayStart, home, weekStart } from './util';

/** helm's registered GitHub OAuth app. Client IDs are public; the device flow uses no secret. */
export const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liTYcKE5lBWCEAAV';

export const defaultSettings = (): Settings => ({
  theme: 'dark',
  githubClientId: process.env.HELM_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID,
  claudePath: '',
  defaultModel: 'sonnet',
  permMode: 'ask',
  alwaysAllow: [],
  runTests: true,
  worktreeRoot: join(home, '.helm', 'worktrees'),
  cloneRoot: join(home, 'code'),
  branchPrefix: 'agent/',
  removeAfterMerge: true,
  deliver: 'pr',
  copyFiles: '.env, .env.local',
  weeklyLimit: 100,
  sessionBudget: 10,
  warnAt: 80,
  archiveAfterDays: 14,
  remoteControl: false,
  maxSubagentsSession: 4,
  maxSubagentsRepo: 8,
  billing: 'subscription',
  billingDetected: false,
  currency: 'USD',
  currencyDetected: false,
  planPause5h: 0,
  planPauseWeek: 0,
  notifyAttention: { desktop: true, sound: true },
  notifyReady: { desktop: true, sound: false },
  notifyFailed: { desktop: true, sound: true },
  notifyChecks: { desktop: false, sound: false },
  dnd: true,
  editorFontSize: 12.5,
  uiFont: 'Mona Sans',
  dataFont: 'Monaspace Neon',
  editorFont: 'Monaspace Neon',
  editorLigatures: true,
  density: 'Compact',
  openIn: 'helm'
});

interface Persisted {
  user: User | null;
  repos: Repo[];
  sessions: Session[];
  activity: ActivityEvent[];
  settings: Settings;
  usage: { t: number; repoId: string; cost: number; tokens: number }[];
  plan: PlanUsage;
  /** Lifetime usage per repository id. */
  totals: Record<string, Lifetime>;
  /** Overrides for sessions started outside helm, by Claude session id. */
  extArchive: Record<string, 'archived' | 'restored'>;
  fx: { rates: Record<string, number>; at: number };
}

export class Store {
  data: Persisted = { user: null, repos: [], sessions: [], activity: [], settings: defaultSettings(), usage: [], plan: { at: 0 }, totals: {}, extArchive: {}, fx: { rates: {}, at: 0 } };
  private transcripts = new Map<string, TranscriptEvent[]>();
  private dir = '';
  private timer: NodeJS.Timeout | null = null;
  private tTimers = new Map<string, NodeJS.Timeout>();

  async load() {
    this.dir = app.getPath('userData');
    await mkdir(join(this.dir, 'transcripts'), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'helm.json'), 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...defaultSettings(), ...raw.settings } };
      if (!this.data.settings.githubClientId) this.data.settings.githubClientId = defaultSettings().githubClientId;
      // Sessions saved by older versions have no subagents.
      for (const x of this.data.sessions) { x.subagents ||= []; x.lastAccess ||= x.endedAt ?? x.startedAt; }
      this.data.extArchive ||= {};
      // Lifetime totals started later than sessions did: seed them from the sessions that exist, once.
      if (!raw.totals) {
        this.data.totals = {};
        for (const x of this.data.sessions) {
          const t = (this.data.totals[x.repoId] ||= { input: 0, output: 0, cacheRead: 0, cost: 0 });
          t.input += x.tokens.input; t.output += x.tokens.output; t.cacheRead += x.tokens.cacheRead; t.cost += x.cost;
        }
      }
    } catch { /* first run */ }
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 400);
  }

  async flush() {
    const file = join(this.dir, 'helm.json');
    await writeFile(file + '.tmp', JSON.stringify(this.data));
    await rename(file + '.tmp', file);
  }

  async transcript(id: string): Promise<TranscriptEvent[]> {
    let t = this.transcripts.get(id);
    if (!t) {
      try { t = JSON.parse(await readFile(join(this.dir, 'transcripts', id + '.json'), 'utf8')); } catch { t = []; }
      this.transcripts.set(id, t!);
    }
    return t!;
  }

  /** A session's transcript and those of its subagents (`<id>~<subagent>`). */
  async deleteTranscripts(id: string) {
    for (const [k, tm] of this.tTimers) if (k === id || k.startsWith(id + '~')) { clearTimeout(tm); this.tTimers.delete(k); }
    for (const k of [...this.transcripts.keys()]) if (k === id || k.startsWith(id + '~')) this.transcripts.delete(k);
    try {
      for (const f of await readdir(join(this.dir, 'transcripts'))) if (f === id + '.json' || f.startsWith(id + '~')) await rm(join(this.dir, 'transcripts', f), { force: true });
    } catch { /* nothing saved */ }
  }

  saveTranscript(id: string) {
    if (this.tTimers.has(id)) return;
    this.tTimers.set(id, setTimeout(async () => {
      this.tTimers.delete(id);
      const t = this.transcripts.get(id);
      if (!t) return;
      const file = join(this.dir, 'transcripts', id + '.json');
      await writeFile(file + '.tmp', JSON.stringify(t));
      await rename(file + '.tmp', file);
    }, 600));
  }

  async flushAll() {
    for (const [id, tm] of this.tTimers) {
      clearTimeout(tm);
      this.tTimers.delete(id);
      const t = this.transcripts.get(id);
      if (t) await writeFile(join(this.dir, 'transcripts', id + '.json'), JSON.stringify(t));
    }
    await this.flush();
  }

  private life(repoId: string): Lifetime {
    return (this.data.totals[repoId] ||= { input: 0, output: 0, cacheRead: 0, cost: 0 });
  }

  addLifetimeTokens(repoId: string, input: number, output: number, cacheRead: number) {
    const t = this.life(repoId);
    t.input += input; t.output += output; t.cacheRead += cacheRead;
    this.save();
  }

  addUsage(repoId: string, cost: number, tokens: number) {
    this.life(repoId).cost += cost;
    this.data.usage.push({ t: Date.now(), repoId, cost, tokens });
    const cutoff = Date.now() - 15 * 86400_000;
    if (this.data.usage.length > 5000) this.data.usage = this.data.usage.filter((u) => u.t >= cutoff);
    this.save();
  }

  weekSpend(): Record<string, number> {
    const from = weekStart();
    const out: Record<string, number> = {};
    for (const u of this.data.usage) if (u.t >= from) out[u.repoId] = (out[u.repoId] || 0) + u.cost;
    return out;
  }

  tokensToday(): number {
    const from = dayStart();
    return this.data.usage.reduce((a, u) => (u.t >= from ? a + u.tokens : a), 0);
  }
}
