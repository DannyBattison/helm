import { Acp, INIT, summarize } from './acp.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [cmd, ...args] = process.argv.slice(2);
const { dir, sid } = JSON.parse(readFileSync('./session.json', 'utf8'));
writeFileSync('./events2.jsonl', '');
const a = new Acp(cmd, args, { log: './events2.jsonl' });
const say = (...x) => console.log(...x);
const tryReq = async (m, p, ms = 60000) => { try { const r = await a.request(m, p, ms); say(`\n${m} OK ->`, JSON.stringify(r).slice(0, 500)); return r; } catch (e) { say(`\n${m} FAILED:`, e.message, JSON.stringify(e.data?.data ?? '').slice(0, 200)); } };
try {
  await a.request('initialize', INIT, 60000);
  await tryReq('session/list', { cwd: dir });
  let n0 = a.updates.length;
  await tryReq('session/load', { sessionId: sid, cwd: dir, mcpServers: [] });
  const replay = a.updates.slice(n0);
  say('  load replayed', replay.length, 'updates:', JSON.stringify(replay.reduce((o, u) => ((o[u.sessionUpdate] = (o[u.sessionUpdate] || 0) + 1), o), {})));
  say('  replay had user_message_chunk:', replay.some((u) => u.sessionUpdate === 'user_message_chunk'), 'tool_call with diff:', replay.some((u) => (Array.isArray(u.content) ? u.content : []).some((c) => c.type === 'diff')));
  const fk = await tryReq('session/fork', { sessionId: sid, cwd: dir, mcpServers: [] });
  await tryReq('session/set_mode', { sessionId: sid, modeId: 'plan' });
  await tryReq('session/set_config_option', { sessionId: sid, configId: 'mode', value: 'default' });
  await tryReq('session/set_model', { sessionId: sid, modelId: 'haiku' });
  say('\n=== reject flow');
  a.permit = (o) => o.options.find((x) => x.kind === 'reject_once');
  a.onUpdate = (u) => { const s = summarize(u); if (s && /tool_call/.test(s)) say('  update:', s.slice(0, 260)); };
  const r = await a.request('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: 'Create a file nope.txt containing no. If you are refused, just say refused and stop.' }] }, 120000).catch((e) => ({ error: e.message }));
  say('  RESULT', JSON.stringify(r).slice(0, 300));
  say('  final text:', a.updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').slice(-3).map((u) => u.content.text).join('').slice(-200));
} catch (e) { say('ERROR', e.message, a.stderr.slice(-600)); }
a.close(); process.exit(0);
