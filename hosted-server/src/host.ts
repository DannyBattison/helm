import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Host } from '../../src/main/host';

const unavailable = (what: string) => () => Promise.reject(new Error(`${what} is not available on a hosted server`));

/** The hosted server's answer to "where am I running": a Node process with no window, keychain or desktop. */
export function createHost(send: Host['send']): Host {
  const dataDir = process.env.HELM_DATA_DIR || join(homedir(), '.helm-hosted');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  return {
    dataDir,
    locale: process.env.HELM_LOCALE || 'en-US',
    send,
    // No keychain on a server: the GitHub token sits in dataDir (0700) as plain text. See hosted-server/README.md.
    sdkClaudePath: () => undefined,
    cliClaudePath: () => undefined,
    chooseFolder: async () => null,
    openExternal: unavailable('Opening a link'),
    openPath: unavailable('Opening a folder'),
    copyText: unavailable('Copying')
  };
}
