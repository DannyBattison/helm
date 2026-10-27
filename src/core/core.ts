import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import { appendFile, readFile, statfs, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { AppState, AgentLogin, ExternalTranscript, HelmApi, HelmEvents, Settings, TranscriptEvent, WorktreeUsage } from '../shared/types';
import type { SystemStatus } from '../shared/system';
import { BackendRegistry } from './backend';
import { ClaudeBackend } from './claudeBackend';
import { CodexBackend } from './codexBackend';
import * as G from './git';
import * as GH from './github';
import { Companion } from './companion';
import { installLogging, logFile, logLine, recentLog } from './log';
import { cleanHeavy, dirSize, reclaimableBytes } from './disk';
import { readArtifact } from './artifacts';
import { addRepoArtifact, addRepoArtifactChunk, repoArtifactProgress, listRepoArtifacts, removeRepoArtifact, setRepoArtifactDir } from './repoartifacts';
import { cpuTimes, cpuUse, HISTORY_LIMIT, parseLimit, type CpuTimes, type SystemPoint } from '../shared/system';
import { SyncService } from './sync';
import { applyImport, buildExport } from './migrate';
import { diagnostics } from '../shared/diagnostics';
import { memoryHealth, memoryReads, STALE_DAYS, type MemoryFile, type MemoryUsage } from '../shared/memoryhealth';
import type { Host } from './host';
import { cleanMcp, mcpProblem } from '../shared/mcp';
import { appendInstruction, deleteMemory, projectMemory, readMemory, writeMemory } from './memory';
import { Automations } from './automations';
import { RepoService } from './repos';
import { forecastRepo, revertHunk } from './review';
import { SessionManager } from './sessions';
import { Store } from './store';
import { shellOptions, Terminals } from './terminal';
import { expandHome, home, run } from './util';
import { CURRENCIES, currencyForRegion, fmtMoney } from '../shared/money';
import { notifyDecision } from '../shared/notify';
import { dispatchOutbound, emailPasswordSet, loadOutboundSecrets, saveEmailPassword, testOutbound } from './outbound';
import { auditText } from '../shared/redact';
import { prepareInputs } from '../shared/workflows';
import { searchEvents, type SearchResults } from '../shared/search';
import { sessionTitle } from '../shared/types';
import { feedbackTask, issueTask, pullNumber } from '../shared/issues';
import { prBody, prSummary, prTitle, replaceSummary } from '../shared/prText';
import { auditCsv, buildReport, digestMarkdown, sessionsCsv, spendCsv, type ReportInput } from '../shared/reports';

let host: Host;
let backends: import('../shared/types').BackendInfo[] = [];
let forecast: import('../shared/forecast').Conflict[] = [];
let lastCpu: CpuTimes | null = null;
let lastProc: { t: number; us: number } | null = null;
const sysHistory: SystemPoint[] = [];

/** Memory of the machine, or of the container when it has a limit: that is the ceiling that matters on a server. */
async function memoryLimit(): Promise<{ total: number; used: number; limited: boolean }> {
  const read = (f: string) => readFile(f, 'utf8').catch(() => null);
  const [lim2, cur2, lim1, cur1] = await Promise.all([read('/sys/fs/cgroup/memory.max'), read('/sys/fs/cgroup/memory.current'), read('/sys/fs/cgroup/memory/memory.limit_in_bytes'), read('/sys/fs/cgroup/memory/memory.usage_in_bytes')]);
  const limit = parseLimit(lim2, os.totalmem()) ?? parseLimit(lim1, os.totalmem());
  const cg = Number((parseLimit(lim2, os.totalmem()) ? cur2 : cur1) ?? NaN);
  const total = limit ?? os.totalmem();
  return { total, limited: !!limit, used: limit && Number.isFinite(cg) && cg > 0 ? Math.min(total, cg) : total - os.freemem() };
}

/** Takes a reading and adds it to the history, unless one was taken in the last 2 s (then that one is returned). */
async function sampleSystem(fresh = false): Promise<SystemPoint & { cpu: number | null }> {
  const last = sysHistory[sysHistory.length - 1];
  if (fresh && last && Date.now() - last.t < 2000) return last;
  const cpus = os.cpus();
  const now = cpuTimes(cpus);
  const cpu = cpuUse(lastCpu, now);
  lastCpu = now;
  const pu = process.cpuUsage(), t = Date.now();
  const proc = lastProc && t > lastProc.t ? Math.min(1, (pu.user + pu.system - lastProc.us) / 1000 / (t - lastProc.t) / Math.max(1, cpus.length)) : null;
  lastProc = { t, us: pu.user + pu.system };
  const disk = await statfs(host.dataDir).then((f) => f.bavail * f.bsize).catch(() => null);
  const pt: SystemPoint = { t, cpu, mem: (await memoryLimit()).used, rss: process.memoryUsage().rss, proc, load: os.loadavg()[0], disk };
  sysHistory.push(pt);
  if (sysHistory.length > HISTORY_LIMIT) sysHistory.shift();
  return pt;
}
const usageCache = new Map<string, { at: number; bytes: number; partial: boolean; reclaimable: number; dirs: string[]; dirty: number; unpushed: number }>();
const store = new Store();

function send<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]) {
  host.send(channel, payload);
}

// ------------------------------------------------------------------ state
let stateTimer: NodeJS.Timeout | null = null;
function buildState(): AppState {
  return {
    ready: true,
    agentLoginRequired: !!host.requireAgentLogin,
    user: store.data.user,
    repos: store.data.repos,
    sessions: store.data.sessions,
    activity: store.data.activity,
    activitySeq: store.logSeq,
    companion: companion.state,
    settings: store.data.settings,
    outboundSecrets: { emailPassword: emailPasswordSet() },
    automations: store.data.automations,
    weekSpend: store.weekSpend(),
    lifetime: store.data.totals,
    tokensToday: store.tokensToday(),
    forecast,
    update: host.updates?.status() ?? { state: 'dev' },
    backends,
    plan: store.data.plan,
    plans: store.data.plans,
    rates: store.data.fx.rates,
    platform: process.platform,
    home
  };
}
/** Who each agent is signed in as, as last read. */
let logins: Record<string, AgentLogin | undefined> = {};
const authOf = (id: string) => {
  const a = registry.get(id).auth;
  if (!a) throw new Error('That agent does not need to be signed in.');
  return a;
};
/** Reads who each agent is signed in as, and what models and versions it has, and tells the UI if anything changed. */
async function refreshBackends() {
  await Promise.all(registry.all().map(async (b) => {
    if (b.auth) {
      const l = await b.auth.status().catch((e): AgentLogin => ({ loggedIn: false, method: 'none', error: String(e?.message || e) }));
      logins[b.id] = l;
      if (l.billing && b.id !== 'claude') sessions.setBilling(b.id, l.billing);
    }
    // Only once signed in: a model list is no use before that, and asking starts the agent's process.
    if (!b.auth || logins[b.id]?.loggedIn) await b.refresh?.();
  }));
  const next = await registry.info(logins);
  if (JSON.stringify(next) !== JSON.stringify(backends)) { backends = next; emitState(); }
}
/** For a sign-in that finishes in the browser with no code to paste back: look until it is done. */
const watching = new Map<string, NodeJS.Timeout>();
function watchLogin(id: string) {
  clearInterval(watching.get(id));
  const t0 = Date.now();
  const timer = setInterval(() => {
    void refreshBackends().then(() => { if (logins[id]?.loggedIn || Date.now() - t0 > 10 * 60_000) { clearInterval(timer); watching.delete(id); void refreshPlan(true); } });
  }, 3000);
  watching.set(id, timer);
}

let lastBadge = -1;
export function emitState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    send('state', buildState());
    companion.changed();
    // The badge is an OS call (on Windows it draws an overlay icon), so only make it when the number changes.
    const need = store.data.sessions.filter((s) => s.status === 'attention').length;
    if (need !== lastBadge) { lastBadge = need; host.setBadge?.(need); }
    host.changed?.();
  }, 120);
}

// Watchdog: if the process is blocked for more than 400 ms (HELM_DEV_LAG=1: 80 ms), say so in diagnostics.log with what the
// sessions were doing, so a freeze leaves something to read. The window reports its own stalls the same way.
function diag(line: string) {
  void appendFile(join(host.dataDir, 'diagnostics.log'), `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => undefined);
}
function startWatchdog() {
  let last = Date.now();
  const limit = process.env.HELM_DEV_LAG ? 80 : 400;
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 100;
    last = now;
    if (lag > limit) {
      const busy = store.data.sessions.filter((s) => s.status === 'working' || s.status === 'attention').map((s) => `${s.id}:${s.status}:${s.step.slice(0, 60)}`).join(' | ');
      diag(`main process blocked ${lag} ms; sessions: ${busy || 'none active'}`);
      if (process.env.HELM_DEV_LAG) console.log(`[lag] main process blocked ${lag} ms`);
    }
  }, 100);
}

const repos = new RepoService(store, emitState);
// The companion is created before the sessions, which call into it when a transcript changes, but it needs them to act: so its
// operations are filled in once they exist.
const companionOps: import('./companion').CompanionOps = {} as any;
const syncer = new SyncService(store, () => host, { isRunning: (id) => sessions.isRunning(id), changed: () => emitState(), canServe: () => !!host.syncServer, emitTranscript: (sessionId, index, event) => send('transcript', { sessionId, index, event }), name: () => os.hostname() });
const companion = new Companion(store, companionOps, () => emitState(), () => host);
const registry = new BackendRegistry([
  new ClaudeBackend({
    sdk: () => store.data.settings.claudePath || host.sdkClaudePath(),
    cli: () => store.data.settings.claudePath || host.cliClaudePath()
  }),
  new CodexBackend({ cli: () => store.data.settings.codexPath || undefined })
]);
const sessions = new SessionManager(store, {
  emitState,
  emitTranscript: (sessionId, index, event) => { send('transcript', { sessionId, index, event }); companion.onTranscript(sessionId, index, event); },
  toast: (t) => send('toast', t),
  claudePath: () => host.sdkClaudePath(),
  notify(kind, title, body, sessionId) {
    const st = store.data.settings;
    const repoId = sessions.get(sessionId)?.repoId || '';
    dispatchOutbound(st, { kind, title, body, sessionId, repoId });
    const d = notifyDecision(st, kind, repoId);
    if (!d.show) return;
    const ask = kind === 'attention' ? sessions.get(sessionId)?.ask : undefined;
    // A host that can show buttons on a notification lets a plain approval be answered without opening the app.
    const answer = ask?.type === 'approve' ? (decision: 'approve' | 'deny') => { if (sessions.get(sessionId)?.ask?.id === ask.id) void sessions.resolveAsk(sessionId, ask.id, { decision }); } : undefined;
    host.notify?.({ kind, title, body, silent: !d.sound, sessionId, answer });
  }
}, registry);
Object.assign(companionOps, {
  resolveAsk: (id: string, askId: string, answer: any) => sessions.resolveAsk(id, askId, answer),
  sendMessage: (id: string, text: string) => sessions.send(id, text),
  interrupt: (id: string) => sessions.interrupt(id),
  stop: (id: string) => sessions.stop(id),
  resume: async (id: string) => { await sessions.send(id, 'Continue where you left off.'); },
  archive: async (id: string, archived: boolean) => { sessions.archive(id, archived); },
  createSession: async (repoId: string, task: string) => {
    const st = store.data.settings;
    const repo = repos.must(repoId);
    await sessions.create({ repoId, base: repo.defaultBranch, task, model: st.defaultModel, budget: st.sessionBudget, permMode: st.permMode });
  },
  transcript: (key: string) => store.transcript(key),
  externals: (repoId: string) => api.listExternalSessions(repoId),
  externalTranscript: async (repoId: string, sessionId: string, limit: number) => { const r = await externalTranscript(repoId, sessionId, { tail: limit }); return { ready: r.ready, total: r.total, start: r.start, events: r.events }; },
  archiveExternal: (sessionId: string, archived: boolean) => api.archiveExternal(sessionId, archived),
  activity: (before: number | undefined, limit: number) => store.readLog(before, limit)
});
const automations = new Automations(store, {
  listPulls: (id) => GH.listPulls(id),
  listIssues: (id) => GH.listIssues(id),
  listFinishedRuns: (id) => GH.listFinishedRuns(id),
  listCommits: (id, branch) => GH.listBranchCommits(id, branch),
  start: async (repoId, base, task, a) => {
    await sessions.create({ repoId, base, task, backend: a.backend, model: a.model, budget: a.budget, permMode: a.permMode, automation: { id: a.id, name: a.name } });
  },
  automatedBranches: (repoId) => new Set(store.data.sessions.filter((s) => s.repoId === repoId && s.automation).map((s) => s.branch)),
  repoName: (id) => repoName(id),
  defaultBranch: (id) => repos.must(id).defaultBranch,
  changed: () => { store.save(); emitState(); }
});
const terms = new Terminals((id, data) => send('termData', { id, data }), (id) => send('termExit', { id }));

// ------------------------------------------------------------------ helpers
const sess = (id: string) => {
  const s = sessions.get(id);
  if (!s) throw new Error('Session not found');
  return s;
};
/** A workspace is a session worktree or the repository's own checkout. */
function ws(id: string): { worktree: string; base: string; sessionId?: string } {
  if (id.startsWith('repo:')) return { worktree: repos.must(id.slice(5)).localPath, base: 'HEAD' };
  const s = sess(id);
  return { worktree: s.worktree, base: s.base, sessionId: s.id };
}
function safePath(s: { worktree: string }, p: string): string {
  const abs = resolve(s.worktree, p);
  const r = relative(s.worktree, abs);
  if (r.startsWith('..') || isAbsolute(r)) throw new Error('Path is outside the worktree');
  return abs;
}

// ------------------------------------------------------------------ external transcripts
// A session file can be gigabytes (one of the real ones is 1.7 GB, of which 832 lines are the conversation), and reading it
// takes seconds. So it is read once in the background, kept in memory keyed by file size and modification time, and only
// read again when that changes, no more often than a few times its own read time. Callers get a window of the result.
const extCache = new Map<string, { sig: string; events: TranscriptEvent[]; at: number; readMs: number }>();
const extLoading = new Map<string, Promise<void>>();
const extError = new Map<string, string>();

/** Which backend each external conversation came from, learned when they are listed. */
const extOwner = new Map<string, string>();
const extStore = (id: string) => {
  const owner = registry.all().find((b) => b.id === extOwner.get(id) && b.conversations) ?? registry.all().find((b) => b.conversations);
  if (!owner?.conversations) throw new Error('No agent keeps conversations helm can read.');
  return owner.conversations;
};

async function externalTranscript(repoId: string, sessionId: string, opts: { start?: number; end?: number; tail?: number } = {}): Promise<ExternalTranscript> {
  const repo = repos.must(repoId);
  const conv = extStore(sessionId);
  const sig = await conv.signature(sessionId);
  let c = extCache.get(sessionId);
  const changed = !c || c.sig !== sig;
  if (changed && !extLoading.has(sessionId) && (!c || Date.now() - c.at > Math.max(4000, c.readMs * 3))) {
    const t0 = Date.now();
    const p = conv.transcript(sessionId, repo.localPath)
      .then((events) => {
        extCache.set(sessionId, { sig, events, at: Date.now(), readMs: Date.now() - t0 });
        extError.delete(sessionId);
        if (extCache.size > 4) extCache.delete(extCache.keys().next().value as string);
      })
      .catch((e) => { extError.set(sessionId, String(e?.message || e)); })
      .finally(() => extLoading.delete(sessionId));
    extLoading.set(sessionId, p);
  }
  if (!c) {
    // First read: small sessions finish well inside this wait and come straight back; big ones report "not ready" and are polled.
    await Promise.race([extLoading.get(sessionId), new Promise((r) => setTimeout(r, 700))]);
    c = extCache.get(sessionId);
    if (!c) return { ready: false, total: 0, start: 0, events: [], error: extError.get(sessionId) };
  }
  const total = c.events.length;
  const start = opts.start != null ? Math.max(0, Math.min(opts.start, total)) : Math.max(0, total - (opts.tail ?? 200));
  const end = opts.end != null ? Math.max(start, Math.min(opts.end, total)) : total;
  return { ready: true, total, start, events: c.events.slice(start, end) };
}

/** Sessions that have a process running right now, across every backend, or null when none can be asked. */
async function liveSessions(): Promise<Set<string> | null> {
  const all = await Promise.all(registry.all().map((b) => b.conversations?.live() ?? Promise.resolve(null)));
  const known = all.filter((x): x is Set<string> => !!x);
  return known.length ? new Set(known.flatMap((x) => [...x])) : null;
}

/** A session from outside helm is archived by hand, or when it has been idle longer than the archive setting. A restore overrides the age rule. */
function externalArchiveState(id: string, lastModified: number, active: boolean): { archived: boolean; archiveReason?: 'manual' | 'age' } {
  const o = store.data.extArchive[id];
  if (o === 'archived') return { archived: true, archiveReason: 'manual' };
  const days = store.data.settings.archiveAfterDays;
  if (o !== 'restored' && !active && days > 0 && Date.now() - lastModified > days * 86_400_000) return { archived: true, archiveReason: 'age' };
  return { archived: false };
}

function applyTheme() {
  host.setTheme?.(store.data.settings.theme);
}

function openExternalEditor(path: string, kind: string, line?: number) {
  const cmd = kind === 'VS Code' ? 'code' : kind === 'Cursor' ? 'cursor' : kind === 'Zed' ? 'zed' : '';
  if (!cmd) return;
  // VS Code and Cursor take `--goto file:line`; Zed takes `file:line`.
  const args = line && kind !== 'Zed' ? ['--goto', `${path}:${line}`] : [line ? `${path}:${line}` : path];
  spawn(cmd, args.map((a) => (process.platform === 'win32' ? `"${a}"` : a)), { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
}

// ------------------------------------------------------------------ API
const me = () => store.data.user?.login || 'you';
const repoName = (id: string) => store.data.repos.find((r) => r.id === id)?.name || id.split('/').pop() || '';

export const api: HelmApi = {
  async getState() { return buildState(); },
  activityLog: (opts) => store.readLog(opts?.before, opts?.limit),
  async setEmailPassword(password) { await saveEmailPassword(password); emitState(); },
  testOutbound: (channel) => testOutbound(store.data.settings, channel),
  async companionUnlink() { if (host.companion !== false) await companion.unlink(); },
  async reportStall(ms, where) { diag(`window stalled ${ms} ms on ${where}`); },
  async updateSettings(patch: Partial<Settings>) {
    Object.assign(store.data.settings, patch);
    if ('theme' in patch) applyTheme();
    if ('syncEnabled' in patch) syncer.settingsChanged();
    if ('billing' in patch && patch.billing === 'subscription') void refreshPlan(true);
    if ('archiveAfterDays' in patch) sessions.autoArchive();
    if (('companionEnabled' in patch || 'companionUrl' in patch) && host.companion !== false) companion.apply();
    host.settingsChanged?.(patch);
    if ('planPause5h' in patch || 'planPauseWeek' in patch || 'billing' in patch) void sessions.enforcePlan();
    if ('claudePath' in patch || 'codexPath' in patch) await refreshBackends();
    store.save();
    emitState();
  },

  async signInStart() { return GH.startDeviceFlow(store.data.settings.githubClientId); },
  async signInWait() {
    const u = await GH.waitDeviceFlow();
    G.setGitToken(GH.getToken());
    store.data.user = u;
    store.save();
    emitState();
    return u;
  },
  async signInToken(token) {
    const u = await GH.signInWithToken(token);
    G.setGitToken(GH.getToken());
    store.data.user = u;
    store.save();
    emitState();
    return u;
  },
  async agentLoginStart(backend) {
    const r = await authOf(backend).startLogin();
    if (!r.needsCode) watchLogin(backend);
    return r;
  },
  async agentLoginCode(backend, code) {
    const a = authOf(backend);
    if (!a.submitCode) throw new Error('This agent does not take a code.');
    const l = await a.submitCode(String(code));
    await refreshBackends();
  setInterval(() => void refreshBackends(), 5 * 60_000).unref?.();
    void refreshPlan(true);
    return l;
  },
  async agentLoginCancel(backend) { clearInterval(watching.get(backend)); watching.delete(backend); authOf(backend).cancel(); },
  async agentLogout(backend) {
    const l = await authOf(backend).logout();
    store.planOf(backend).fiveHour = undefined;
    store.planOf(backend).weekly = undefined;
    await refreshBackends();
    return l;
  },
  async refreshAgentLogins() { await refreshBackends(); },

  async signOut() {
    GH.cancelDeviceFlow();
    await GH.clearToken();
    G.setGitToken(null);
    store.data.user = null;
    store.save();
    emitState();
  },

  async listGithubRepos() { return GH.listRepos(new Set(store.data.repos.map((r) => r.id))); },
  async cloneRepos(ids) { for (const id of ids) { await repos.cloneSlug(id); store.log({ kind: 'git', who: me(), human: true, what: 'cloned the repository', repo: repoName(id) }); } },
  async cloneUrl(url, dir) { await repos.cloneUrl(url, dir); store.log({ kind: 'git', who: me(), human: true, what: `cloned ${url}`, repo: url.split('/').pop()?.replace(/\.git$/, '') || '' }); },
  async listGithubOwners() { return GH.listOwners(); },
  async createGithubRepo(input) { const r = await repos.createRepo(input); store.log({ kind: 'git', who: me(), human: true, what: 'created the repository on GitHub', repo: r.name }); },
  async inspectClone(path) { return repos.inspect(path); },
  async addLocalRepo(path) { await repos.addFromPath(expandHome(path)); store.log({ kind: 'git', who: me(), human: true, what: `added ${path}`, repo: path.split(/[\\/]/).pop() || '' }); },
  async removeRepo(id) {
    if (store.data.sessions.some((s) => s.repoId === id)) throw new Error('Remove or delete this repository\'s sessions first.');
    await repos.remove(id);
  },
  async setRepoCap(id, cap) { repos.must(id).cap = cap; store.save(); emitState(); },
  async chooseFolder() {
    return host.chooseFolder();
  },
  async fetchRepo(id) {
    try { await repos.fetch(id); store.log({ kind: 'fetch', who: me(), human: true, what: 'fetched origin', repo: repoName(id) }); }
    catch (e: any) { store.log({ kind: 'fetch', who: me(), human: true, what: 'fetch failed', repo: repoName(id), ok: false, detail: String(e?.message || e) }); throw e; }
  },
  repoBranches: (id) => repos.branches(id),
  repoBases: (id) => repos.bases(id),
  repoHistory: (id, limit) => repos.history(id, store.data.sessions, limit),
  repoHistoryCached: (id, limit) => repos.cachedHistory(id, store.data.sessions, limit),
  async reorderRepos(ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    store.data.repos.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    store.save();
    emitState();
  },
  async reorderSessions(repoId, ids) {
    const rank = new Map(ids.map((id, i) => [id, i]));
    const mine = store.data.sessions.filter((s) => s.repoId === repoId).sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    let k = 0;
    store.data.sessions = store.data.sessions.map((s) => (s.repoId === repoId ? mine[k++] : s));
    store.save();
    emitState();
  },
  refreshPlanUsage: () => refreshPlan(true),
  repoWorktrees: (id) => repos.worktrees(id, store.data.sessions),
  repoPulls: async (id) => GH.listPulls(id),
  commitFiles: (id, hash) => repos.commitFiles(id, hash),
  async removeWorktree(repoId, path) {
    const r = repos.must(repoId);
    const s = store.data.sessions.find((x) => x.repoId === repoId && x.worktree === path);
    if (s) await sessions.remove(s.id, { worktree: true, branch: false });
    else { await G.removeWorktree(r.localPath, path); store.log({ kind: 'worktree', who: me(), human: true, what: 'removed a worktree', repo: r.name, detail: path }); }
  },

  createSession: (input) => sessions.create(input),
  sendMessage: (id, text, images) => sessions.send(id, text, images),
  setSessionEffort: (id, e) => sessions.setEffort(id, e),
  interrupt: (id) => sessions.interrupt(id),
  haltAll: () => sessions.haltAll(),
  resumeAll: () => sessions.resumeAll(),
  stopSession: (id) => sessions.stop(id),
  async resumeSession(id) { await sessions.send(id, 'Continue where you left off.'); },
  sessionDeleteInfo: (id) => sessions.deleteInfo(id),
  async renameSession(id, title) { await sessions.rename(id, title); },
  async archiveSession(id, archived) { sessions.archive(id, archived); },
  async touchSession(id) { sessions.touchAccess(id); },
  async archiveExternal(id, archived) { store.data.extArchive[id] = archived ? 'archived' : 'restored'; store.save(); },
  deleteSession: (id, opts) => sessions.remove(id, opts),
  setSessionModel: (id, m) => sessions.setModel(id, m),
  setSessionPermMode: (id, m) => sessions.setPermMode(id, m),
  refreshSubagent: (id, subId) => sessions.refreshSubagent(id, subId),
  async setSessionMaxSubagents(id, max) { sess(id).maxSubagents = max ?? undefined; store.save(); emitState(); },
  async saveMcpServer(repoId, server, replace) {
    const list = repoId ? repos.must(repoId).mcpServers || [] : store.data.settings.mcpServers || [];
    const s = cleanMcp(server);
    const old = replace ?? s.name;
    const problem = mcpProblem(s, list.filter((x) => x.name !== old).map((x) => x.name));
    if (problem) throw new Error(problem);
    const i = list.findIndex((x) => x.name === old);
    const next = i < 0 ? [...list, s] : list.map((x, j) => (j === i ? s : x));
    if (repoId) repos.must(repoId).mcpServers = next; else store.data.settings.mcpServers = next;
    store.save(); emitState();
  },
  async removeMcpServer(repoId, name) {
    if (repoId) { const r = repos.must(repoId); r.mcpServers = (r.mcpServers || []).filter((x) => x.name !== name); }
    else store.data.settings.mcpServers = (store.data.settings.mcpServers || []).filter((x) => x.name !== name);
    store.save(); emitState();
  },
  async setRepoMaxSubagents(id, max) { repos.must(id).maxSubagents = max ?? undefined; store.save(); emitState(); },
  resolveAsk: (id, askId, answer) => sessions.resolveAsk(id, askId, answer),
  getTranscript: (id) => store.transcript(id),
  getArtifact: (id, name) => readArtifact(id, name),
  dismissArtifact: (id, name) => sessions.dismissArtifact(id, name),
  listRepoArtifacts: (id) => listRepoArtifacts(repos.must(id).id),
  addRepoArtifact: (id, name, data) => addRepoArtifact(repos.must(id).id, name, data),
  addRepoArtifactChunk: (id, name, offset, data, done, fp) => addRepoArtifactChunk(repos.must(id).id, name, offset, data, done, fp),
  repoArtifactProgress: (id, name, fp) => repoArtifactProgress(repos.must(id).id, name, fp),
  removeRepoArtifact: (id, name) => removeRepoArtifact(repos.must(id).id, name),
  async saveAutomation(a) { return automations.save(a); },
  async deleteAutomation(id) { automations.remove(id); },
  runAutomation: (id) => automations.runNow(id),

  async workspaceInfo(id) {
    const w = ws(id);
    const branch = (await G.git(w.worktree, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => '')).trim();
    const dirty = (await G.git(w.worktree, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length;
    return { root: w.worktree, branch, dirty, session: !!w.sessionId };
  },
  async listFiles(id) { return G.listFiles(ws(id).worktree); },
  async readBase(id, path) {
    const w = ws(id);
    safePath(w, path);
    const mb = await G.mergeBase(w.worktree, w.base).catch(() => 'HEAD');
    return G.git(w.worktree, 'show', `${mb}:${path}`).catch(() => '');
  },
  async searchFiles(id, q, matchCase) { return G.searchFiles(ws(id).worktree, q, !!matchCase); },
  commitDiff: (repoId, hash, path) => G.commitDiff(repos.must(repoId).localPath, hash, path),
  async listExternalSessions(repoId) {
    const r = repos.must(repoId);
    const live = await liveSessions();
    const own = new Set(store.data.sessions.map((s) => s.agentSessionId).filter(Boolean));
    const lists = await Promise.all(registry.all().map(async (b) => ((await b.conversations?.list(r.localPath)) ?? []).map((x) => ({ x, backend: b.id }))));
    return lists.flat()
      .filter(({ x }) => !own.has(x.id))
      .map(({ x, backend }) => {
        extOwner.set(x.id, backend);
        const active = live ? live.has(x.id) : Date.now() - x.lastModified < 90_000;
        return {
          id: x.id, title: x.title || x.summary || x.firstPrompt || 'Untitled session', firstPrompt: x.firstPrompt, branch: x.branch, cwd: x.cwd,
          lastModified: x.lastModified, createdAt: x.createdAt, size: x.size, active,
          ...externalArchiveState(x.id, x.lastModified, active)
        };
      })
      .sort((a, b) => b.lastModified - a.lastModified);
  },
  externalTranscript: (repoId, sessionId, opts) => externalTranscript(repoId, sessionId, opts),
  async listTree(id, dir) { return repos.tree(ws(id).worktree, dir); },
  async readFile(id, path) {
    const abs = safePath(ws(id), path);
    const st = await stat(abs);
    if (st.size > 3 * 1024 * 1024) return { text: '', binary: true };
    const buf = await readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return { text: '', binary: true };
    return { text: buf.toString('utf8'), binary: false };
  },
  async writeFile(id, path, text) {
    const w = ws(id);
    await writeFile(safePath(w, path), text, 'utf8');
    const s = w.sessionId ? sessions.get(w.sessionId) : undefined;
    if (s) { await sessions.userEdited(id, path); await sessions.refreshStats(s); }
  },
  async fileGitLines(id, path) {
    const w = ws(id);
    const added: number[] = [], modified: number[] = [];
    const tracked = await G.gitOk(w.worktree, 'ls-files', '--error-unmatch', path);
    if (!tracked) {
      const n = (await readFile(safePath(w, path), 'utf8').catch(() => '')).split('\n').length;
      for (let i = 1; i <= n; i++) added.push(i);
      return { added, modified };
    }
    const mb = await G.mergeBase(w.worktree, w.base).catch(() => 'HEAD');
    const out = await G.git(w.worktree, 'diff', '-U0', mb, '--', path);
    for (const m of out.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const oldN = m[1] === undefined ? 1 : +m[1], start = +m[2], len = m[3] === undefined ? 1 : +m[3];
      for (let i = 0; i < len; i++) (oldN === 0 ? added : modified).push(start + i);
    }
    return { added, modified };
  },
  async fileBlame(id, path) {
    const s = ws(id);
    const out = await G.git(s.worktree, 'blame', '--line-porcelain', '--', path).catch(() => '');
    const res: { line: number; hash: string; who: string }[] = [];
    let hash = '', who = '', line = 0;
    for (const l of out.split('\n')) {
      const h = l.match(/^([0-9a-f]{40}) \d+ (\d+)/);
      if (h) { hash = h[1].slice(0, 7); line = +h[2]; }
      else if (l.startsWith('author ')) who = l.slice(7);
      else if (l.startsWith('\t')) res.push({ line, hash, who });
    }
    return res;
  },
  async changedFiles(id) { return G.dirtyFiles(ws(id).worktree); },
  async changes(id) { const s = sess(id); void sessions.refreshStats(s); return G.changes(s.worktree, s.base); },
  async extraChanges(id, repoId) {
    const x = sess(id).extras?.find((e) => e.repoId === repoId);
    if (!x) throw new Error('This session has no worktree in ' + repoId);
    return G.changes(x.worktree, x.base);
  },
  async imageVersions(id, path) { const s = sess(id); return G.imageVersions(s.worktree, s.base, path); },
  async fileDiff(id, path) { const s = sess(id); return G.fileDiff(s.worktree, s.base, path); },

  async commitOnly(id, files, message) {
    const w = ws(id);
    await commitFiles(w.worktree, files, message);
    store.log({ kind: 'commit', who: me(), human: true, what: `committed ${files.length} ${files.length === 1 ? 'file' : 'files'}: ${message.split('\n')[0].slice(0, 80)}`, repo: w.sessionId ? repoName(sessions.get(w.sessionId)?.repoId || '') : '', sessionId: w.sessionId, detail: files.join('\n') });
    const s = w.sessionId ? sessions.get(w.sessionId) : undefined;
    if (s) await sessions.refreshStats(s);
    if (store.data.settings.autoPush) {
      if (s) await sessions.autoPush(s);
      else {
        // The repository's own checkout: push whatever branch is checked out, if any.
        const branch = (await G.git(w.worktree, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')).trim();
        if (branch) {
          const ok = await G.git(w.worktree, 'push', '-u', 'origin', branch).then(() => true, () => false);
          store.log({ kind: 'push', who: me(), human: true, what: ok ? `pushed ${branch}` : `push of ${branch} failed`, repo: repoName(id.slice(5)), ok });
        }
      }
    }
  },
  pushStatus(repoId) {
    // The window asks from several places on a timer. Share one answer instead of running git for each ask.
    const key = repoId || '*';
    const epoch = sessions.pushEpoch;
    const hit = pushing.get(key);
    if (hit && hit.epoch === epoch) return hit.p;
    const p = pushTargets(repoId).finally(() => setTimeout(() => { if (pushing.get(key)?.p === p) pushing.delete(key); }, 4000));
    pushing.set(key, { p, epoch });
    return p;
  },
  async push({ repoId, target }) {
    const pushed: string[] = [], failed: { id: string; error: string }[] = [];
    let uncommitted = 0;
    const list = (await pushTargets(repoId)).filter((t) => (!target || t.id === `${t.repoId}${t.kind === 'checkout' ? '' : ''}` || t.id === target || (target === '@checkout' && t.kind === 'checkout')) && t.ahead > 0);
    for (const t of list) {
      const key = t.kind === 'checkout' ? `${t.repoId} (${t.branch})` : t.id;
      try {
        const cwd = t.kind === 'checkout' ? repos.must(t.repoId).localPath : sess(t.id).worktree;
        if (t.dirty) uncommitted++;
        const run = () => G.git(cwd, 'push', '-u', 'origin', t.branch);
        await (t.kind === 'session' ? sessions.serialPush(t.id, run) : run());
        pushed.push(key);
        if (t.kind === 'session') void syncPr(sess(t.id));
        store.log({ kind: 'push', who: me(), human: true, what: `pushed ${t.branch} (${t.ahead} ${t.ahead === 1 ? 'commit' : 'commits'})`, repo: repoName(t.repoId), sessionId: t.kind === 'session' ? t.id : undefined });
      } catch (e: any) {
        const error = String(e?.message || e).split('\n').slice(-2).join(' ').trim();
        failed.push({ id: key, error });
        store.log({ kind: 'push', who: me(), human: true, what: `push of ${t.branch} failed`, repo: repoName(t.repoId), sessionId: t.kind === 'session' ? t.id : undefined, ok: false, detail: error });
      }
    }
    pushing.clear();
    sessions.pushEpoch++;
    emitState();
    return { pushed, failed, uncommitted };
  },
  async createPr(input) {
    const s = sess(input.sessionId);
    if (s.free) throw new Error('A free agent has no repository to open a pull request in.');
    const extra = input.extraRepoId ? s.extras?.find((x) => x.repoId === input.extraRepoId) : undefined;
    if (input.extraRepoId && !extra) throw new Error('This session has no worktree in ' + input.extraRepoId);
    const repo = repos.must(extra ? extra.repoId : s.repoId);
    const wt = extra ? extra.worktree : s.worktree;
    const branch = extra ? extra.branch : s.branch;
    if (input.files.length) await commitFiles(wt, input.files, input.message || input.title);
    await GH.ensureFresh();
    await G.git(wt, 'push', '-u', 'origin', branch);
    store.log({ kind: 'push', who: me(), human: true, what: `pushed ${branch}`, repo: repo.name, sessionId: s.id });
    const url = await GH.createPull(repo.id, { head: branch, base: input.base, title: prTitle(input.title, 200), body: input.body, draft: input.draft });
    if (extra) { extra.prUrl = url; extra.prAt = Date.now(); }
    else {
      s.prUrl = url;
      s.prAt = Date.now();
      s.removeAfterMerge = input.removeAfterMerge;
      s.deleteBranchAfterMerge = input.deleteBranchAfterMerge;
    }
    store.log({ kind: 'pr', who: me(), human: true, what: `opened a pull request for ${branch}`, repo: repo.name, sessionId: s.id });
    store.save();
    emitState();
    return { url };
  },
  async mergePr(repoId, number, opts) {
    const pr = (await GH.listPulls(repoId)).find((p) => p.number === number);
    if (!pr) throw new Error(`Pull request #${number} was not found.`);
    if (pr.state !== 'open') throw new Error(`#${number} is already ${pr.state}.`);
    if (pr.draft) throw new Error(`#${number} is a draft. Mark it ready for review on GitHub first.`);
    mergingHere.add(`${repoId}#${number}`);
    const mine = sessions.sessions.find((x) => x.prUrl === pr.url);
    if (mine) { mine.deleteBranchAfterMerge = opts.deleteBranch; store.save(); }
    try { await GH.mergePull(repoId, number, opts.method); }
    catch (e: any) { mergingHere.delete(`${repoId}#${number}`); throw new Error(String(e?.message || e).replace(/^GitHub:\s*/, '').replace(/\s*\(\d{3}\)$/, '') || 'GitHub would not merge it.'); }
    if (opts.deleteBranch) await GH.deleteBranch(repoId, pr.branch).catch(() => undefined);
    await pollMerges();
    mergingHere.delete(`${repoId}#${number}`);
    store.log({ kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged PR #${pr.number} “${pr.title}” (${opts.method})`, repo: repoId.split('/')[1] });
    store.save();
    emitState();
  },
  async mergeDirect(input) {
    const s = sess(input.sessionId);
    if (s.free) throw new Error('A free agent has no repository to merge into.');
    const repo = repos.must(s.repoId);
    const base = input.base.replace(/^origin\//, '');
    if (base === s.branch) throw new Error('A session cannot merge into its own branch.');
    if (input.files.length) await commitFiles(s.worktree, input.files, input.message || s.task);
    await G.git(s.worktree, 'fetch', 'origin', base);
    // Bring the branch up to date first, so the push onto the base is a plain fast-forward and nothing on origin is overwritten.
    if (!(await G.gitOk(s.worktree, 'merge-base', '--is-ancestor', `origin/${base}`, 'HEAD'))) {
      try { await G.git(s.worktree, 'merge', '--no-edit', '-m', `Merge ${base} into ${s.branch}`, `origin/${base}`); }
      catch (e: any) {
        await G.gitOk(s.worktree, 'merge', '--abort');
        throw new Error(`${base} has changes that conflict with this branch. Ask the agent to merge ${base} into it and resolve the conflicts, then try again.`);
      }
    }
    try { await G.git(s.worktree, 'push', 'origin', `HEAD:refs/heads/${base}`); store.log({ kind: 'push', who: me(), human: true, what: `pushed ${s.branch} onto ${base}`, repo: repo.name, sessionId: s.id }); }
    catch (e: any) { throw new Error(`GitHub refused the push to ${base}${/protected|denied|declined|rule/i.test(String(e?.message)) ? ', which looks protected: use a pull request instead' : ''}. ${String(e?.message || e).split('\n').slice(-3).join(' ').trim()}`); }
    const sha = (await G.git(s.worktree, 'rev-parse', '--short', 'HEAD')).trim();
    // Keep the local copy of the base branch in step, when that can be done without touching anyone's work.
    let localUpdated = false, localNote: string | undefined;
    try {
      const current = (await G.git(repo.localPath, 'symbolic-ref', '--short', 'HEAD').catch(() => '')).trim();
      if (current === base) {
        if ((await G.git(repo.localPath, 'status', '--porcelain', '--untracked-files=no')).trim()) localNote = `Your checkout of ${base} has uncommitted changes, so it was left alone.`;
        else { await G.git(repo.localPath, 'merge', '--ff-only', `origin/${base}`); localUpdated = true; }
      } else if (await G.gitOk(repo.localPath, 'rev-parse', '--verify', `refs/heads/${base}`)) {
        await G.git(repo.localPath, 'fetch', 'origin', `${base}:${base}`); localUpdated = true;
      }
    } catch (e: any) { localNote = `Your local ${base} could not be fast-forwarded (${String(e?.message || e).split('\n')[0]}).`; }
    s.mergedInto = base;
    s.mergedAt = Date.now();
    store.log({ kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged ${s.branch} into ${base}`, repo: repo.name, sessionId: s.id });
    store.save();
    emitState();
    // A branch cannot be deleted while it is checked out, so deleting it takes the worktree with it.
    if (input.deleteBranchAfterMerge) await G.gitOk(s.worktree, 'push', 'origin', '--delete', s.branch);
    await sessions.finishMerged(s.id, { into: base, at: s.mergedAt }, { worktree: input.removeAfterMerge || input.deleteBranchAfterMerge, branch: input.deleteBranchAfterMerge });
    return { sha, localUpdated, localNote };
  },
  async requestChanges(id, comments) {
    const text = 'Review comments from the user. Please address each one:\n\n' + comments.map((c) => `- ${c.line ? `${c.file}:${c.line}` : c.file}: ${c.text}`).join('\n');
    await sessions.send(id, text);
  },
  async resolveConflict(id, against) {
    const s = sess(id);
    const target = against.replace(/^origin\//, '');
    const base = against.startsWith('origin/');
    const other = base ? undefined : sess(against);
    const steps = base
      ? `git fetch origin ${target}\ngit merge origin/${target}`
      : `git merge ${other!.branch}`;
    const text = `Your branch would conflict with ${base ? against : `the branch ${other!.branch} (another session's work in progress)`}. Please resolve it now:\n\n1. Commit or set aside your uncommitted work first, so the merge can start.\n2. Run:\n${steps}\n3. Resolve every conflict, keeping the intent of both sides, then run the build and tests.\n4. Commit the merge.\n\nDo not discard either side's changes.`;
    await sessions.send(s.id, text);
  },
  async openInEditor(id, path, line) {
    const s = sess(id);
    const kind = store.data.settings.openIn;
    if (path) safePath(s, path);
    if (kind === 'helm') send('navigate', { screen: 'session', id, tab: 'code', file: path, line });
    else openExternalEditor(path ? safePath(s, path) : s.worktree, kind, line);
  },
  async openExternal(url) { if (/^https:\/\//.test(url)) await host.openExternal(url); },
  projectMemory: (id) => projectMemory(repos.must(id).localPath),
  readMemory: (id, path) => readMemory(repos.must(id).localPath, path),
  writeMemory: (id, path, text) => writeMemory(repos.must(id).localPath, path, text),
  deleteMemory: (id, path) => deleteMemory(repos.must(id).localPath, path),
  async commitPushed(id, hash) {
    const out = await G.git(repos.must(id).localPath, 'branch', '-r', '--contains', hash).catch(() => '');
    return out.split(/\r?\n/).some((l) => l.trim() && !l.includes('->'));
  },
  async openFolder(path) { const err = await host.openPath(path); if (err) throw new Error(err); },
  async openRepoInEditor(id) {
    const r = repos.must(id);
    const kind = store.data.settings.openIn;
    if (kind === 'helm') send('navigate', { screen: 'repo', id, tab: 'code' });
    else openExternalEditor(r.localPath, kind);
  },
  checkAgent: (backend, p) => registry.get(backend).version(p),

  async termOpen(id, cols, rows) {
    const cwd = id ? ws(id).worktree : null;
    const st = store.data.settings;
    return terms.open(cwd, cols, rows, st.terminalShell, st.terminalShellCustom);
  },
  async termWrite(id, d) { terms.write(id, d); },
  async termResize(id, c, r) { terms.resize(id, c, r); },
  async termClose(id) { terms.close(id); },
  async copyText(t) { await host.copyText(t); },
  async readClipboard() { return host.readClipboard ? host.readClipboard() : ''; },
  listShells: () => shellOptions(),

  checkpoints: (id) => sessions.checkpoints(id),
  restoreCheckpoint: (id, n) => sessions.restoreTo(id, n),
  forkSession: (id, index, task) => sessions.fork(id, index, task),
  continueExternal: (repoId, extId, task) => sessions.continueExternal(repoId, extId, task),
  createGroup: (input, variants) => sessions.createGroup(input, variants),
  keepFromGroup: (group, keep) => sessions.keepFromGroup(group, keep),
  async revertHunk(id, path, hunk) {
    const s = sess(id);
    safePath(s, path);
    await sessions.snapshot(id, `Before rejecting a hunk in ${path}`);
    await revertHunk(s.worktree, path, hunk);
    await sessions.userEdited(id, path);
    await sessions.refreshStats(s);
  },
  async setHunksReviewed(id, ids, reviewed) { sessions.setReviewed(id, ids, reviewed); },
  startReview: (id) => sessions.review(id),
  async memoryInsights(repoId) {
    const repo = repos.must(repoId);
    const mine = store.data.sessions.filter((s) => s.repoId === repoId);
    const usage: Record<string, MemoryUsage> = {};
    for (const s of mine) {
      for (const f of memoryReads(await store.peekTranscript(s.id))) {
        const u = (usage[f] ||= { sessions: 0, last: 0 });
        u.sessions++; u.last = Math.max(u.last, s.endedAt ?? s.lastAccess);
      }
    }
    const pm = await projectMemory(repo.localPath);
    const files: MemoryFile[] = await Promise.all(pm.memories.map(async (m) => ({ path: m.path, file: m.path.split(/[\\/]/).pop()!, name: m.name, description: m.description, type: m.type, modified: m.modified, index: m.index, text: await readFile(m.path, 'utf8').catch(() => '') })));
    const known = new Set(await G.listFiles(repo.localPath).catch(() => [] as string[]));
    const since = Date.now() - STALE_DAYS * 86_400_000;
    const issues = memoryHealth({ memories: files, usage, now: Date.now(), recentSessions: mine.filter((s) => s.startedAt >= since).length, exists: (p) => known.has(p) || [...known].some((k) => k.startsWith(p.replace(/\/$/, '') + '/')) });
    return { usage, issues, sessions: mine.length };
  },
  async rememberInstruction(repoId, target, text) {
    const repo = repos.must(repoId);
    const file = target === 'user' ? join(home, '.claude', 'CLAUDE.md') : join(repo.localPath, target === 'local' ? 'CLAUDE.local.md' : 'CLAUDE.md');
    await appendInstruction(file, text);
    return file;
  },
  async worktreeUsage(refresh) {
    const out: WorktreeUsage[] = [];
    // A folder you chose for a free agent is yours: it is not measured or cleaned.
    const live = store.data.sessions.filter((s) => !s.worktreeGone && !(s.free && !s.free.managed));
    const todo = live.filter((s) => refresh || !usageCache.has(s.id) || Date.now() - usageCache.get(s.id)!.at > 5 * 60_000);
    // Three at a time: sizing a worktree reads every file in it.
    for (let i = 0; i < todo.length; i += 3) {
      await Promise.all(todo.slice(i, i + 3).map(async (s) => {
        if (!(await G.fileExists(s.worktree))) { usageCache.delete(s.id); return; }
        const [size, rec, info] = await Promise.all([dirSize(s.worktree), reclaimableBytes(s.worktree), sessions.deleteInfo(s.id).catch(() => null)]);
        usageCache.set(s.id, { at: Date.now(), bytes: size.bytes, partial: size.partial, reclaimable: rec.bytes, dirs: rec.dirs, dirty: info?.dirty ?? 0, unpushed: info?.unpushed ?? 0 });
      }));
    }
    for (const s of live) {
      const c = usageCache.get(s.id);
      if (!c) continue;
      out.push({ sessionId: s.id, repoId: s.repoId, branch: s.branch, path: s.worktree, bytes: c.bytes, reclaimable: c.reclaimable, reclaimDirs: c.dirs, partial: c.partial, status: s.status, running: sessions.isRunning(s.id), archived: !!s.archivedAt, merged: !!s.mergedAt, lastAccess: s.lastAccess, dirty: c.dirty, unpushed: c.unpushed });
    }
    return out.sort((a, b) => b.bytes - a.bytes);
  },
  async cleanWorktree(id) {
    const s = sess(id);
    if (s.free && !s.free.managed) throw new Error('That is your own folder, so helm does not clean it.');
    if (sessions.isRunning(id) && (s.status === 'working' || s.status === 'attention')) throw new Error('Stop the session first: removing packages under a running agent breaks its commands.');
    const r = await cleanHeavy(s.worktree);
    usageCache.delete(id);
    if (r.removed.length) store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'done', who: s.id, what: `cleaned ${r.removed.join(', ')} (${(r.bytes / 1e6).toFixed(0)} MB)`, repo: repos.must(s.repoId).name, sessionId: s.id });
    store.save();
    return r.bytes;
  },
  async dropWorktree(id) {
    const s = sess(id);
    if (s.free) throw new Error('Delete a free agent instead: it has no worktree to remove on its own.');
    if (!s.archivedAt && !s.mergedAt) throw new Error('Only archived or merged sessions can lose their worktree.');
    const info = await sessions.deleteInfo(id);
    if (info.dirty) throw new Error(`It has ${info.dirty} uncommitted ${info.dirty === 1 ? 'file' : 'files'}. Commit or discard them first.`);
    if (info.unpushed) throw new Error(`It has ${info.unpushed} ${info.unpushed === 1 ? 'commit' : 'commits'} that are not on GitHub. Push them first.`);
    await sessions.stop(id);
    await G.removeWorktree(repos.must(s.repoId).localPath, s.worktree);
    s.worktreeGone = true;
    usageCache.delete(id);
    store.save();
    emitState();
  },
  async systemStatus() {
    const pt = await sampleSystem(true);
    const disks: SystemStatus['disks'] = [];
    const seen = new Set<string>();
    for (const [label, path] of [['helm data', host.dataDir], ['Worktrees', store.data.sessions.find((s) => !s.worktreeGone)?.worktree || home]] as const) {
      try {
        const f = await statfs(path);
        const id = `${f.blocks}:${f.bfree}`;
        if (seen.has(id)) { disks[disks.length - 1].label += ' and ' + label.toLowerCase(); continue; }
        seen.add(id);
        disks.push({ label, path, total: f.blocks * f.bsize, free: f.bavail * f.bsize });
      } catch { /* a path that is gone has no disk to report */ }
    }
    const m = process.memoryUsage();
    const mem = await memoryLimit();
    const la = os.loadavg();
    return {
      at: pt.t, platform: process.platform, arch: process.arch, hostname: os.hostname(), uptime: os.uptime(), cpu: pt.cpu, cores: os.cpus().length, model: os.cpus()[0]?.model.trim() || '',
      load: [la[0], la[1], la[2]] as [number, number, number], memory: { total: mem.total, used: pt.mem, limited: mem.limited },
      process: { rss: m.rss, heap: m.heapUsed, cpu: pt.proc, pid: process.pid }, disks, history: sysHistory.slice(),
      sessions: { running: store.data.sessions.filter((s) => sessions.isRunning(s.id)).length, total: store.data.sessions.filter((s) => !s.archivedAt).length }
    } satisfies SystemStatus;
  },
  async checkForUpdates() { return host.updates ? host.updates.check() : { state: 'dev' as const }; },
  async installUpdate() { host.updates?.install(); },
  async saveDiagnostics() {
    const gitVersion = (await run('git', ['--version']).catch(() => '')).replace(/^git version\s*/, '').trim() || null;
    const info = host.appInfo?.() ?? { version: 'server', packaged: true };
    const text = diagnostics({
      now: Date.now(), agents: backends.map((b) => ({ label: b.label, version: b.version })), gitVersion, home, settings: store.data.settings, repos: store.data.repos, sessions: store.data.sessions, log: recentLog(),
      app: { version: info.version, electron: info.electron, node: process.versions.node, chrome: info.chrome, platform: process.platform, arch: process.arch, os: (await import('node:os')).release(), packaged: info.packaged }
    });
    return saveFile(`helm-diagnostics-${new Date().toISOString().slice(0, 10)}.md`, text);
  },
  async exportData() { return saveFile(`helm-export-${new Date().toISOString().slice(0, 10)}.json`, await buildExport(store)); },
  async importData(text) {
    const r = await applyImport(store, String(text));
    store.log({ kind: 'git', who: me(), human: true, what: `imported ${r.sessions} sessions and ${r.repos} repositories`, repo: '' });
    emitState();
    return r;
  },
  syncStatus: async () => syncer.status(),
  syncKey: () => syncer.key(),
  syncRegenerateKey: () => syncer.regenerateKey(),
  syncAddPeer: (name, url, key) => syncer.addPeer(String(name), String(url), String(key)),
  syncSetContinuous: (id, on) => syncer.setContinuous(String(id), !!on),
  syncRemovePeer: (id) => syncer.removePeer(String(id)),
  async syncRun(peerId) {
    const r = await syncer.run(peerId);
    const n = r.reduce((a, x) => a + x.result.pulled.sessions + x.result.pushed.sessions, 0);
    if (n) store.log({ kind: 'git', who: me(), human: true, what: `synced ${n} sessions with ${r.map((x) => x.name).join(', ')}`, repo: '' });
    return r;
  },
  async openLogFolder() { const f = logFile(); if (f) host.showInFolder?.(f); },
  async logRenderer(message) { logLine('error', 'window: ' + String(message).slice(0, 2000)); },
  repoWorkflows: (repoId, ref) => GH.listWorkflows(repoId, ref),
  workflowRuns: (repoId, id) => GH.listRuns(repoId, id),
  async runWorkflow(repoId, id, ref, inputs) {
    repos.must(repoId);
    // The inputs are checked here against the file on that branch, not trusted from the window.
    const wf = (await GH.listWorkflows(repoId, ref)).find((w) => w.id === id);
    if (!wf) throw new Error('That workflow was not found.');
    if (!wf.dispatchable) throw new Error(`${wf.name} cannot be started by hand on ${ref}: it has no workflow_dispatch trigger there.`);
    const prepared = prepareInputs(wf.inputs, inputs);
    const bad = Object.entries(prepared.errors);
    if (bad.length) throw new Error(bad.map(([k, v]) => `${k}: ${v}`).join('; '));
    await GH.dispatchWorkflow(repoId, id, ref, prepared.inputs);
    const what = `${wf.name} on ${ref}${Object.keys(prepared.inputs).length ? ' (' + Object.entries(prepared.inputs).map(([k, v]) => `${k}=${v}`).join(', ') + ')' : ''}`;
    store.addAudit({ t: Date.now(), sessionId: '-', repoId, kind: 'dispatch', text: auditText(`Ran workflow ${what}`), decision: 'approved' });
    store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'start', who: store.data.user?.login || 'you', human: true, what: `ran workflow ${what}`, repo: repos.must(repoId).name });
    store.save();
    emitState();
  },
  startQueued: (id) => sessions.startNow(id),
  async searchAll(query, workspace) {
    const q = query.trim();
    const out: SearchResults = { query: q, transcripts: [], commits: [], code: [] };
    if (q.length < 2) return out;
    const recent = [...store.data.sessions].sort((a, b) => b.lastAccess - a.lastAccess).slice(0, 80);
    for (const s of recent) {
      if (out.transcripts.length >= 24) break;
      for (const h of searchEvents(await store.peekTranscript(s.id), q, 2)) out.transcripts.push({ ...h, sessionId: s.id, repoId: s.repoId, title: sessionTitle(s) });
    }
    await Promise.all(store.data.repos.map(async (r) => {
      const log = await G.git(r.localPath, 'log', '--exclude=refs/helm/*', '--all', '-i', '--fixed-strings', `--grep=${q}`, '-n', '8', '--format=%h%x1f%s%x1f%an%x1f%ct').catch(() => '');
      for (const l of log.split('\n').filter(Boolean)) { const [hash, msg, who, ct] = l.split('\x1f'); out.commits.push({ repoId: r.id, hash, msg, who, at: +ct * 1000 }); }
      if (/^[0-9a-f]{5,40}$/i.test(q)) {
        const one = await G.git(r.localPath, 'log', '-n', '1', '--format=%h%x1f%s%x1f%an%x1f%ct', q).catch(() => '');
        const [hash, msg, who, ct] = one.trim().split('\x1f');
        if (hash && !out.commits.some((c) => c.repoId === r.id && c.hash === hash)) out.commits.unshift({ repoId: r.id, hash, msg, who, at: +ct * 1000 });
      }
    }));
    out.commits = out.commits.sort((a, b) => b.at - a.at).slice(0, 15);
    if (workspace && q.length >= 3) {
      try { out.code = (await G.searchFiles(ws(workspace).worktree, q, false)).slice(0, 20).map((h) => ({ ws: workspace, ...h })); } catch { /* workspace gone */ }
    }
    return out;
  },
  cancelQueued: (id) => sessions.dequeue(id),
  repoIssues: (id) => GH.listIssues(id),
  async issueTask(repoId, number) {
    const [issue, comments] = await Promise.all([GH.getIssue(repoId, number), GH.issueComments(repoId, number).catch(() => [])]);
    return { task: issueTask(issue, comments), title: issue.title, url: issue.url };
  },
  async feedbackTask(repoId, number) {
    const pr = (await GH.listPulls(repoId)).find((p) => p.number === number);
    if (!pr) throw new Error(`Pull request #${number} was not found.`);
    const comments = await GH.pullReviewComments(repoId, number);
    if (!comments.length) throw new Error('This pull request has no review comments yet.');
    return { task: feedbackTask(pr, comments), base: 'origin/' + pr.branch, count: comments.length };
  },
  async sendPrFeedback(id) {
    const s = sess(id);
    const n = pullNumber(s.prUrl);
    if (!n) throw new Error('This session has no pull request.');
    const since = s.feedbackAt ?? s.prAt ?? 0;
    const fresh = (await GH.pullReviewComments(s.repoId, n)).filter((c) => Date.parse(c.at) > since && c.author !== store.data.user?.login);
    if (!fresh.length) return 0;
    s.feedbackAt = Math.max(...fresh.map((c) => Date.parse(c.at)));
    store.save();
    await sessions.send(id, feedbackTask({ number: n, title: s.customTitle || s.title || s.task, url: s.prUrl! }, fresh));
    return fresh.length;
  },

  async getReport(days) { return buildReport(reportInput(days)); },
  async reportDigest(days) { return digestMarkdown(reportInput(days), reportMoney); },
  async exportReport(kind, days) {
    const input = reportInput(days);
    const stamp = new Date().toISOString().slice(0, 10);
    return saveFile(`helm-${kind}-${stamp}.${kind === 'digest' ? 'md' : 'csv'}`, kind === 'spend' ? spendCsv(input) : kind === 'sessions' ? sessionsCsv(input) : kind === 'audit' ? auditCsv(input) : digestMarkdown(input, reportMoney));
  }
};

function reportInput(days: number): ReportInput {
  const d = store.data;
  return { sessions: d.sessions, daily: d.daily, audit: d.audit, alwaysAllow: d.settings.alwaysAllow, plan: d.plan, now: Date.now(), days: Math.max(1, Math.min(365, Math.round(days) || 30)) };
}
const reportMoney = (v: number) => fmtMoney(v, store.data.settings.currency, store.data.fx.rates);
/** Hands a generated file to the user: a save dialog on the desktop, a download in the browser. Resolves to where it went, or null if cancelled. */
async function saveFile(name: string, text: string): Promise<string | null> {
  if (!host.saveFile) throw new Error('Saving files is not available here.');
  return host.saveFile(name, text);
}

async function commitFiles(wt: string, files: string[], message: string) {
  await G.git(wt, 'add', '--', ...files);
  const staged = (await G.git(wt, 'diff', '--cached', '--name-only')).trim();
  if (staged) await G.git(wt, 'commit', '-m', message);
}

// ------------------------------------------------------------------ plan usage
let lastPlanProbe = 0;

/**
 * Asks a backend that can for the data behind its usage display, without a message being sent, so the meters can show real
 * numbers at launch instead of waiting for a session to produce a rate-limit event.
 */
export async function refreshPlan(force = false) {
  const st = store.data.settings;
  if (!force && Date.now() - lastPlanProbe < 60_000) return;
  lastPlanProbe = Date.now();
  for (const b of registry.all()) {
    if (!b.planUsage || (b.auth && !logins[b.id]?.loggedIn)) continue;
    if (b.id === 'claude' && st.billingDetected && st.billing !== 'subscription') continue;
    const u = await b.planUsage(home);
    if (!u) continue;
    if (b.id === 'claude' && !st.billingDetected) { st.billing = u.billing; st.billingDetected = true; }
    if (b.id !== 'claude') sessions.setBilling(b.id, u.billing);
    const plan = store.planOf(b.id);
    plan.fiveHour = u.fiveHour ?? plan.fiveHour;
    plan.weekly = u.weekly ?? plan.weekly;
    if (u.fiveHour || u.weekly) plan.at = Date.now();
  }
  store.save();
  emitState();
  void sessions.enforcePlan();
}

// ------------------------------------------------------------------ currency
/** First launch only: pick a display currency from the IP address, falling back to the OS locale. */
async function detectCurrency() {
  const st = store.data.settings;
  if (st.currencyDetected) return;
  let cur: string | null = null;
  try {
    const j: any = await (await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000), headers: { 'User-Agent': 'helm' } })).json();
    if (j?.currency && (CURRENCIES as readonly string[]).includes(j.currency)) cur = j.currency;
  } catch { /* offline or blocked */ }
  cur ||= currencyForRegion(host.locale.split('-')[1]);
  if (!cur) return;
  st.currency = cur;
  st.currencyDetected = true;
  store.save();
  emitState();
}

async function refreshRates() {
  const fx = store.data.fx;
  if (Date.now() - fx.at < 12 * 3600_000 && Object.keys(fx.rates).length) return;
  try {
    const j: any = await (await fetch('https://api.frankfurter.dev/v1/latest?base=USD', { signal: AbortSignal.timeout(5000) })).json();
    if (j?.rates) { store.data.fx = { rates: { USD: 1, ...j.rates }, at: Date.now() }; store.save(); emitState(); }
  } catch { /* the built-in rates cover it */ }
}

// ------------------------------------------------------------------ pushing
/** Commits on `branch` that no remote has: against origin/<branch> when GitHub has the branch, otherwise against everything on origin. */
async function aheadOf(cwd: string, branch: string): Promise<{ ahead: number; onRemote: boolean }> {
  const onRemote = await G.gitOk(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`);
  const args = onRemote ? ['rev-list', '--count', `origin/${branch}..${branch}`] : ['rev-list', '--count', branch, '--not', '--remotes=origin'];
  return { ahead: +(await G.git(cwd, ...args).catch(() => '0')).trim() || 0, onRemote };
}

/** Every branch helm knows of that could be pushed: its sessions' branches, and the branch checked out in each repository's own folder. */
const pushing = new Map<string, { p: Promise<import('../shared/types').PushTarget[]>; epoch: number }>();
async function pushTargets(repoId?: string): Promise<import('../shared/types').PushTarget[]> {
  const out: import('../shared/types').PushTarget[] = [];
  for (const r of store.data.repos.filter((x) => !repoId || x.id === repoId)) {
    const cur = (await G.git(r.localPath, 'symbolic-ref', '--short', '-q', 'HEAD').catch(() => '')).trim();
    if (cur) {
      const dirty = (await G.git(r.localPath, 'status', '--porcelain', '--untracked-files=no').catch(() => '')).split('\n').filter(Boolean).length;
      out.push({ id: '@checkout', kind: 'checkout', repoId: r.id, branch: cur, dirty, ...(await aheadOf(r.localPath, cur)) });
    }
    for (const s of sessions.sessions.filter((x) => x.repoId === r.id && !x.worktreeGone && !x.archivedAt)) {
      if (!(await G.fileExists(s.worktree))) continue;
      // Tracked files only: a full status walks every untracked file, which on a big worktree (node_modules, build output) takes seconds.
      const dirty = (await G.git(s.worktree, 'status', '--porcelain', '--untracked-files=no').catch(() => '')).split('\n').filter(Boolean).length;
      out.push({ id: s.id, kind: 'session', repoId: r.id, branch: s.branch, dirty, ...(await aheadOf(s.worktree, s.branch)) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ pull request description upkeep
const prSynced = new Map<string, string>();
/** Keeps the helm-written summary in a session's open pull request in step with its branch, so commits pushed later show up in the description. A description the user rewrote (no helm block) is left alone. */
async function syncPr(s: { id: string; repoId: string; worktree: string; base: string; task: string; source?: { kind: string; number: number }; prUrl?: string; mergedAt?: number; worktreeGone?: boolean }) {
  const n = pullNumber(s.prUrl);
  if (!n || s.mergedAt || s.worktreeGone) return;
  try {
    const sum = await G.changes(s.worktree, s.base);
    const sig = sum.commits.map((c) => c.hash).join(',');
    if (prSynced.get(s.id) === sig) return;
    const summary = prSummary({ task: s.task, commits: sum.commits, issue: s.source?.kind === 'issue' ? s.source.number : undefined, files: sum.files.length, add: sum.files.reduce((a, f) => a + f.add, 0), del: sum.files.reduce((a, f) => a + f.del, 0) });
    const body = await GH.getPullBody(s.repoId, n);
    const next = replaceSummary(body, summary);
    if (next !== null && next !== body) await GH.updatePullBody(s.repoId, n, next);
    prSynced.set(s.id, sig);
  } catch { /* offline; tried again at the next push or poll */ }
}

// ------------------------------------------------------------------ merged PR cleanup
const mergingHere = new Set<string>();
async function pollMerges() {
  const open = store.data.sessions.filter((s) => s.prUrl && !s.mergedAt);
  const byRepo = new Map<string, typeof open>();
  for (const s of open) byRepo.set(s.repoId, [...(byRepo.get(s.repoId) || []), s]);
  for (const [repoId, list] of byRepo) {
    try {
      const prs = await GH.listPulls(repoId);
      for (const s of list) {
        const pr = prs.find((p) => p.url === s.prUrl);
        if (pr?.state === 'open') await syncPr(s);
        if (pr?.state === 'merged') {
          const delBranch = s.deleteBranchAfterMerge ?? s.removeAfterMerge;
          await sessions.finishMerged(s.id, { into: pr.base }, { worktree: s.removeAfterMerge || delBranch, branch: delBranch });
          if (!mergingHere.has(`${repoId}#${pr.number}`)) store.log({ kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged PR #${pr.number} “${pr.title}”`, repo: repoId.split('/')[1] });
        }
      }
    } catch { /* offline */ }
  }
}

// ------------------------------------------------------------------ conflict forecast
let forecastSig = '';
let forecasting = false;
/** Recomputes who would conflict with whom, but only when something that could change the answer has changed. */
async function refreshForecast() {
  if (forecasting) return;
  const live = store.data.sessions.filter((s) => !s.archivedAt && !s.mergedAt && !s.worktreeGone);
  const sig = live.map((s) => `${s.id}:${s.commits.length}:${s.files}:${s.add}:${s.del}:${Object.keys(s.filesTouched || {}).length}`).join('|');
  if (sig === forecastSig) return;
  forecasting = true;
  try {
    const next = (await Promise.all(store.data.repos.map((r) => forecastRepo(r, live).catch(() => [])))).flat();
    forecastSig = sig;
    if (JSON.stringify(next.map((c) => [c.a, c.b, c.kind, c.files])) !== JSON.stringify(forecast.map((c) => [c.a, c.b, c.kind, c.files]))) { forecast = next; emitState(); }
  } finally { forecasting = false; }
}

// ------------------------------------------------------------------ lifecycle
/** Loads state and starts the background work. Call once, after `host` is ready. */
export async function start(h: Host) {
  host = h;
  await installLogging(host.dataDir);
  startWatchdog();
  await store.load(host.dataDir);
  if (!process.env.HELM_DEV_NO_RECOVER) sessions.recover();
  if (host.companion !== false) void companion.loadKey().then(() => companion.apply());
  GH.setSignInGuard(host.allowLogin ?? null);
  GH.watchAuth(() => G.setGitToken(GH.getToken()), () => { G.setGitToken(null); store.data.user = null; store.save(); emitState(); logLine('warn', 'GitHub rejected the sign-in and it could not be renewed; signed out'); });
  await loadOutboundSecrets(host);
  await syncer.load();
  syncer.start();
  await GH.loadToken(host);
  await GH.ensureFresh();
  // A server's list can change between runs: a token that belongs to someone no longer on it is dropped, not honoured.
  if (host.allowLogin && GH.getToken()) {
    const u = await GH.currentUser().catch(() => null);
    if (!u || !host.allowLogin(u.login)) { await GH.clearToken(); store.data.user = null; }
  }
  G.setGitToken(GH.getToken());
  // git takes the token from the environment, so renew it before it lapses rather than when a push fails.
  setInterval(() => void GH.ensureFresh(15 * 60_000), 5 * 60_000);
  if (!GH.getToken() && !process.env.HELM_DEV_SEED) store.data.user = null;
  await refreshBackends();
  host.setTheme?.(store.data.settings.theme);
  // Sampled all the time, so the System graphs already have a past when the tab is opened.
  void sampleSystem();
  setInterval(() => void sampleSystem(), 5000).unref?.();
  setInterval(pollMerges, 120_000);
  setInterval(() => void automations.tick(), 60_000);
  setTimeout(() => void automations.tick(), 30_000);
  setInterval(() => void refreshForecast(), 20_000);
  setTimeout(() => void refreshForecast(), 4000);
  void detectCurrency().then(refreshRates);
  sessions.autoArchive();
  setInterval(() => sessions.autoArchive(), 3600_000);
  repos.setCacheDir(join(host.dataDir, 'history-cache'));
  setRepoArtifactDir(join(host.dataDir, 'repo-artifacts'));
  void refreshPlan(true);
  setInterval(() => void refreshPlan(), 5 * 60_000);
  setInterval(refreshRates, 6 * 3600_000);
  // Last, so the token, the Claude version and the repositories are ready before agents start again.
  if (store.data.settings.resumeOnLaunch && !process.env.HELM_DEV_NO_RECOVER) void sessions.resumeInterrupted();
}

export async function shutdown() {
  syncer.stop();
  terms.closeAll();
  companion.shutdown();
  sessions.shutdown();
  await store.flushAll().catch(() => undefined);
}

/** What a desktop shell needs to reach into (its tray lists and answers sessions). */
export { sessions, store };
/** For a host with a web address: answers another instance's sync request. */
export const syncHttp = { subscribe: (ring: () => void, hangUp: () => void) => syncer.subscribe(ring, hangUp), authorised: (h: string | undefined) => syncer.authorised(h), isOn: () => syncer.isOn(), handle: (m: string, p: string, b: string) => syncer.handle(m, p, b) };
export type { TranscriptEvent };
