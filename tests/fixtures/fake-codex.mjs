#!/usr/bin/env node
// A stand-in for `codex app-server`: just enough of the protocol for tests. Run as `fake-codex.mjs app-server`.
// Behaviour is chosen by the words in a prompt (spawn, hang, crash, ask, filechange, perm, mystery, fail) and by FAKE_CODEX_* environment variables.
if (process.argv[2] === '--version') { console.log('codex-cli 9.9.9'); process.exit(0); }
const env = process.env;
let account = env.FAKE_CODEX_NO_ACCOUNT ? null : env.FAKE_CODEX_ACCOUNT === 'bedrock' ? { type: 'amazonBedrock', usesCodexManagedCredentials: true } : env.FAKE_CODEX_ACCOUNT === 'apiKey' ? { type: 'apiKey' } : { type: 'chatgpt', email: 'me@example.com', planType: 'plus' };
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let nextServerId = 900;
let lastStart = null, lastTurn = null, lastSteer = null;
const waiting = new Map();
const askServer = (method, params) => new Promise((res) => { const id = nextServerId++; waiting.set(id, res); out({ id, method, params }); });
const reset = Math.floor(Date.now() / 1000) + 3600;
let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) void handle(JSON.parse(line)); }
});
const done = (t, status = 'completed', extra = {}) => out({ method: 'turn/completed', params: { threadId: t, turn: { id: 'u9', status, items: [], ...extra } } });
async function handle(m) {
  if (m.id != null && m.method == null) {
    // The answer to a request the server made. An error from helm comes back as `error`.
    waiting.get(m.id)?.(m.error ? { error: m.error } : m.result);
    waiting.delete(m.id);
    return;
  }
  const reply = (result) => out({ id: m.id, result });
  switch (m.method) {
    case 'initialize': return reply({ userAgent: 'fake', codexHome: '/tmp/x', platformFamily: 'unix', platformOs: 'linux' });
    case 'initialized': return;
    case 'account/read': return reply({ account, requiresOpenaiAuth: !account });
    case 'account/login/start':
      if (m.params.type === 'apiKey') { account = { type: 'apiKey' }; return reply({ type: 'apiKey' }); }
      if (env.FAKE_CODEX_DEVICE_OFF) return out({ id: m.id, error: { code: -32600, message: 'Enable device code sign-in for Codex in ChatGPT Security Settings, then run "codex login --device-auth" again.' } });
      if (env.FAKE_CODEX_NO_DEVICE) return reply({ type: 'chatgpt', loginId: 'L2', authUrl: 'https://auth.example/browser' });
      reply({ type: 'chatgptDeviceCode', loginId: 'L1', verificationUrl: 'https://auth.example/device', userCode: 'ABCD-1234' });
      if (env.FAKE_CODEX_LOGIN_FAILS) out({ method: 'account/login/completed', params: { loginId: 'L1', success: false, error: 'Enable device code sign-in for Codex in ChatGPT Security Settings.' } });
      return;
    case 'account/login/cancel': return reply({});
    case 'account/logout': account = null; return reply({});
    case 'model/list':
      if (env.FAKE_CODEX_NO_MODELS) return out({ id: m.id, error: { code: -32000, message: 'no models' } });
      return reply({ data: [{ id: 'b', model: 'gpt-b', displayName: 'GPT B', hidden: true, isDefault: false }, { id: 'a', model: 'gpt-a', displayName: 'GPT A', hidden: false, isDefault: true }, { id: 'c', model: 'gpt-c', displayName: '', hidden: false, isDefault: false }] });
    case 'account/rateLimits/read':
      if (!account) return out({ id: m.id, error: { code: -32600, message: 'codex account authentication required to read rate limits' } });
      return reply({ rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: reset }, secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: reset + 86400 } } });
    case 'debug/lastStart': return reply(lastStart);
    case 'debug/lastTurn': return reply(lastTurn);
    case 'debug/lastSteer': return reply(lastSteer);
    case 'thread/start': lastStart = m.params; return reply({ thread: { id: 't1' }, model: m.params.model });
    case 'thread/resume': lastStart = { resume: m.params.threadId, ...m.params }; return reply({ thread: { id: m.params.threadId }, model: m.params.model });
    case 'thread/fork': return reply({ thread: { id: 'forked-' + (m.params.lastTurnId ?? 'all') } });
    case 'thread/name/set': return reply({});
    case 'thread/list': return reply({ data: [
      { id: 'x1', name: 'One', preview: 'first words', cwd: m.params.cwd, updatedAt: 5, createdAt: 1, gitInfo: { branch: 'main' } },
      { id: 'x2', name: null, preview: 'second', cwd: m.params.cwd, updatedAt: 9 }] });
    case 'thread/read':
      if (m.params.threadId === 'gone') return out({ id: m.id, error: { code: -32600, message: 'thread not found' } });
      return reply({ thread: { id: m.params.threadId, name: 'A name', preview: 'first prompt', cwd: '/w', updatedAt: 5, createdAt: 1, status: { type: 'idle' }, turns: m.params.includeTurns ? [
        { id: 'u1', items: [{ type: 'userMessage', id: 'i1', content: [{ type: 'text', text: 'hello' }] }, { type: 'agentMessage', id: 'i2', text: 'hi there' }] },
        { id: 'u2', items: [{ type: 'userMessage', id: 'i3', content: [{ type: 'text', text: 'again' }] }, { type: 'commandExecution', id: 'i4', command: 'ls', status: 'completed', exitCode: 0, aggregatedOutput: 'a.txt' }] }] : [] } });
    case 'turn/interrupt': reply({}); return done(m.params.threadId, 'interrupted');
    case 'turn/steer': lastSteer = m.params; reply({}); return done(m.params.threadId);
    case 'turn/start': {
      lastTurn = m.params;
      const t = m.params.threadId;
      const text = (m.params.input.find((x) => x.type === 'text') || {}).text || '';
      if (m.params.outputSchema) {
        // A review: one thread, one answer in the turn's items.
        reply({ turn: { id: 'u9' } });
        if (text.includes('fail')) return done(t, 'failed', { error: { message: 'reviewer broke' } });
        if (text.includes('crash')) process.exit(1);
        return done(t, 'completed', { items: [{ type: 'agentMessage', id: 'r1', text: text.includes('prose') ? 'looks fine to me' : '{"summary":"ok","findings":[]}' }] });
      }
      reply({ turn: { id: 'u9' } });
      out({ method: 'turn/started', params: { threadId: t, turn: { id: 'u9' } } });
      if (text.includes('hang')) return;
      if (text.includes('crash')) return process.exit(1);
      if (text.includes('fail')) return done(t, 'failed', { error: { message: 'the model refused' } });
      if (text.includes('spawn')) {
        const sp = { type: 'collabAgentToolCall', id: 's1', tool: 'spawnAgent', status: 'inProgress', senderThreadId: t, receiverThreadIds: [], prompt: 'Read the readme\nthen report', model: 'gpt-a', agentsStates: {} };
        out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item: sp } });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { ...sp, status: 'completed', receiverThreadIds: ['child1', 'child2'], agentsStates: { child1: { status: 'running', message: null } } } } });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'collabAgentToolCall', id: 'w1', tool: 'wait', status: 'completed', senderThreadId: t, receiverThreadIds: ['child1'], agentsStates: { child1: { status: 'completed', message: 'found it' }, child2: { status: 'errored', message: 'boom' } } } } });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'subAgentActivity', id: 'a1', kind: 'completed', agentThreadId: 'child1', agentPath: 'p' } } });
        return done(t);
      }
      if (text.includes('ask')) {
        const a = await askServer('item/tool/requestUserInput', { threadId: t, turnId: 'u9', itemId: 'q1', isBlocking: true, autoResolutionMs: null, questions: [
          { id: 'color', header: 'Colour', question: 'Which colour?', isOther: false, isSecret: false, options: [{ label: 'red', description: 'warm' }, { label: 'blue', description: 'cool' }] },
          { id: 'free', header: 'Note', question: 'Anything else?', isOther: true, isSecret: false, options: null }] });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'agentMessage', id: 'm1', text: 'answers: ' + JSON.stringify(a.answers || a) } } });
        return done(t);
      }
      if (text.includes('patchfiles')) {
        const fc = { type: 'fileChange', id: 'f2', status: 'inProgress', changes: [{ path: '/w/new.txt', kind: { type: 'add' }, diff: '+hi' }] };
        out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item: fc } });
        const a = await askServer('item/fileChange/requestApproval', { threadId: t, turnId: 'u9', itemId: 'f2', reason: 'outside' });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { ...fc, status: a.decision === 'accept' ? 'completed' : 'declined' } } });
        // A file change that was never announced still shows up when it is done.
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'fileChange', id: 'f3', status: 'completed', changes: [{ path: '/w/b.txt', kind: { type: 'delete' }, diff: '-bye' }] } } });
        return done(t);
      }
      if (text.includes('perm')) {
        const a = await askServer('item/permissions/requestApproval', { threadId: t, turnId: 'u9', itemId: 'p1' });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'agentMessage', id: 'm2', text: 'perm: ' + a.decision } } });
        return done(t);
      }
      if (text.includes('ghost')) {
        const a = await askServer('item/commandExecution/requestApproval', { threadId: 'ghost', turnId: 'u9', itemId: 'g1', command: 'rm -rf /' });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'agentMessage', id: 'm4', text: 'ghost: ' + a.decision } } });
        return done(t);
      }
      if (text.includes('mystery')) {
        const a = await askServer('mystery/method', { threadId: t });
        out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item: { type: 'agentMessage', id: 'm3', text: 'mystery: ' + (a.error ? a.error.message : 'ok') } } });
        return done(t);
      }
      if (text.includes('tools')) {
        for (const item of [
          { type: 'mcpToolCall', id: 'k1', server: 'gh', tool: 'pr', arguments: { n: 1 }, status: 'completed', result: { content: [{ text: 'merged' }] }, error: null },
          { type: 'mcpToolCall', id: 'k2', server: 'gh', tool: 'bad', arguments: {}, status: 'failed', result: null, error: { message: 'nope' } },
          { type: 'dynamicToolCall', id: 'k3', tool: 'calc', arguments: { x: 1 }, status: 'completed', contentItems: [{ text: '2' }], success: true },
          { type: 'webSearch', id: 'k4', query: 'cats' },
          { type: 'imageView', id: 'k5', path: '/w/a.png' },
          { type: 'plan', id: 'k6', text: 'Step one' },
          { type: 'reasoning', id: 'k7', summary: [], content: [] }]) {
          out({ method: 'item/started', params: { threadId: t, turnId: 'u9', item } });
          out({ method: 'item/completed', params: { threadId: t, turnId: 'u9', item } });
        }
        return done(t);
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
      return done(t);
    }
    default: return out({ id: m.id, error: { code: -32601, message: 'no ' + m.method } });
  }
}
