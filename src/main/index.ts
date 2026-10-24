import { getSessionInfo, getSessionMessages, listSessions, query } from '@anthropic-ai/claude-agent-sdk';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { AppState, ExternalTranscript, WorktreeUsage, HelmApi, HelmEvents, Settings, TranscriptEvent } from '../shared/types';
import * as G from './git';
import * as GH from './github';
import { AppTray } from './tray';
import { checkForUpdates, initUpdater, installUpdate, updateStatus } from './updater';
import { installLogging, logFile, logLine, recentLog } from './log';
import { cleanHeavy, dirSize, reclaimableBytes } from './disk';
import { diagnostics } from '../shared/diagnostics';
import { appendInstruction, deleteMemory, projectMemory, readMemory, writeMemory } from './memory';
import { memoryHealth, memoryReads, STALE_DAYS, type MemoryFile, type MemoryUsage } from '../shared/memoryhealth';
import { RepoService } from './repos';
import { forecastRepo, revertHunk } from './review';
import { SessionManager } from './sessions';
import { Store } from './store';
import { Terminals } from './terminal';
import { expandHome, home, run } from './util';
import { CURRENCIES, currencyForRegion, fmtMoney, fromDisplay } from '../shared/money';
import { notifyDecision } from '../shared/notify';
import { auditText } from '../shared/redact';
import { prepareInputs } from '../shared/workflows';
import { searchEvents, type SearchResults } from '../shared/search';
import { sessionTitle } from '../shared/types';
import { feedbackTask, issueTask, pullNumber } from '../shared/issues';
import { auditCsv, buildReport, digestMarkdown, sessionsCsv, spendCsv, type ReportInput } from '../shared/reports';

let win: BrowserWindow | null = null;
let claudeVersion: string | null = null;
let forecast: import('../shared/forecast').Conflict[] = [];
const usageCache = new Map<string, { at: number; bytes: number; partial: boolean; reclaimable: number; dirs: string[]; dirty: number; unpushed: number }>();
const store = new Store();

function send<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ------------------------------------------------------------------ state
let stateTimer: NodeJS.Timeout | null = null;
function buildState(): AppState {
  return {
    ready: true,
    user: store.data.user,
    repos: store.data.repos,
    sessions: store.data.sessions,
    activity: store.data.activity,
    settings: store.data.settings,
    weekSpend: store.weekSpend(),
    lifetime: store.data.totals,
    tokensToday: store.tokensToday(),
    forecast,
    update: updateStatus(),
    claudeVersion,
    plan: store.data.plan,
    rates: store.data.fx.rates,
    platform: process.platform,
    home
  };
}
function emitState() {
  if (stateTimer) return;
  stateTimer = setTimeout(() => {
    stateTimer = null;
    send('state', buildState());
    const need = store.data.sessions.filter((s) => s.status === 'attention').length;
    try { app.setBadgeCount(need); } catch { /* unsupported */ }
    tray.update();
  }, 60);
}

const repos = new RepoService(store, emitState);
const sessions = new SessionManager(store, {
  emitState,
  emitTranscript: (sessionId, index, event) => send('transcript', { sessionId, index, event }),
  toast: (t) => send('toast', t),
  claudePath: () => {
    // The SDK resolves its bundled binary inside app.asar, where it cannot be executed.
    if (!app.isPackaged) return undefined;
    const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const p = join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, exe);
    return existsSync(p) ? p : undefined;
  },
  notify(kind, title, body, sessionId) {
    const st = store.data.settings;
    const repoId = sessions.get(sessionId)?.repoId || '';
    const d = notifyDecision(st, kind, repoId);
    if (!d.show || !Notification.isSupported() || (win && win.isFocused())) return;
    const ask = kind === 'attention' ? sessions.get(sessionId)?.ask : undefined;
    // macOS can show buttons on a notification, so a plain approval can be answered without opening helm.
    const buttons = process.platform === 'darwin' && ask?.type === 'approve';
    const n = new Notification({ title, body, silent: !d.sound, ...(buttons ? { actions: [{ type: 'button', text: 'Approve' }, { type: 'button', text: 'Deny' }] } : {}) });
    if (buttons) n.on('action', (_e, i) => { if (sessions.get(sessionId)?.ask?.id === ask!.id) void sessions.resolveAsk(sessionId, ask!.id, { decision: i === 0 ? 'approve' : 'deny' }); });
    n.on('click', () => {
      win?.show();
      win?.focus();
      send('navigate', { screen: 'session', id: sessionId, tab: kind === 'ready' ? 'changes' : 'conversation' });
    });
    n.show();
  }
});
const hidesToTray = () => store.data.settings.tray && process.platform === 'win32';
const showWindow = () => { if (!win) createWindow(); win?.show(); win?.focus(); };
const tray = new AppTray({
  sessions: () => store.data.sessions,
  enabled: () => store.data.settings.tray,
  show: showWindow,
  inbox: () => { showWindow(); send('navigate', { screen: 'inbox' }); },
  newSession: () => { showWindow(); send('toast', { tone: 'neutral', title: 'Press ' + (process.platform === 'darwin' ? '⌘N' : 'Ctrl+N') + ' to start a session' }); },
  quit: () => app.quit(),
  act(sessionId, askId, action) {
    const s = sessions.get(sessionId);
    if (!s) return;
    const ask = s.ask;
    if (action.do === 'open') { showWindow(); send('navigate', { screen: 'session', id: sessionId, tab: s.status === 'ready' ? 'changes' : 'conversation' }); return; }
    if (action.do === 'resume') { void sessions.send(sessionId, 'Continue where you left off.').catch(() => undefined); return; }
    // The menu may be older than the question: only answer the one it was built for.
    if (!ask || ask.id !== askId) { showWindow(); send('navigate', { screen: 'inbox' }); return; }
    const answer = action.do === 'approve' ? { decision: 'approve' as const } : action.do === 'always' ? { decision: 'always' as const } : action.do === 'deny' ? { decision: 'deny' as const }
      : action.do === 'answer' && ask.questions?.[0]?.options[action.option] ? { answers: { [ask.questions[0].question]: ask.questions[0].options[action.option].label } }
      : action.do === 'continue' ? { addBudget: ask.scope === 'plan' ? 0 : fromDisplay(5, store.data.settings.currency, store.data.fx.rates) } : null;
    if (answer) void sessions.resolveAsk(sessionId, ask.id, answer).catch((e) => logLine('error', 'tray action failed: ' + String(e?.message || e)));
  }
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

async function detectClaude(path: string): Promise<string | null> {
  try {
    const out = await run(path || 'claude', ['--version'], { timeout: 8000 });
    return out.trim().split(/\s+/)[0] || null;
  } catch { return null; }
}

// ------------------------------------------------------------------ external transcripts
// A session file can be gigabytes (one of the real ones is 1.7 GB, of which 832 lines are the conversation), and reading it
// takes seconds. So it is read once in the background, kept in memory keyed by file size and modification time, and only
// read again when that changes, no more often than a few times its own read time. Callers get a window of the result.
const extCache = new Map<string, { sig: string; events: TranscriptEvent[]; at: number; readMs: number }>();
const extLoading = new Map<string, Promise<void>>();
const extError = new Map<string, string>();

async function extSig(id: string): Promise<string> {
  try { const i = await getSessionInfo(id); return i ? `${i.lastModified}:${i.fileSize}` : ''; } catch { return ''; }
}

async function externalTranscript(repoId: string, sessionId: string, opts: { start?: number; end?: number; tail?: number } = {}): Promise<ExternalTranscript> {
  const repo = repos.must(repoId);
  const sig = await extSig(sessionId);
  let c = extCache.get(sessionId);
  const changed = !c || c.sig !== sig;
  if (changed && !extLoading.has(sessionId) && (!c || Date.now() - c.at > Math.max(4000, c.readMs * 3))) {
    const t0 = Date.now();
    const p = getSessionMessages(sessionId)
      .then((msgs) => {
        extCache.set(sessionId, { sig, events: sessions.convertMessages(msgs as any[], repo.localPath, true), at: Date.now(), readMs: Date.now() - t0 });
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

/** Claude Code's own list of sessions that have a process running right now, or null when it can't be asked. */
function claudeExe(): string | undefined {
  const bin = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const dir = `claude-agent-sdk-${process.platform}-${process.arch}`;
  const exe = store.data.settings.claudePath || join(app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath(), 'node_modules', '@anthropic-ai', dir, bin);
  return existsSync(exe) ? exe : undefined;
}

async function liveClaudeSessions(): Promise<Set<string> | null> {
  const exe = claudeExe();
  try {
    const out = await run(exe || 'claude', ['agents', '--json'], { timeout: 8000 });
    return new Set((JSON.parse(out) as any[]).map((x) => x.sessionId));
  } catch { return null; }
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
  const t = store.data.settings.theme;
  nativeTheme.themeSource = t;
  if (win && process.platform !== 'darwin') {
    const dark = nativeTheme.shouldUseDarkColors;
    try { win.setTitleBarOverlay({ color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 }); } catch { /* not supported */ }
  }
}

function openExternalEditor(path: string, kind: string, line?: number) {
  const cmd = kind === 'VS Code' ? 'code' : kind === 'Cursor' ? 'cursor' : kind === 'Zed' ? 'zed' : '';
  if (!cmd) return;
  // VS Code and Cursor take `--goto file:line`; Zed takes `file:line`.
  const args = line && kind !== 'Zed' ? ['--goto', `${path}:${line}`] : [line ? `${path}:${line}` : path];
  spawn(cmd, args.map((a) => (process.platform === 'win32' ? `"${a}"` : a)), { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
}

// ------------------------------------------------------------------ API
const api: HelmApi = {
  async getState() { return buildState(); },
  async updateSettings(patch: Partial<Settings>) {
    Object.assign(store.data.settings, patch);
    if ('theme' in patch) applyTheme();
    if ('billing' in patch && patch.billing === 'subscription') void refreshPlan(true);
    if ('archiveAfterDays' in patch) sessions.autoArchive();
    if ('tray' in patch) tray.update();
    if ('planPause5h' in patch || 'planPauseWeek' in patch || 'billing' in patch) void sessions.enforcePlan();
    if ('claudePath' in patch) claudeVersion = await detectClaude(store.data.settings.claudePath);
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
  async signOut() {
    GH.cancelDeviceFlow();
    await GH.clearToken();
    G.setGitToken(null);
    store.data.user = null;
    store.save();
    emitState();
  },

  async listGithubRepos() { return GH.listRepos(new Set(store.data.repos.map((r) => r.id))); },
  async cloneRepos(ids) { for (const id of ids) await repos.cloneSlug(id); },
  async cloneUrl(url, dir) { await repos.cloneUrl(url, dir); },
  async inspectClone(path) { return repos.inspect(path); },
  async addLocalRepo(path) { await repos.addFromPath(expandHome(path)); },
  async removeRepo(id) {
    if (store.data.sessions.some((s) => s.repoId === id)) throw new Error('Remove or delete this repository\'s sessions first.');
    await repos.remove(id);
  },
  async setRepoCap(id, cap) { repos.must(id).cap = cap; store.save(); emitState(); },
  async chooseFolder() {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  async fetchRepo(id) { await repos.fetch(id); },
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
    else await G.removeWorktree(r.localPath, path);
  },

  createSession: (input) => sessions.create(input),
  sendMessage: (id, text, images) => sessions.send(id, text, images),
  setSessionEffort: (id, e) => sessions.setEffort(id, e),
  interrupt: (id) => sessions.interrupt(id),
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
  async setRepoMaxSubagents(id, max) { repos.must(id).maxSubagents = max ?? undefined; store.save(); emitState(); },
  resolveAsk: (id, askId, answer) => sessions.resolveAsk(id, askId, answer),
  getTranscript: (id) => store.transcript(id),

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
    const live = await liveClaudeSessions();
    const own = new Set(store.data.sessions.map((s) => s.claudeSessionId).filter(Boolean));
    const list = await listSessions({ dir: r.localPath, includeWorktrees: true });
    return list
      .filter((x) => !own.has(x.sessionId))
      .map((x) => ({
        id: x.sessionId, title: x.customTitle || x.summary || x.firstPrompt || 'Untitled session', firstPrompt: x.firstPrompt, branch: x.gitBranch, cwd: x.cwd,
        lastModified: x.lastModified, createdAt: x.createdAt, size: x.fileSize, active: live ? live.has(x.sessionId) : Date.now() - x.lastModified < 90_000,
        ...externalArchiveState(x.sessionId, x.lastModified, live ? live.has(x.sessionId) : Date.now() - x.lastModified < 90_000)
      }))
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
  async changes(id) { const s = sess(id); return G.changes(s.worktree, s.base); },
  async fileDiff(id, path) { const s = sess(id); return G.fileDiff(s.worktree, s.base, path); },

  async commitOnly(id, files, message) {
    const w = ws(id);
    await commitFiles(w.worktree, files, message);
    const s = w.sessionId ? sessions.get(w.sessionId) : undefined;
    if (s) await sessions.refreshStats(s);
  },
  async pushStatus(repoId) { return pushTargets(repoId); },
  async push({ repoId, target }) {
    const pushed: string[] = [], failed: { id: string; error: string }[] = [];
    let uncommitted = 0;
    const list = (await pushTargets(repoId)).filter((t) => (!target || t.id === `${t.repoId}${t.kind === 'checkout' ? '' : ''}` || t.id === target || (target === '@checkout' && t.kind === 'checkout')) && t.ahead > 0);
    for (const t of list) {
      const key = t.kind === 'checkout' ? `${t.repoId} (${t.branch})` : t.id;
      try {
        const cwd = t.kind === 'checkout' ? repos.must(t.repoId).localPath : sess(t.id).worktree;
        if (t.dirty) uncommitted++;
        await G.git(cwd, 'push', '-u', 'origin', t.branch);
        pushed.push(key);
      } catch (e: any) { failed.push({ id: key, error: String(e?.message || e).split('\n').slice(-2).join(' ').trim() }); }
    }
    emitState();
    return { pushed, failed, uncommitted };
  },
  async createPr(input) {
    const s = sess(input.sessionId);
    if (s.free) throw new Error('A free agent has no repository to open a pull request in.');
    const repo = repos.must(s.repoId);
    if (input.files.length) await commitFiles(s.worktree, input.files, input.message || input.title);
    await G.git(s.worktree, 'push', '-u', 'origin', s.branch);
    const url = await GH.createPull(repo.id, { head: s.branch, base: input.base, title: input.title, body: input.body, draft: input.draft });
    s.prUrl = url;
    s.prAt = Date.now();
    s.removeAfterMerge = input.removeAfterMerge;
    s.deleteBranchAfterMerge = input.deleteBranchAfterMerge;
    store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'ready', who: s.id, what: `opened a pull request`, repo: repo.name, sessionId: s.id });
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
    store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged PR #${pr.number} “${pr.title}” (${opts.method})`, repo: repoId.split('/')[1] });
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
    try { await G.git(s.worktree, 'push', 'origin', `HEAD:refs/heads/${base}`); }
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
    store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged ${s.branch} into ${base}`, repo: repo.name, sessionId: s.id });
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
  async openInEditor(id, path, line) {
    const s = sess(id);
    const kind = store.data.settings.openIn;
    if (path) safePath(s, path);
    if (kind === 'helm') send('navigate', { screen: 'session', id, tab: 'code', file: path, line });
    else openExternalEditor(path ? safePath(s, path) : s.worktree, kind, line);
  },
  async openExternal(url) { if (/^https:\/\//.test(url)) await shell.openExternal(url); },
  projectMemory: (id) => projectMemory(repos.must(id).localPath),
  readMemory: (id, path) => readMemory(repos.must(id).localPath, path),
  writeMemory: (id, path, text) => writeMemory(repos.must(id).localPath, path, text),
  deleteMemory: (id, path) => deleteMemory(repos.must(id).localPath, path),
  async commitPushed(id, hash) {
    const out = await G.git(repos.must(id).localPath, 'branch', '-r', '--contains', hash).catch(() => '');
    return out.split(/\r?\n/).some((l) => l.trim() && !l.includes('->'));
  },
  async openFolder(path) { const err = await shell.openPath(path); if (err) throw new Error(err); },
  async openRepoInEditor(id) {
    const r = repos.must(id);
    const kind = store.data.settings.openIn;
    if (kind === 'helm') send('navigate', { screen: 'repo', id, tab: 'code' });
    else openExternalEditor(r.localPath, kind);
  },
  checkClaude: (p) => detectClaude(p),

  async termOpen(id, cols, rows) {
    const cwd = id ? ws(id).worktree : null;
    return terms.open(cwd, cols, rows);
  },
  async termWrite(id, d) { terms.write(id, d); },
  async termResize(id, c, r) { terms.resize(id, c, r); },
  async termClose(id) { terms.close(id); },
  async copyText(t) { clipboard.writeText(t); },

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
  checkForUpdates: () => checkForUpdates(),
  async installUpdate() { installUpdate(); },
  async saveDiagnostics() {
    const gitVersion = (await run('git', ['--version']).catch(() => '')).replace(/^git version\s*/, '').trim() || null;
    const text = diagnostics({
      now: Date.now(), claudeVersion, gitVersion, home, settings: store.data.settings, repos: store.data.repos, sessions: store.data.sessions, log: recentLog(),
      app: { version: app.getVersion(), electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: process.platform, arch: process.arch, os: (await import('node:os')).release(), packaged: app.isPackaged }
    });
    const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), `helm-diagnostics-${new Date().toISOString().slice(0, 10)}.md`) });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, text, 'utf8');
    return r.filePath;
  },
  async openLogFolder() { const f = logFile(); if (f) shell.showItemInFolder(f); },
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
    const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), `helm-${kind}-${stamp}.${kind === 'digest' ? 'md' : 'csv'}`) });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, kind === 'spend' ? spendCsv(input) : kind === 'sessions' ? sessionsCsv(input) : kind === 'audit' ? auditCsv(input) : digestMarkdown(input, reportMoney), 'utf8');
    return r.filePath;
  }
};

function reportInput(days: number): ReportInput {
  const d = store.data;
  return { sessions: d.sessions, daily: d.daily, audit: d.audit, alwaysAllow: d.settings.alwaysAllow, plan: d.plan, now: Date.now(), days: Math.max(1, Math.min(365, Math.round(days) || 30)) };
}
const reportMoney = (v: number) => fmtMoney(v, store.data.settings.currency, store.data.fx.rates);

async function commitFiles(wt: string, files: string[], message: string) {
  await G.git(wt, 'add', '--', ...files);
  const staged = (await G.git(wt, 'diff', '--cached', '--name-only')).trim();
  if (staged) await G.git(wt, 'commit', '-m', message);
}

// ------------------------------------------------------------------ plan usage
let lastPlanProbe = 0;
const idleInput = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => undefined) }) };

/**
 * Asks Claude Code for the data behind its /usage command. It answers without a message being sent, so the meters
 * can show real numbers at launch instead of waiting for a session to produce a rate-limit event.
 */
async function refreshPlan(force = false) {
  const st = store.data.settings;
  if (st.billingDetected && st.billing !== 'subscription') return;
  if (!force && Date.now() - lastPlanProbe < 60_000) return;
  lastPlanProbe = Date.now();
  let q: any;
  try {
    q = query({ prompt: idleInput as any, options: { cwd: home, settingSources: [], ...(claudeExe() ? { pathToClaudeCodeExecutable: claudeExe() } : {}) } as any });
    const u: any = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20_000))
    ]);
    if (!st.billingDetected) { st.billing = u.subscription_type ? 'subscription' : 'api'; st.billingDetected = true; }
    const rl = u.rate_limits;
    if (u.rate_limits_available && rl) {
      const win = (w: any) => (w && w.utilization != null && w.resets_at ? { util: w.utilization / 100, resetsAt: Date.parse(w.resets_at) / 1000 } : undefined);
      const plan = store.data.plan;
      plan.fiveHour = win(rl.five_hour) ?? plan.fiveHour;
      plan.weekly = win(rl.seven_day) ?? plan.weekly;
      plan.at = Date.now();
    }
    store.save();
    emitState();
    void sessions.enforcePlan();
  } catch { /* experimental API, or Claude Code isn't signed in: the events from sessions still update the meters */ } finally {
    try { q?.close(); } catch { /* already closed */ }
  }
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
  cur ||= currencyForRegion(app.getLocale().split('-')[1]);
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
      const dirty = (await G.git(s.worktree, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length;
      out.push({ id: s.id, kind: 'session', repoId: r.id, branch: s.branch, dirty, ...(await aheadOf(s.worktree, s.branch)) });
    }
  }
  return out;
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
        if (pr?.state === 'merged') {
          const delBranch = s.deleteBranchAfterMerge ?? s.removeAfterMerge;
          await sessions.finishMerged(s.id, { into: pr.base }, { worktree: s.removeAfterMerge || delBranch, branch: delBranch });
          if (!mergingHere.has(`${repoId}#${pr.number}`)) store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged PR #${pr.number} “${pr.title}”`, repo: repoId.split('/')[1] });
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

// ------------------------------------------------------------------ window
const iconPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'build', 'icon.png');

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 700, show: false,
    backgroundColor: dark ? '#0e0e12' : '#fbfbfc',
    title: 'helm',
    icon: iconPath,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] || 'x://')) e.preventDefault(); });
  // With the tray on, closing the window hides helm and leaves the sessions running.
  // Only on Windows, where the tray is reliable: some Linux desktops show no tray, and the window would be unreachable.
  win.on('close', (e) => { if (hidesToTray() && !(app as any).__closing) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    await installLogging(app.getPath('userData'));
    await store.load();
    if (!process.env.HELM_DEV_NO_RECOVER) sessions.recover();
    await GH.loadToken();
    G.setGitToken(GH.getToken());
    if (!GH.getToken() && !process.env.HELM_DEV_SEED) store.data.user = null;
    claudeVersion = await detectClaude(store.data.settings.claudePath);
    for (const name of Object.keys(api) as (keyof HelmApi)[]) {
      ipcMain.handle(name, async (_e, ...args) => (api[name] as any)(...args));
    }
    nativeTheme.themeSource = store.data.settings.theme;
    if (process.platform === 'darwin') app.dock?.setIcon(iconPath);
    createWindow();
    initUpdater({ enabled: () => store.data.settings.autoUpdate, changed: emitState });
    tray.update();
    app.on('render-process-gone', (_e, _wc, d) => logLine('error', `window process gone: ${d.reason} (exit ${d.exitCode})`));
    app.on('child-process-gone', (_e, d) => logLine('error', `${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));
    setInterval(pollMerges, 120_000);
    setInterval(() => void refreshForecast(), 20_000);
    setTimeout(() => void refreshForecast(), 4000);
    void detectCurrency().then(refreshRates);
    sessions.autoArchive();
    setInterval(() => sessions.autoArchive(), 3600_000);
    repos.setCacheDir(join(app.getPath('userData'), 'history-cache'));
    void refreshPlan(true);
    setInterval(() => void refreshPlan(), 5 * 60_000);
    win?.on('focus', () => void refreshPlan());
    setInterval(refreshRates, 6 * 3600_000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('before-quit', async (e) => {
    if ((app as any).__closing) return;
    e.preventDefault();
    (app as any).__closing = true;
    terms.closeAll();
    tray.destroy();
    sessions.shutdown();
    await store.flushAll().catch(() => undefined);
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !hidesToTray()) app.quit(); });
}

export type { TranscriptEvent };
