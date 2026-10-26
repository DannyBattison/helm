import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent, ToolDecision } from '../src/core/backend';
import { CodexBackend, resultsOf, threadMessages, toolUsesOf, windowsOf } from '../src/core/codexBackend';

const fake = resolve(__dirname, 'fixtures/fake-codex.mjs');
const backend = new CodexBackend({ cli: () => fake });
afterAll(() => backend.stop());

const take = async (it: AsyncIterator<AgentEvent>, until: (e: AgentEvent) => boolean, ms = 4000) => {
  const out: AgentEvent[] = [];
  const t0 = Date.now();
  for (;;) {
    const r = await Promise.race([it.next(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out; got ' + JSON.stringify(out))), Math.max(10, ms - (Date.now() - t0))))]);
    if (r.done) break;
    out.push(r.value);
    if (until(r.value)) break;
  }
  return out;
};
const opts = (decide: (tool: string, input: any) => ToolDecision) => ({
  cwd: '/w', model: 'gpt-a', permMode: 'ask' as const, systemAppend: 'be nice',
  canUseTool: async (tool: string, input: any) => decide(tool, input),
  admitSubagent: async () => undefined
});

describe('Codex item mapping', () => {
  it('maps commands, file changes and tools into Claude Code\'s vocabulary', () => {
    expect(toolUsesOf({ type: 'commandExecution', id: 'a', command: 'ls -l' })).toEqual([{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'ls -l' } }]);
    const fc = { type: 'fileChange', id: 'f', changes: [{ path: 'x', kind: { type: 'update', move_path: null }, diff: '--- a\n+++ b\n@@ -1,2 +1,2 @@\n keep\n-gone\n+new' }, { path: 'y', kind: { type: 'add' }, diff: '+1\n+2' }, { path: 'z', kind: { type: 'delete' }, diff: '-bye' }] };
    expect(toolUsesOf(fc).map((u) => [u.id, u.name, u.input])).toEqual([
      ['f:0', 'Edit', { file_path: 'x', old_string: 'gone', new_string: 'new' }],
      ['f:1', 'Write', { file_path: 'y', content: '1\n2' }],
      ['f:2', 'Edit', { file_path: 'z', old_string: 'bye', new_string: '' }]
    ]);
    expect(resultsOf({ ...fc, status: 'completed' }).map((r) => [r.id, r.isError])).toEqual([['f:0', false], ['f:1', false], ['f:2', false]]);
    expect(toolUsesOf({ type: 'mcpToolCall', id: 'm', server: 'gh', tool: 'pr', arguments: { n: 1 } })[0].name).toBe('mcp__gh__pr');
    expect(toolUsesOf({ type: 'reasoning', id: 'r' })).toEqual([]);
  });
  it('treats a failed or declined command as an error', () => {
    expect(resultsOf({ type: 'commandExecution', id: 'a', status: 'completed', exitCode: 1, aggregatedOutput: 'boom' })[0]).toEqual({ id: 'a', text: 'boom', isError: true });
    expect(resultsOf({ type: 'commandExecution', id: 'a', status: 'declined' })[0].isError).toBe(true);
    expect(resultsOf({ type: 'commandExecution', id: 'a', status: 'completed', exitCode: 0, aggregatedOutput: 'fine' })[0].isError).toBe(false);
  });
  it('reads a saved thread as messages the transcript converter understands', () => {
    const msgs = threadMessages([{ items: [{ type: 'userMessage', content: [{ type: 'text', text: 'hi' }] }, { type: 'agentMessage', text: 'yo' }, { type: 'commandExecution', id: 'c', command: 'ls', status: 'completed', exitCode: 0, aggregatedOutput: 'x' }] }]);
    expect(msgs.map((m) => m.type)).toEqual(['user', 'assistant', 'assistant', 'user']);
  });
  it('tells the five-hour window from the weekly one by its length', () => {
    expect(windowsOf({ primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 10 }, secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: 20 } })).toEqual({ fiveHour: { util: 0.25, resetsAt: 10 }, weekly: { util: 0.05, resetsAt: 20 } });
    expect(windowsOf({ primary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: 10 }, secondary: null })).toEqual({ weekly: { util: 0.25, resetsAt: 10 } });
    expect(windowsOf(null)).toEqual({});
  });
});

describe('Codex through a stand-in app server', () => {
  it('reads the version, models and sign-in', async () => {
    expect(await backend.version()).toBe('9.9.9');
    await backend.refresh();
    expect(backend.models.map((m) => m.id)).toEqual(['gpt-a', 'gpt-c']);
    expect(await backend.auth.status()).toEqual({ loggedIn: true, method: 'chatgpt', email: 'me@example.com', plan: 'plus', billing: 'subscription' });
    expect(await backend.planUsage()).toEqual({ billing: 'subscription', fiveHour: expect.objectContaining({ util: 0.42 }), weekly: expect.objectContaining({ util: 0.1 }) });
  });

  it('signs in with a device code and signs out', async () => {
    expect(await backend.auth.startLogin()).toEqual({ url: 'https://auth.example/device', code: 'ABCD-1234', needsCode: false });
    expect((await backend.auth.logout()).loggedIn).toBe(false);
    expect((await backend.auth.status()).loggedIn).toBe(false);
  });

  it('runs a turn: asks about the command, reports the work, then the usage and the end', async () => {
    const asked: [string, any][] = [];
    const h = backend.start(opts((tool, input) => { asked.push([tool, input]); return { behavior: 'allow' }; }));
    const it = h.events[Symbol.asyncIterator]();
    h.send('please run the tests');
    const ev = await take(it, (e) => e.t === 'result');
    expect(ev[0]).toEqual({ t: 'init', sessionId: 't1', model: 'gpt-a', billing: 'subscription' });
    expect(asked).toEqual([['Bash', { command: 'npm test' }]]);
    const kinds = ev.map((e) => (e.t === 'assistant' ? 'assistant:' + e.blocks.map((b) => (b.type === 'tool_use' ? b.name : 'text')).join(',') : e.t));
    expect(kinds).toEqual(['init', 'assistant:Bash', 'tool_results', 'assistant:Edit,Write', 'tool_results', 'assistant:text', 'plan_usage', 'assistant:', 'result']);
    const results = ev.find((e) => e.t === 'tool_results') as Extract<AgentEvent, { t: 'tool_results' }>;
    expect(results.results[0]).toEqual({ id: 'c1', text: 'ok\n3 passed', isError: false });
    expect(ev.find((e) => e.t === 'plan_usage')).toEqual({ t: 'plan_usage', fiveHour: expect.objectContaining({ util: 0.5 }) });
    const usage = ev.find((e) => e.t === 'assistant' && e.usage) as Extract<AgentEvent, { t: 'assistant' }>;
    expect(usage.usage).toEqual({ input: 50, output: 20, cacheWrite: 0, cacheRead: 30 });
    expect(ev[ev.length - 1]).toEqual({ t: 'result', isError: false, text: '' });
    h.close();
  });

  it('reports a declined command as an error result', async () => {
    const h = backend.start(opts(() => ({ behavior: 'deny', message: 'no' })));
    const it = h.events[Symbol.asyncIterator]();
    h.send('go');
    const ev = await take(it, (e) => e.t === 'result');
    const r = ev.find((e) => e.t === 'tool_results') as Extract<AgentEvent, { t: 'tool_results' }>;
    expect(r.results[0].isError).toBe(true);
    h.close();
  });

  it('interrupts a turn that is running', async () => {
    const h = backend.start(opts(() => ({ behavior: 'allow' })));
    const it = h.events[Symbol.asyncIterator]();
    h.send('hang');
    await take(it, (e) => e.t === 'init');
    await new Promise((r) => setTimeout(r, 50));
    await h.interrupt();
    const ev = await take(it, (e) => e.t === 'result');
    expect(ev[ev.length - 1]).toEqual({ t: 'result', isError: false, text: '' });
    h.close();
    expect(h.closed).toBe(true);
  });

  it('reads and forks conversations', async () => {
    const c = backend.conversations;
    expect(await c.info('t9')).toMatchObject({ id: 't9', title: 'A name', firstPrompt: 'first prompt' });
    // The fork stops before the turn that held the message: turn 2 holds "again", so it forks through turn 1.
    expect(await c.messageBefore('t9', '/w', 'again', 1)).toBe('u1');
    expect(await c.messageBefore('t9', '/w', 'hello', 1)).toBeNull();
    expect(await c.messageBefore('t9', '/w', 'missing', 1)).toBeUndefined();
    expect(await c.fork({ sourceId: 't9', sourceDir: '/w', destDir: '/n', upToMessageId: 'u1', title: 'Fork' })).toBe('forked-u1');
    const events = await c.transcript('t9', '/w');
    expect(events.map((e) => e.k)).toEqual(['user', 'agent', 'user', 'bash']);
  });
});
