import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutomationSeen } from '../shared/automations';
import type { ActivityEvent, AutomatedAgent, AuditEntry, DailyUsage, Lifetime, ModelAlias, PlanUsage, Repo, Session, Settings, TranscriptEvent, User } from '../shared/types';
import { defaultOutbound } from '../shared/outbound';
import type { Tombstone } from '../shared/sync';
import { dayStart, home, uid, weekStart } from './util';

/** helm's registered GitHub OAuth app. Client IDs are public; the device flow uses no secret. */
export const DEFAULT_GITHUB_CLIENT_ID = 'Ov23liTYcKE5lBWCEAAV';

export const defaultSettings = (): Settings => ({
  theme: 'dark',
  colorScheme: 'helm',
  accentColor: '',
  statusColors: {},
  githubClientId: process.env.HELM_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID,
  claudePath: '',
  defaultModel: 'sonnet',
  permMode: 'ask',
  alwaysAllow: [],
  runTests: true,
  resumeOnLaunch: false,
  autoPush: true,
  commitAuthor: 'coauthor',
  worktreeRoot: join(home, '.helm', 'worktrees'),
  freeRoot: join(home, '.helm', 'agents'),
  cloneRoot: join(home, 'code'),
  branchPrefix: 'agent/',
  removeAfterMerge: true,
  deleteBranchAfterMerge: true,
  deliver: 'pr',
  openPrAfterCreate: false,
  mergeMethod: 'merge',
  afterMerge: 'archive',
  copyFiles: '.env\n.env.local',
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
  maxRunning: 0,
  notifyAttention: { desktop: true, sound: true },
  notifyReady: { desktop: true, sound: false },
  notifyFailed: { desktop: true, sound: true },
  notifyChecks: { desktop: false, sound: false },
  outbound: defaultOutbound(),
  dnd: true,
  quiet: { enabled: false, from: '22:00', to: '08:00', allowAttention: true },
  notifyRepo: {},
  tray: true,
  autoUpdate: true,
  editorFontSize: 12.5,
  syncEnabled: false,
  companionEnabled: false,
  companionUrl: 'http://localhost:8787',
  companionControl: true,
  terminalShell: 'auto',
  terminalShellCustom: '',
  sendKey: 'mod-enter',
  shortcuts: {},
  interruptKey: 'esc',
  showOwner: true,
  freeAgents: true,
  tutorial: true,
  tutorialSeen: [],
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
  /** What sessions did and what the user decided, newest last, capped. */
  audit: AuditEntry[];
  /** Usage per day, repository and model, kept for good. */
  daily: DailyUsage[];
  automations: AutomatedAgent[];
  /** What event-driven automated agents have already looked at, per repository id. */
  automationSeen: Record<string, AutomationSeen>;
  /** This installation's identity for sync; never changes. */
  instanceId: string;
  /** What was deleted, so a sync deletes it on the other instances too rather than bringing it back. Dropped after 30 days. */
  deleted: Tombstone[];
}

export class Store {
  data: Persisted = { user: null, repos: [], sessions: [], activity: [], settings: defaultSettings(), usage: [], plan: { at: 0 }, totals: {}, extArchive: {}, fx: { rates: {}, at: 0 }, audit: [], daily: [], automations: [], automationSeen: {}, instanceId: '', deleted: [] };
  private transcripts = new Map<string, TranscriptEvent[]>();
  private dir = '';
  private timer: NodeJS.Timeout | null = null;
  private tTimers = new Map<string, NodeJS.Timeout>();
  private logChain: Promise<void> = Promise.resolve();
  /** Events logged since helm started. The state carries it so the Activity page knows when to read again. */
  logSeq = 0;
  /** Called (not debounced) when something changed here by itself: a record edited, a transcript saved. Not for what a sync brought in. */
  onLocalChange: (() => void) | null = null;
  private fps = new Map<string, string>();

  /**
   * Records something that happened. Every event goes on the end of activity.jsonl, which is never rewritten, so the log can be long
   * without slowing the state; the latest few stay in memory too.
   */
  log(e: Omit<ActivityEvent, 'id' | 't'> & { t?: number }) {
    const ev: ActivityEvent = { id: uid(), t: Date.now(), ...e };
    this.data.activity.unshift(ev);
    if (this.data.activity.length > 60) this.data.activity.length = 60;
    this.logSeq++;
    const file = join(this.dir, 'activity.jsonl');
    this.logChain = this.logChain.then(async () => {
      // Keep one earlier file of up to 8 MB, so the log cannot grow without limit.
      const size = (await stat(file).catch(() => null))?.size ?? 0;
      if (size > 8 * 1024 * 1024) await rename(file, join(this.dir, 'activity.old.jsonl')).catch(() => undefined);
      await appendFile(file, JSON.stringify(ev) + '\n', 'utf8');
    }).catch(() => undefined);
  }

  async readLog(before = Infinity, limit = 300): Promise<ActivityEvent[]> {
    await this.logChain;
    const out: ActivityEvent[] = [];
    for (const name of ['activity.jsonl', 'activity.old.jsonl']) {
      const text = await readFile(join(this.dir, name), 'utf8').catch(() => '');
      const lines = text.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        try { const ev = JSON.parse(lines[i]) as ActivityEvent; if (ev.t < before) out.push(ev); } catch { /* a torn last line */ }
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  get root() { return this.dir; }

  async load(dir: string) {
    this.dir = dir;
    await mkdir(join(this.dir, 'transcripts'), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(join(this.dir, 'helm.json'), 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...defaultSettings(), ...raw.settings } };
      { const o = defaultOutbound(), r = this.data.settings.outbound || o; this.data.settings.outbound = { email: { ...o.email, ...r.email, kinds: { ...o.email.kinds, ...r.email?.kinds } } }; }
      if (!this.data.settings.githubClientId) this.data.settings.githubClientId = defaultSettings().githubClientId;
      // Sessions saved by older versions have no subagents.
      for (const x of this.data.sessions) { x.subagents ||= []; x.lastAccess ||= x.endedAt ?? x.startedAt; }
      this.data.extArchive ||= {};
      if (!existsSync(join(this.dir, 'activity.jsonl')) && this.data.activity.length) {
        await writeFile(join(this.dir, 'activity.jsonl'), [...this.data.activity].reverse().map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
      }
      this.data.audit ||= [];
      this.data.daily ||= [];
      this.data.automations ||= [];
      this.data.automationSeen ||= {};
      this.data.deleted ||= [];
      this.data.instanceId ||= uid() + uid();
      this.seedRecords();
      // The copy list used to be one comma-separated line. It is now gitignore patterns, one per line.
      if (!/[\r\n]/.test(this.data.settings.copyFiles) && this.data.settings.copyFiles.includes(',')) this.data.settings.copyFiles = this.data.settings.copyFiles.split(',').map((x) => x.trim()).filter(Boolean).join('\n');
      // Lifetime totals started later than sessions did: seed them from the sessions that exist, once.
      if (!raw.totals) {
        this.data.totals = {};
        for (const x of this.data.sessions) {
          const t = (this.data.totals[x.repoId] ||= { input: 0, output: 0, cacheRead: 0, cost: 0 });
          t.input += x.tokens.input; t.output += x.tokens.output; t.cacheRead += x.tokens.cacheRead; t.cost += x.cost;
        }
      }
    } catch { /* first run */ }
    this.data.instanceId ||= uid() + uid();
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 400);
  }

  // ---------------------------------------------------------------- change tracking for sync
  private records(): [string, { id: string; updatedAt?: number }][] {
    const d = this.data;
    return [...d.sessions.map((x) => ['session:' + x.id, x] as [string, any]), ...d.repos.map((x) => ['repo:' + x.id, x] as [string, any]), ...d.automations.map((x) => ['automation:' + x.id, x] as [string, any])];
  }
  /** What makes a record "changed": everything except the stamp itself and when it was last looked at. */
  private fingerprint(x: any) { const { updatedAt: _u, lastAccess: _l, ...rest } = x; return JSON.stringify(rest); }
  /** Records from before sync have no stamp: give them one from their own dates, without calling that a change. */
  private seedRecords() {
    for (const [k, x] of this.records()) {
      const a = x as any;
      a.updatedAt ||= k.startsWith('session:') ? Math.max(a.startedAt || 0, a.endedAt || 0, a.mergedAt || 0, a.archivedAt || 0, a.timeline?.[a.timeline.length - 1]?.t || 0) : a.addedAt || 1;
      this.fps.set(k, this.fingerprint(x));
    }
  }
  /** Stamps the records that changed since the last look. Returns whether any did. */
  private stamp(): boolean {
    let any = false;
    const live = new Set<string>();
    for (const [k, x] of this.records()) {
      live.add(k);
      const fp = this.fingerprint(x);
      if (this.fps.get(k) === fp) continue;
      this.fps.set(k, fp);
      x.updatedAt = Date.now();
      any = true;
    }
    for (const k of this.fps.keys()) if (!live.has(k)) this.fps.delete(k);
    return any;
  }
  /** A record that came from another instance is what it is: don't count it as edited here. */
  markSynced(kind: 'session' | 'repo' | 'automation', x: { id: string }) { this.fps.set(kind + ':' + x.id, this.fingerprint(x)); }
  /** Remembers a deletion for sync. */
  tombstone(kind: Tombstone['kind'], id: string, at = Date.now(), quiet = false) {
    const d = this.data.deleted;
    const old = d.find((t) => t.kind === kind && t.id === id);
    if (old) old.at = Math.max(old.at, at); else d.push({ kind, id, at });
    this.data.deleted = d.filter((t) => t.at > Date.now() - 30 * 86400_000);
    this.save();
    if (!quiet) this.onLocalChange?.();
  }

  async flush() {
    if (this.stamp()) this.onLocalChange?.();
    const file = join(this.dir, 'helm.json');
    await writeFile(file + '.tmp', JSON.stringify(this.data));
    await rename(file + '.tmp', file);
  }

  async transcript(id: string): Promise<TranscriptEvent[]> {
    let t = this.transcripts.get(id);
    if (!t) {
      try { t = JSON.parse(await readFile(join(this.dir, 'transcripts', id + '.json'), 'utf8')); } catch { t = []; }
      // An earlier bug could leave an entry with no type (a result patched into a slot that was no longer there). Drop those.
      if (Array.isArray(t)) t = t.filter((e: any) => e && typeof e.k === 'string'); else t = [];
      this.transcripts.set(id, t!);
    }
    return t!;
  }

  /** A transcript for searching: the one in memory if there is one, else read from disk without keeping it. */
  async peekTranscript(id: string): Promise<TranscriptEvent[]> {
    const cached = this.transcripts.get(id);
    if (cached) return cached;
    try { return JSON.parse(await readFile(join(this.dir, 'transcripts', id + '.json'), 'utf8')); } catch { return []; }
  }

  /** A session's transcript and those of its subagents (`<id>~<subagent>`). */
  async deleteTranscripts(id: string) {
    for (const [k, tm] of this.tTimers) if (k === id || k.startsWith(id + '~')) { clearTimeout(tm); this.tTimers.delete(k); }
    for (const k of [...this.transcripts.keys()]) if (k === id || k.startsWith(id + '~')) this.transcripts.delete(k);
    try {
      for (const f of await readdir(join(this.dir, 'transcripts'))) if (f === id + '.json' || f.startsWith(id + '~')) await rm(join(this.dir, 'transcripts', f), { force: true });
    } catch { /* nothing saved */ }
  }

  /** Forgets one session's transcripts held in memory (and any save waiting), after the files were replaced on disk. */
  dropTranscripts(id: string) {
    for (const k of [...this.transcripts.keys()]) if (k === id || k.startsWith(id + '~')) { this.transcripts.delete(k); const tm = this.tTimers.get(k); if (tm) { clearTimeout(tm); this.tTimers.delete(k); } }
  }

  /** Drops transcripts held in memory, after files on disk have changed underneath them. */
  forgetTranscripts() { for (const k of [...this.transcripts.keys()]) if (!this.tTimers.has(k)) this.transcripts.delete(k); }

  saveTranscript(id: string) {
    if (this.tTimers.has(id)) return;
    this.tTimers.set(id, setTimeout(async () => {
      this.tTimers.delete(id);
      const t = this.transcripts.get(id);
      if (!t) return;
      const file = join(this.dir, 'transcripts', id + '.json');
      await writeFile(file + '.tmp', JSON.stringify(t));
      await rename(file + '.tmp', file);
      this.onLocalChange?.();
    }, 600));
  }

  /** Writes the transcripts waiting for their save, and nothing else. */
  async flushTranscripts() {
    for (const [id, tm] of this.tTimers) {
      clearTimeout(tm);
      this.tTimers.delete(id);
      const t = this.transcripts.get(id);
      if (t) await writeFile(join(this.dir, 'transcripts', id + '.json'), JSON.stringify(t));
    }
  }

  /** The keys of every saved transcript (a session's id, or `<id>~<subagent>`). */
  async transcriptKeys(): Promise<string[]> {
    const keys = new Set((await readdir(join(this.dir, 'transcripts')).catch(() => [] as string[])).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
    for (const k of this.transcripts.keys()) keys.add(k);
    return [...keys];
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

  /** Adds to the per-day ledger the reports read. */
  addDaily(repoId: string, model: ModelAlias, add: { cost?: number; input?: number; output?: number; cacheRead?: number }) {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const list = this.data.daily;
    let row = list[list.length - 1]?.day === day ? list.slice(-60).reverse().find((x) => x.day === day && x.repoId === repoId && x.model === model) : undefined;
    if (!row) {
      row = { day, repoId, model, cost: 0, input: 0, output: 0, cacheRead: 0 };
      list.push(row);
    }
    row.cost += add.cost ?? 0; row.input += add.input ?? 0; row.output += add.output ?? 0; row.cacheRead += add.cacheRead ?? 0;
    this.save();
  }

  addAudit(e: AuditEntry) {
    this.data.audit.push(e);
    if (this.data.audit.length > 6000) this.data.audit.splice(0, this.data.audit.length - 5000);
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
