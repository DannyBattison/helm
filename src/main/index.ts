import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, nativeTheme, shell } from 'electron';
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, isAbsolute } from 'node:path';
import type { AppState, HelmApi, HelmEvents, Settings, TranscriptEvent } from '../shared/types';
import * as G from './git';
import * as GH from './github';
import { RepoService } from './repos';
import { SessionManager } from './sessions';
import { Store } from './store';
import { Terminals } from './terminal';
import { expandHome, home, run } from './util';

let win: BrowserWindow | null = null;
let claudeVersion: string | null = null;
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
    tokensToday: store.tokensToday(),
    claudeVersion,
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
  }, 60);
}

const repos = new RepoService(store, emitState);
const sessions = new SessionManager(store, {
  emitState,
  emitTranscript: (sessionId, index, event) => send('transcript', { sessionId, index, event }),
  toast: (t) => send('toast', t),
  claudePath: () => undefined,
  notify(kind, title, body, sessionId) {
    const st = store.data.settings;
    const pref = kind === 'attention' ? st.notifyAttention : kind === 'ready' ? st.notifyReady : st.notifyFailed;
    if (!pref.desktop || !Notification.isSupported() || (win && win.isFocused())) return;
    const n = new Notification({ title, body, silent: !pref.sound });
    n.on('click', () => {
      win?.show();
      win?.focus();
      send('navigate', { screen: 'session', id: sessionId, tab: kind === 'ready' ? 'changes' : 'conversation' });
    });
    n.show();
  }
});
const terms = new Terminals((id, data) => send('termData', { id, data }), (id) => send('termExit', { id }));

// ------------------------------------------------------------------ helpers
const sess = (id: string) => {
  const s = sessions.get(id);
  if (!s) throw new Error('Session not found');
  return s;
};
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

function applyTheme() {
  const t = store.data.settings.theme;
  nativeTheme.themeSource = t;
  if (win && process.platform !== 'darwin') {
    const dark = nativeTheme.shouldUseDarkColors;
    try { win.setTitleBarOverlay({ color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 }); } catch { /* not supported */ }
  }
}

function openExternalEditor(path: string, kind: string) {
  const cmd = kind === 'VS Code' ? 'code' : kind === 'Cursor' ? 'cursor' : kind === 'Zed' ? 'zed' : '';
  if (!cmd) return;
  spawn(cmd, [path], { shell: process.platform === 'win32', detached: true, stdio: 'ignore' }).unref();
}

// ------------------------------------------------------------------ API
const api: HelmApi = {
  async getState() { return buildState(); },
  async updateSettings(patch: Partial<Settings>) {
    Object.assign(store.data.settings, patch);
    if ('theme' in patch) applyTheme();
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
  repoHistory: (id) => repos.history(id, store.data.sessions),
  repoWorktrees: (id) => repos.worktrees(id, store.data.sessions),
  repoPulls: async (id) => GH.listPulls(id),
  commitFiles: (id, hash) => repos.commitFiles(id, hash),
  async removeWorktree(repoId, path) {
    const r = repos.must(repoId);
    const s = store.data.sessions.find((x) => x.repoId === repoId && x.worktree === path);
    if (s) await sessions.remove(s.id, true);
    else await G.removeWorktree(r.localPath, path);
  },

  createSession: (input) => sessions.create(input),
  sendMessage: (id, text) => sessions.send(id, text),
  interrupt: (id) => sessions.interrupt(id),
  stopSession: (id) => sessions.stop(id),
  async resumeSession(id) { await sessions.send(id, 'Continue where you left off.'); },
  deleteSession: (id, rm) => sessions.remove(id, rm),
  setSessionModel: (id, m) => sessions.setModel(id, m),
  setSessionPermMode: (id, m) => sessions.setPermMode(id, m),
  resolveAsk: (id, askId, answer) => sessions.resolveAsk(id, askId, answer),
  getTranscript: (id) => store.transcript(id),

  async listTree(id, dir) { return repos.tree(sess(id).worktree, dir); },
  async readFile(id, path) {
    const abs = safePath(sess(id), path);
    const st = await stat(abs);
    if (st.size > 3 * 1024 * 1024) return { text: '', binary: true };
    const buf = await readFile(abs);
    if (buf.subarray(0, 8000).includes(0)) return { text: '', binary: true };
    return { text: buf.toString('utf8'), binary: false };
  },
  async writeFile(id, path, text) {
    const s = sess(id);
    await writeFile(safePath(s, path), text, 'utf8');
    await sessions.userEdited(id, path);
    await sessions.refreshStats(s);
  },
  async fileGitLines(id, path) {
    const s = sess(id);
    const added: number[] = [], modified: number[] = [];
    const tracked = await G.gitOk(s.worktree, 'ls-files', '--error-unmatch', path);
    if (!tracked) {
      const n = (await readFile(safePath(s, path), 'utf8').catch(() => '')).split('\n').length;
      for (let i = 1; i <= n; i++) added.push(i);
      return { added, modified };
    }
    const out = await G.git(s.worktree, 'diff', '-U0', 'HEAD', '--', path);
    for (const m of out.matchAll(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      const oldN = m[1] === undefined ? 1 : +m[1], start = +m[2], len = m[3] === undefined ? 1 : +m[3];
      for (let i = 0; i < len; i++) (oldN === 0 ? added : modified).push(start + i);
    }
    return { added, modified };
  },
  async fileBlame(id, path) {
    const s = sess(id);
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
  async changedFiles(id) { return G.dirtyFiles(sess(id).worktree); },
  async changes(id) { const s = sess(id); return G.changes(s.worktree, s.base); },
  async fileDiff(id, path) { const s = sess(id); return G.fileDiff(s.worktree, s.base, path); },

  async commitOnly(id, files, message) {
    const s = sess(id);
    await commitFiles(s.worktree, files, message);
    await sessions.refreshStats(s);
  },
  async createPr(input) {
    const s = sess(input.sessionId);
    const repo = repos.must(s.repoId);
    if (input.files.length) await commitFiles(s.worktree, input.files, input.message || input.title);
    await G.git(s.worktree, 'push', '-u', 'origin', s.branch);
    const url = await GH.createPull(repo.id, { head: s.branch, base: input.base, title: input.title, body: input.body, draft: input.draft });
    s.prUrl = url;
    s.removeAfterMerge = input.removeAfterMerge;
    store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'ready', who: s.id, what: `opened a pull request`, repo: repo.name, sessionId: s.id });
    store.save();
    emitState();
    return { url };
  },
  async requestChanges(id, comments) {
    const text = 'Review comments from the user. Please address each one:\n\n' + comments.map((c) => `- ${c.file}:${c.line}: ${c.text}`).join('\n');
    await sessions.send(id, text);
  },
  async openInEditor(id, path) {
    const s = sess(id);
    const kind = store.data.settings.openIn;
    if (kind === 'helm') send('navigate', { screen: 'session', id, tab: 'code' });
    else openExternalEditor(path ? safePath(s, path) : s.worktree, kind);
  },
  async openExternal(url) { if (/^https:\/\//.test(url)) await shell.openExternal(url); },
  checkClaude: (p) => detectClaude(p),

  async termOpen(id, cols, rows) {
    const cwd = id ? sess(id).worktree : null;
    return terms.open(cwd, cols, rows);
  },
  async termWrite(id, d) { terms.write(id, d); },
  async termResize(id, c, r) { terms.resize(id, c, r); },
  async termClose(id) { terms.close(id); },
  async copyText(t) { clipboard.writeText(t); }
};

async function commitFiles(wt: string, files: string[], message: string) {
  await G.git(wt, 'add', '--', ...files);
  const staged = (await G.git(wt, 'diff', '--cached', '--name-only')).trim();
  if (staged) await G.git(wt, 'commit', '-m', message);
}

// ------------------------------------------------------------------ merged PR cleanup
async function pollMerges() {
  const open = store.data.sessions.filter((s) => s.prUrl && s.removeAfterMerge);
  const byRepo = new Map<string, typeof open>();
  for (const s of open) byRepo.set(s.repoId, [...(byRepo.get(s.repoId) || []), s]);
  for (const [repoId, list] of byRepo) {
    try {
      const prs = await GH.listPulls(repoId);
      for (const s of list) {
        const pr = prs.find((p) => p.url === s.prUrl);
        if (pr?.state === 'merged') {
          await sessions.remove(s.id, true);
          store.data.activity.unshift({ id: Math.random().toString(36).slice(2), t: Date.now(), kind: 'merge', who: store.data.user?.login || 'you', human: true, what: `merged PR #${pr.number} “${pr.title}”`, repo: repoId.split('/')[1] });
        }
      }
    } catch { /* offline */ }
  }
}

// ------------------------------------------------------------------ window
function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 700, show: false,
    backgroundColor: dark ? '#0e0e12' : '#fbfbfc',
    title: 'helm',
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] || 'x://')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    await store.load();
    sessions.recover();
    await GH.loadToken();
    G.setGitToken(GH.getToken());
    if (!GH.getToken()) store.data.user = null;
    claudeVersion = await detectClaude(store.data.settings.claudePath);
    for (const name of Object.keys(api) as (keyof HelmApi)[]) {
      ipcMain.handle(name, async (_e, ...args) => (api[name] as any)(...args));
    }
    nativeTheme.themeSource = store.data.settings.theme;
    createWindow();
    setInterval(pollMerges, 120_000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('before-quit', async (e) => {
    if ((app as any).__closing) return;
    e.preventDefault();
    (app as any).__closing = true;
    terms.closeAll();
    await sessions.stopAll().catch(() => undefined);
    await store.flushAll().catch(() => undefined);
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

export type { TranscriptEvent };
