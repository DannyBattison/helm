import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { trayEntries, type TrayAction } from '../../src/shared/tray';
import type { Session } from '../../src/shared/types';

const asset = (name: string) => join(app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'desktop', 'resources'), name);

export interface TrayHooks {
  sessions(): Session[];
  enabled(): boolean;
  show(): void;
  act(sessionId: string, askId: string | undefined, action: TrayAction): void;
  newSession(): void;
  inbox(): void;
  quit(): void;
}

/** The system tray (menu bar on macOS): a count of what needs you, and a menu that can approve, deny or answer without opening helm. */
export class AppTray {
  private tray: Tray | null = null;
  private sig = '';
  constructor(private hooks: TrayHooks) {}

  update() {
    if (!this.hooks.enabled()) { this.tray?.destroy(); this.tray = null; this.sig = ''; return; }
    const { entries, total } = trayEntries(this.hooks.sessions());
    // Rebuilding a menu closes it, so only do it when what it shows has changed.
    const sig = JSON.stringify([total, entries.map((e) => [e.sessionId, e.askId, e.label, e.actions.map((a) => a.label)])]);
    if (this.tray && sig === this.sig) return;
    this.sig = sig;
    if (!this.tray) {
      const mac = process.platform === 'darwin';
      const img = nativeImage.createFromPath(asset(mac ? 'trayTemplate.png' : 'tray.png'));
      if (mac) img.setTemplateImage(true);
      this.tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
      this.tray.on('click', () => { if (process.platform !== 'darwin') this.hooks.show(); });
    }
    this.tray.setToolTip(total ? `helm: ${total} ${total === 1 ? 'thing needs' : 'things need'} you` : 'helm: nothing needs you');
    if (process.platform === 'darwin') this.tray.setTitle(total ? String(total) : '');
    const items: MenuItemConstructorOptions[] = [{ label: total ? `${total} waiting on you` : 'Nothing waiting on you', enabled: false }];
    for (const e of entries) {
      items.push({ label: e.label, submenu: e.actions.map((a) => ({ label: a.label, click: () => this.hooks.act(e.sessionId, e.askId, a.action) })) });
    }
    if (total > entries.length) items.push({ label: `and ${total - entries.length} more…`, click: () => this.hooks.inbox() });
    items.push({ type: 'separator' }, { label: 'Open Inbox', click: () => this.hooks.inbox() }, { label: 'New session', click: () => this.hooks.newSession() }, { label: 'Show helm', click: () => this.hooks.show() }, { type: 'separator' }, { label: 'Quit helm', click: () => this.hooks.quit() });
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  destroy() { this.tray?.destroy(); this.tray = null; }
}
