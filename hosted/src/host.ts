import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Host } from '../../src/core/host';
import type { Push } from './push';

const unavailable = (what: string) => () => Promise.reject(new Error(`${what} is not available on a hosted server`));

/** The hosted server's answer to "where am I running": a Node process with no window, keychain or desktop. */
export const dataDirectory = () => {
  const dir = process.env.HELM_DATA_DIR || join(homedir(), '.helm-hosted');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};

export function createHost(send: Host['send'], allowLogin?: Host['allowLogin'], push?: Push): Host {
  const dataDir = dataDirectory();
  return {
    dataDir,
    locale: process.env.HELM_LOCALE || 'en-US',
    send,
    allowLogin,
    requireAgentLogin: true,
    ghConfigDir: process.env.GH_CONFIG_DIR || join(homedir(), '.config', 'gh'),
    companion: false,
    syncServer: true,
    // No keychain on a server: the GitHub token sits in dataDir (0700) as plain text. See hosted/README.md.
    sdkClaudePath: () => undefined,
    cliClaudePath: () => undefined,
    chooseFolder: async () => null,
    openExternal: unavailable('Opening a link'),
    openPath: unavailable('Opening a folder'),
    copyText: unavailable('Copying'),
    appInfo: () => ({ version: 'hosted', packaged: true }),
    // Notifications are shown by the browser (web/notifications.ts), which knows whether the tab is in view. Installed apps also get them by
    // Web Push, so they arrive with the app closed; their worker stays quiet while the app is in view.
    notify: ({ kind, title, body, silent, sessionId }) => {
      send('notify', { kind, title, body, silent, sessionId });
      void push?.notify({ title, body, silent, sessionId, kind });
    },
    // A report or diagnostics bundle goes to the browser, which downloads it.
    async saveFile(name, text) { send('download', { name, text }); return name; }
  };
}
