#!/usr/bin/env node
// A stand-in for `codex app-server`: just enough of the protocol for tests. Run as `fake-codex.mjs app-server`.
if (process.argv[2] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
let account = { type: 'chatgpt', email: 'me@example.com', planType: 'plus' };
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let nextServerId = 900;
let lastStart = null;
const waiting = new Map();
const askServer = (method, params) => new Promise((res) => { const id = nextServerId++; waiting.set(id, res); out({ id, method, params }); });
const reset = Math.floor(Date.now() / 1000) + 3600;
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) void handle(JSON.parse(line)); }
});
async function handle(m) {
  if (m.id != null && m.method == null) { waiting.get(m.id)?.(m.result); waiting.delete(m.id); return; }
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case 'initialize': return reply({ userAgent: 'fake', codexHome: '/tmp/x', platformFamily: 'unix', platformOs: 'linux' });
    case 'initialized': return;
    case 'account/read': return reply({ account, requiresOpenaiAuth: !account });
    case 'account/login/start': return reply({ type: 'chatgptDeviceCode', loginId: 'L1', verificationUrl: 'https://auth.example/device', userCode: 'ABCD-1234' });
    case 'account/logout': account = null; return reply({});
    case 'model/list': return reply({ data: [{ id: 'b', model: 'gpt-b', displayName: 'GPT B', hidden: true, isDefault: false }, { id: 'a', model: 'gpt-a', displayName: 'GPT A', hidden: false, isDefault: true }, { id: 'c', model: 'gpt-c', displayName: 'GPT C', hidden: false, isDefault: false }] });
    case 'account/rateLimits/read': return reply({ rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: reset }, secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: reset + 86400 } } });
    case 'debug/lastStart': return reply(lastStart);
    case 'thread/start': lastStart = m.params; return reply({ thread: { id: 't1' }, model: m.params.model });
    case 'thread/resume': return reply({ thread: { id: m.params.threadId }, model: m.params.model });
    case 'thread/fork': return reply({ thread: { id: 'forked-' + (m.params.lastTurnId ?? 'all') } });
    case 'thread/name/set': return reply({});
    case 'thread/read': return reply({ thread: { id: m.params.threadId, name: 'A name', preview: 'first prompt', cwd: '/w', updatedAt: 5, createdAt: 1, status: { type: 'idle' }, turns: m.params.includeTurns ? [
      { id: 'u1', items: [{ type: 'userMessage', id: 'i1', content: [{ type: 'text', text: 'hello' }] }, { type: 'agentMessage', id: 'i2', text: 'hi there' }] },
      { id: 'u2', items: [{ type: 'userMessage', id: 'i3', content: [{ type: 'text', text: 'again' }] }, { type: 'commandExecution', id: 'i4', command: 'ls', status: 'completed', exitCode: 0, aggregatedOutput: 'a.txt' }] }] : [] } });
    case 'turn/interrupt': reply({}); return out({ method: 'turn/completed', params: { threadId: m.params.threadId, turn: { id: m.params.turnId, status: 'interrupted', items: [] } } });
    case 'turn/start': {
      reply({ turn: { id: 'u9' } });
      const t = m.params.threadId;
      out({ method: 'turn/started', params: { threadId: t, turn: { id: 'u9' } } });
      const text = (m.params.input.find((x) => x.type === 'text') || {}).text || '';
      if (text.includes('hang')) return;
      if (text.includes('spawn')) {
        const sp = { type: 'collabAgentToolCall', id: 's1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: t, receiverThreadIds: [], prompt: 'Read the readme\nthen report', model: 'gpt-a', agentsStates: {} };
        out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item: sp } });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { ...sp, status: 'completed', receiverThreadIds: ['child1'], agentsStates: { child1: { status: 'running', message: null } } } } });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'collabAgentToolCall', id: 'w1', tool: 'wait', status: 'completed', senderThreadId: t, receiverThreadIds: ['child1'], agentsStates: { child1: { status: 'completed', message: 'found it' } } } } });
        return out({ method: 'turn/completed', params: { threadId: t, turn: { id: 'u9', status: 'completed', items: [] } } });
      }
      const cmd = { type: 'commandExecution', id: 'c1', command: 'npm test', status: 'inProgress' };
      out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item: cmd } });
      const a = await askServer('item/commandExecution/requestApproval', { threadId: t, turnId: 'u9', itemId: 'c1', command: 'npm test', reason: 'needs network' });
      out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { ...cmd, status: a.decision === 'accept' ? 'completed' : 'declined', exitCode: a.decision === 'accept' ? 0 : null, aggregatedOutput: a.decision === 'accept' ? 'ok\n3 passed' : '' } } });
      const fc = { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: '/w/a.txt', kind: { type: 'update', move_path: null }, diff: '@@ -1 +1 @@\n-old\n+new\n' }, { path: '/w/b.txt', kind: { type: 'add' }, diff: '+one\n+two\n' }] };
      out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item: fc } });
      out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { ...fc, status: 'completed' } } });
      out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'agentMessage', id: 'm1', text: ' All done. ' } } });
      out({ method: 'account/rateLimits/updated', params: { rateLimits: { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: reset } } } });
      out({ method: 'thread/tokenUsage/updated', params: { threadId: t, turnId: 'u9', tokenUsage: { total: {}, last: { totalTokens: 100, inputTokens: 80, cachedInputTokens: 30, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 0 }, modelContextWindow: 200000 } } });
      return out({ method: 'turn/completed', params: { threadId: t, turn: { id: 'u9', status: 'completed', items: [] } } });
    }
    default: return out({ id: m.id, error: { code: -32601, message: 'no ' + m.method } });
  }
}
