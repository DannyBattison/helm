import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, nativeTheme, safeStorage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { HelmApi, HelmEvents } from '../shared/types';
import { api, refreshPlan, shutdown, start } from './core';
import type { Host } from './host';

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
  notify({ kind, title, body, silent, sessionId }) {
    if (!Notification.isSupported() || (win && win.isFocused())) return;
    const n = new Notification({ title, body, silent });
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
  openExternal: (url) => shell.openExternal(url),
  openPath: (path) => shell.openPath(path),
  async copyText(t) { clipboard.writeText(t); }
};

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
  win.on('focus', () => void refreshPlan());
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    await start(host);
    for (const name of Object.keys(api) as (keyof HelmApi)[]) {
      ipcMain.handle(name, async (_e, ...args) => (api[name] as any)(...args));
    }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('before-quit', async (e) => {
    if ((app as any).__closing) return;
    e.preventDefault();
    (app as any).__closing = true;
    await shutdown();
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
