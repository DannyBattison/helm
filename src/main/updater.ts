import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types';
import { logLine } from './log';

let status: UpdateStatus = { state: app.isPackaged ? 'idle' : 'dev' };
let onChange: () => void = () => undefined;
let wired = false;

export const updateStatus = () => status;
const set = (s: UpdateStatus) => { status = s; onChange(); };

/** Looks for new versions on GitHub Releases (where `npm run dist` with `--publish` puts them). Does nothing in a development build. */
export function initUpdater(opts: { enabled(): boolean; changed(): void }) {
  onChange = opts.changed;
  if (!app.isPackaged || wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: (m: unknown) => logLine('info', 'updater: ' + String(m)), warn: (m: unknown) => logLine('warn', 'updater: ' + String(m)), error: (m: unknown) => logLine('error', 'updater: ' + String(m)), debug: () => undefined } as any;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'current', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => set({ state: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }));
  if (opts.enabled()) setTimeout(() => void checkForUpdates(), 15_000);
  setInterval(() => { if (opts.enabled() && status.state !== 'downloading' && status.state !== 'ready') void checkForUpdates(); }, 6 * 3600_000);
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) return status;
  try { await autoUpdater.checkForUpdates(); } catch (e: any) { set({ state: 'error', error: String(e?.message || e).split('\n')[0].slice(0, 200) }); }
  return status;
}

export function installUpdate() {
  if (status.state === 'ready') autoUpdater.quitAndInstall();
}
