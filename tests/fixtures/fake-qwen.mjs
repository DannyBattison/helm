#!/usr/bin/env node
// A stand-in for `qwen --acp`: just enough of the Agent Client Protocol for the backend's tests.
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { console.log('9.9.9'); process.exit(0); }
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const update = (sessionId, u) => send({ method: 'session/update', params: { sessionId, update: u } });
let nextId = 100;
const waiting = new Map();
const cancelled = new Set();
const ask = (method, params) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); send({ id, method, params }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const calls = [];

async function prompt(id, p) {
  const sid = p.sessionId;
  const text = p.prompt.map((b) => b.text || '').join('');
  if (text.includes('say hello')) {
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello ' } });
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'there.' } });
    update(sid, { sessionUpdate: 'usage_update', used: 1234, size: 32768 });
  } else if (text.includes('show env')) {
    update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${process.env.OPENAI_MODEL} ${process.env.OPENAI_BASE_URL} ${process.env.OPENAI_API_KEY} ${JSON.stringify(calls)} ${text.includes('be nice') ? 'led' : 'bare'}` } });
  } else if (text.includes('run ls')) {
    update(sid, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls -l', kind: 'execute', status: 'pending', rawInput: { command: 'ls -l' } });
    const r = await ask('session/request_permission', { sessionId: sid, toolCall: { toolCallId: 't1', title: 'ls -l', kind: 'execute', rawInput: { command: 'ls -l' } }, options: [{ optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'yes', name: 'Yes', kind: 'allow_once' }, { optionId: 'no', name: 'No', kind: 'reject_once' }] });
    const o = r.outcome;
    if (o.outcome === 'selected' && o.optionId === 'yes') {
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }] });
      update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Listed.' } });
    } else {
      update(sid, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed', content: [] });
      update(sid, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: o.outcome === 'cancelled' ? 'Cancelled.' : 'Declined.' } });
    }
  } else if (text.includes('slow')) {
    for (let i = 0; i < 100 && !cancelled.has(sid); i++) await sleep(20);
    return send({ id, result: { stopReason: 'cancelled' } });
  } else if (text.includes('crash')) process.exit(3);
  send({ id, result: { stopReason: text.includes('refuse') ? 'refusal' : 'end_turn' } });
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.id != null && m.method == null) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; }
  calls.push(m.method);
  switch (m.method) {
    case 'initialize': return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [{ id: 'qwen-oauth', name: 'Qwen OAuth' }, { id: 'openai', name: 'OpenAI-compatible' }] } });
    case 'authenticate': return send({ id: m.id, result: m.params.methodId === 'openai' ? {} : undefined, ...(m.params.methodId === 'openai' ? {} : { error: { code: -1, message: 'wrong method' } }) });
    case 'session/new': return send({ id: m.id, result: { sessionId: 'sess-' + process.pid } });
    case 'session/load': return send({ id: m.id, result: {} });
    case 'session/set_mode': return send({ id: m.id, result: {} });
    case 'session/cancel': return void cancelled.add(m.params.sessionId);
    case 'session/prompt': return void prompt(m.id, m.params);
    default: if (m.id != null) send({ id: m.id, error: { code: -32601, message: 'no ' + m.method } });
  }
});
