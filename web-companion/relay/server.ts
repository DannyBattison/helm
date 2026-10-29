import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_GITHUB_CLIENT_ID } from '../../src/core/store';
import { createRelay } from './relay';

const PORT = +(process.env.PORT || 8788);
// Loopback unless told otherwise: put TLS in front (a reverse proxy) before exposing this.
const BIND = process.env.HOST || '127.0.0.1';
let secret = process.env.HELM_RELAY_SECRET || '';
if (secret.length < 16) {
  if (secret) { console.error('HELM_RELAY_SECRET must be at least 16 characters (for example `openssl rand -hex 32`).'); process.exit(1); }
  secret = randomBytes(32).toString('hex');
  console.warn('HELM_RELAY_SECRET is not set: everyone is signed out and unpaired whenever this restarts. Set it to keep them.');
}
const dataDir = process.env.HELM_RELAY_DATA_DIR || join(homedir(), '.helm-relay');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });

const relay = createRelay({
  secret,
  dataDir,
  webRoot: resolve(process.env.HELM_RELAY_WEB || join(__dirname, '../dist')),
  githubClientId: process.env.HELM_GITHUB_CLIENT_ID || DEFAULT_GITHUB_CLIENT_ID,
  extraOrigins: (process.env.HELM_RELAY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  secureCookie: process.env.HELM_RELAY_SECURE_COOKIE ? process.env.HELM_RELAY_SECURE_COOKIE === '1' : undefined
});
relay.server.listen(PORT, BIND, () => console.log(`helm companion relay on http://${BIND}:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { relay.close(); process.exit(0); });
