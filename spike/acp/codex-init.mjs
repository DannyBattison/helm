import { Acp, INIT } from './acp.mjs';
import { mkdtempSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; import { tmpdir } from 'node:os'; import { join } from 'node:path';
const [cmd, ...args] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'acp-codex-')); execFileSync('git', ['init', '-q'], { cwd: dir });
const a = new Acp(cmd, args, { log: './events-codex.jsonl' });
try {
  const init = await a.request('initialize', INIT, 30000);
  console.log('agentInfo', JSON.stringify(init.agentInfo), '\ncaps', JSON.stringify(init.agentCapabilities), '\nauth', JSON.stringify(init.authMethods?.map((m) => m.id)));
  const ns = await a.request('session/new', { cwd: dir, mcpServers: [] }, 30000).catch((e) => ({ error: e.message, data: e.data }));
  console.log('session/new ->', JSON.stringify(ns).slice(0, 1500));
} catch (e) { console.log('ERR', e.message, a.stderr.slice(-400)); }
a.close(); process.exit(0);
