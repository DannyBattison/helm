import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, nativeTheme, powerSaveBlocker, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HelmApi, HelmEvents } from '../../src/shared/types';
import { api, emitState, refreshPlan, sessions, shutdown, start, store } from '../../src/core/core';
import { logLine } from '../../src/core/log';
import { fromDisplay } from '../../src/shared/money';
import { AppTray } from './tray';
import { checkForUpdates, initUpdater, installUpdate, updateStatus } from './updater';
import type { Host } from '../../src/core/host';

// The desktop app: Electron supplies the window, notifications, keychain and native dialogs; `core.ts` is everything else.
let win: BrowserWindow | null = null;

const bundledClaude = () => {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const dir = `claude-agent-sdk-${process.platform}-${process.arch}`;
  return join(app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath(), 'node_modules', '@anthropic-ai', dir, exe);
};

const host: Host = {
  get dataDir() { return app.getPath('userData'); },
  get locale() { return app.getLocale(); },
  send<K extends keyof HelmEvents>(channel: K, payload: HelmEvents[K]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  },
  encrypt: (t) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t)),
  decrypt: (b) => (safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')),
  // The SDK resolves its bundled binary inside app.asar, where it cannot be executed.
  sdkClaudePath: () => (app.isPackaged && existsSync(bundledClaude()) ? bundledClaude() : undefined),
  cliClaudePath: () => (existsSync(bundledClaude()) ? bundledClaude() : undefined),
  setBadge(count) { try { app.setBadgeCount(count); } catch { /* unsupported */ } },
  setTheme(t) {
    nativeTheme.themeSource = t;
    if (win && process.platform !== 'darwin') {
      const dark = nativeTheme.shouldUseDarkColors;
      try { win.setTitleBarOverlay({ color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 }); } catch { /* not supported */ }
    }
  },
  notify({ kind, title, body, silent, sessionId, answer }) {
    if (!Notification.isSupported() || (win && win.isFocused())) return;
    // macOS can show buttons on a notification, so a plain approval can be answered without opening helm.
    const buttons = process.platform === 'darwin' && !!answer;
    const n = new Notification({ title, body, silent, ...(buttons ? { actions: [{ type: 'button', text: 'Approve' }, { type: 'button', text: 'Deny' }] } : {}) });
    if (buttons) n.on('action', (_e, i) => answer!(i === 0 ? 'approve' : 'deny'));
    n.on('click', () => {
      win?.show();
      win?.focus();
      host.send('navigate', { screen: 'session', id: sessionId, tab: kind === 'ready' ? 'changes' : 'conversation' });
    });
    n.show();
  },
  async chooseFolder() {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  },
  changed: () => { tray.update(); syncAwake(); },
  settingsChanged(patch) {
    if ('tray' in patch) tray.update();
    if ('keepAwake' in patch) syncAwake();
    if ('startAtLogin' in patch) syncLogin();
    if ('uiScale' in patch) syncZoom();
  },
  updates: { status: updateStatus, check: checkForUpdates, install: installUpdate },
  appInfo: () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, packaged: app.isPackaged }),
  async saveFile(name, text) {
    const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('documents'), name) });
    if (r.canceled || !r.filePath) return null;
    await writeFile(r.filePath, text, 'utf8');
    return r.filePath;
  },
  showInFolder: (path) => shell.showItemInFolder(path),
  async readClipboard() { return clipboard.readText(); },
  openExternal: (url) => shell.openExternal(url),
  openPath: (path) => shell.openPath(path),
  async copyText(t) { clipboard.writeText(t); }
};

/** The wheel in its circle: the window and taskbar icon while developing, and on Linux. Installed builds get theirs from the installer. */
function appIcon() {
  const p = join(app.getAppPath(), 'desktop', 'build', 'icon.png');
  return existsSync(p) ? p : undefined;
}

const hidesToTray = () => store.data.settings.tray && process.platform === 'win32';
const showWindow = () => { if (!win) createWindow(); win?.show(); win?.focus(); };
const tray = new AppTray({
  sessions: () => store.data.sessions,
  enabled: () => store.data.settings.tray,
  show: showWindow,
  inbox: () => { showWindow(); host.send('navigate', { screen: 'inbox' }); },
  newSession: () => { showWindow(); host.send('toast', { tone: 'neutral', title: 'Press ' + (process.platform === 'darwin' ? '⌘N' : 'Ctrl+N') + ' to start a session' }); },
  quit: () => app.quit(),
  act(sessionId, askId, action) {
    const s = sessions.get(sessionId);
    if (!s) return;
    const ask = s.ask;
    if (action.do === 'open') { showWindow(); host.send('navigate', { screen: 'session', id: sessionId, tab: s.status === 'ready' ? 'changes' : 'conversation' }); return; }
    if (action.do === 'resume') { void sessions.send(sessionId, sessions.resumeText(sessionId)).catch(() => undefined); return; }
    // The menu may be older than the question: only answer the one it was built for.
    if (!ask || ask.id !== askId) { showWindow(); host.send('navigate', { screen: 'inbox' }); return; }
    const answer = action.do === 'approve' ? { decision: 'approve' as const } : action.do === 'always' ? { decision: 'always' as const } : action.do === 'deny' ? { decision: 'deny' as const }
      : action.do === 'answer' && ask.questions?.[0]?.options[action.option] ? { answers: { [ask.questions[0].question]: ask.questions[0].options[action.option].label } }
      : action.do === 'continue' ? { addBudget: ask.scope === 'plan' ? 0 : fromDisplay(5, store.data.settings.currency, store.data.fx.rates) } : null;
    if (answer) void sessions.resolveAsk(sessionId, ask.id, answer).catch((e) => logLine('error', 'tray action failed: ' + String(e?.message || e)));
  }
});

// Keep the computer awake while an agent is working, when asked to.
let awake: number | null = null;
function syncAwake() {
  const want = store.data.settings.keepAwake && sessions.sessions.some((s) => s.status === 'working');
  if (want && awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
  else if (!want && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
}
// Only an installed build registers itself; a development run would register the electron binary.
function syncLogin() {
  if (!app.isPackaged) return;
  const st = store.data.settings;
  app.setLoginItemSettings({ openAtLogin: st.startAtLogin });
}
const syncZoom = () => win?.webContents.setZoomFactor(Math.min(2, Math.max(0.5, store.data.settings.uiScale / 100)));
let firstWindow = true;

function createWindow() {
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1180, minHeight: 700, show: false,
    backgroundColor: dark ? '#0e0e12' : '#fbfbfc',
    title: 'helm',
    icon: appIcon(),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: { color: dark ? '#0e0e12' : '#fbfbfc', symbolColor: dark ? '#9d9dab' : '#55555f', height: 38 } }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  win.once('ready-to-show', () => {
    // Started to the tray: leave the window hidden until the tray (or a second launch) asks for it.
    const quiet = firstWindow && store.data.settings.startMinimised && store.data.settings.tray;
    firstWindow = false;
    if (!quiet) win?.show();
  });
  win.webContents.on('did-finish-load', syncZoom);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://') && !url.startsWith(process.env['ELECTRON_RENDERER_URL'] || 'x://')) e.preventDefault(); });
  // With the tray on, closing the window hides helm and leaves the sessions running.
  // Only on Windows, where the tray is reliable: some Linux desktops show no tray, and the window would be unreachable.
  win.on('close', (e) => { if (hidesToTray() && !(app as any).__closing) { e.preventDefault(); win?.hide(); } });
  win.on('closed', () => { win = null; });
  win.on('focus', () => void refreshPlan());
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') { const p = appIcon(); if (p) try { app.dock?.setIcon(p); } catch { /* optional */ } }
    await start(host);
    for (const name of Object.keys(api) as (keyof HelmApi)[]) {
      ipcMain.handle(name, async (_e, ...args) => (api[name] as any)(...args));
    }
    createWindow();
    initUpdater({ enabled: () => store.data.settings.autoUpdate, changed: emitState });
    tray.update();
    syncLogin();
    syncAwake();
    app.on('render-process-gone', (_e, _wc, d) => logLine('error', `window process gone: ${d.reason} (exit ${d.exitCode})`));
    app.on('child-process-gone', (_e, d) => logLine('error', `${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('before-quit', async (e) => {
    if ((app as any).__closing) return;
    e.preventDefault();
    (app as any).__closing = true;
    tray.destroy();
    await shutdown();
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !hidesToTray()) app.quit(); });
}
