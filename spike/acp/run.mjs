import { Acp, INIT, summarize } from './acp.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [cmd, ...args] = process.argv.slice(2);
writeFileSync('./events.jsonl', '');
const dir = mkdtempSync(join(tmpdir(), 'acp-work-'));
execFileSync('git', ['init', '-q'], { cwd: dir });
const a = new Acp(cmd, args);
const say = (...x) => console.log(...x);
try {
  const init = await a.request('initialize', INIT, 60000);
  say('INITIALIZE agentInfo=', JSON.stringify(init.agentInfo));
  say('agentCapabilities=', JSON.stringify(init.agentCapabilities));
  say('authMethods=', JSON.stringify(init.authMethods)?.slice(0, 300));
  const ns = await a.request('session/new', { cwd: dir, mcpServers: [] });
  say('SESSION/NEW keys=', Object.keys(ns).join(','), 'id=', ns.sessionId);
  say('modes=', JSON.stringify(ns.modes)?.slice(0, 500));
  say('models=', JSON.stringify(ns.models)?.slice(0, 600));
  say('configOptions=', JSON.stringify(ns.configOptions)?.slice(0, 700));
  const sid = ns.sessionId;
  a.onUpdate = (u) => { const s = summarize(u); if (s) say('  update:', s); };
  const turn = async (label, text, cancelAfter) => {
    say(`\n=== TURN ${label}: ${text.slice(0, 90)}`);
    const t0 = Date.now();
    const pr = a.request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text }] }, 240000);
    if (cancelAfter) setTimeout(() => { say('  >> sending session/cancel'); a.notify('session/cancel', { sessionId: sid }); }, cancelAfter);
    const r = await pr.catch((e) => ({ error: e.message, data: e.data }));
    say('  RESULT', JSON.stringify(r), `${Date.now() - t0}ms`);
  };
  await turn('edit+bash', 'Create a file hello.txt containing the word hi, then run `ls` in the shell, then reply with the single word done.');
  say('permission requests:', a.perms.length, JSON.stringify(a.perms.map((p) => ({ kind: p.toolCall.kind, title: p.toolCall.title, rawInput: p.toolCall.rawInput, options: p.options.map((o) => o.kind) }))).slice(0, 900));
  await turn('subagent', 'Use the Task/Agent tool to launch a subagent that reads hello.txt and reports its contents. Then tell me what it said.');
  await turn('cancel', 'Run `sleep 40` in the shell and then say finished.', 8000);
  say('\nupdate types seen:', [...new Set(a.updates.map((u) => u.sessionUpdate))].join(', '));
  writeFileSync('./session.json', JSON.stringify({ dir, sid }));
} catch (e) { say('ERROR', e.message, e.data ? JSON.stringify(e.data) : ''); say('stderr tail:', a.stderr.slice(-800)); }
a.close(); process.exit(0);
