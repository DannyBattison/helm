import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentHandle, ToolDecision } from '../src/core/backend';
import { CodexBackend, codexMcp, findCodex, resultsOf, strictSchema, toolUsesOf, windowsOf } from '../src/core/codexBackend';

const fake = resolve(__dirname, 'fixtures/fake-codex.mjs');

/** A backend whose server process is started with these variables set, stopped afterwards. */
const made: CodexBackend[] = [];
const saved: Record<string, string | undefined> = {};
function backend(vars: Record<string, string> = {}, cli: string = fake) {
  for (const [k, v] of Object.entries(vars)) { saved[k] ??= process.env[k]; process.env[k] = v; }
  const b = new CodexBackend({ cli: () => cli });
  made.push(b);
  return b;
}
afterEach(() => {
  for (const b of made.splice(0)) b.stop();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; delete saved[k]; }
});

const take = async (h: AgentHandle, until: (e: AgentEvent) => boolean, ms = 4000) => {
  const it = h.events[Symbol.asyncIterator]();
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
const allow = async (_t: string, input: any): Promise<ToolDecision> => ({ behavior: 'allow', updatedInput: input });
const start = (b: CodexBackend, over: any = {}) => b.start({ cwd: '/w', model: 'gpt-a', permMode: 'ask', systemAppend: 'be nice', canUseTool: allow, admitSubagent: async () => undefined, ...over });
const debug = (b: CodexBackend, what: string) => (b as any).server.request('debug/' + what);
const run = async (b: CodexBackend, prompt: string, over: any = {}) => {
  const h = start(b, over);
  h.send(prompt);
  const ev = await take(h, (e) => e.t === 'result');
  return { h, ev };
};
const texts = (ev: AgentEvent[]) => ev.flatMap((e) => (e.t === 'assistant' ? e.blocks.filter((b) => b.type === 'text').map((b: any) => b.text) : []));

describe('when Codex is not there', () => {
  it('says so from every call instead of crashing', async () => {
    const b = backend({}, '/nonexistent/codex-xyz');
    expect(await b.auth.status()).toMatchObject({ loggedIn: false, method: 'none', error: expect.stringMatching(/could not be started/) });
    expect(await b.version()).toBeNull();
    await b.refresh();
    expect(b.models).toEqual([]);
    expect(await b.planUsage()).toBeNull();
    expect((await b.review({ cwd: '/w', model: 'm', prompt: 'x', schema: {} })).failure).toMatch(/could not be started/);
    expect(await b.conversations.info('t')).toBeNull();
    expect(await b.conversations.list('/w')).toEqual([]);
    expect(await b.conversations.signature('t')).toBe('');
    const { ev } = await run(b, 'hi');
    expect(ev[ev.length - 1]).toMatchObject({ t: 'result', isError: true, text: expect.stringMatching(/could not be started/) });
  });
});

describe('Codex accounts', () => {
  it('signs in with a key from the environment, and the session is billed per token', async () => {
    const b = backend({ FAKE_CODEX_NO_ACCOUNT: '1', OPENAI_API_KEY: 'sk-test' });
    expect(await b.auth.status()).toEqual({ loggedIn: true, method: 'api key', billing: 'api' });
    const { ev } = await run(b, 'tools');
    expect(ev[0]).toMatchObject({ t: 'init', billing: 'api' });
    expect(await b.planUsage()).toMatchObject({ billing: 'api' });
  });
  it('reports another kind of account as paid per token', async () => {
    const b = backend({ FAKE_CODEX_ACCOUNT: 'bedrock' });
    expect(await b.auth.status()).toEqual({ loggedIn: true, method: 'amazonBedrock', billing: 'api' });
  });
  it('is signed out when there is no account and no key, and cannot read plan usage', async () => {
    const b = backend({ FAKE_CODEX_NO_ACCOUNT: '1', OPENAI_API_KEY: '', CODEX_API_KEY: '' });
    expect(await b.auth.status()).toEqual({ loggedIn: false, method: 'none' });
    expect(await b.planUsage()).toBeNull();
    expect((await b.auth.logout()).loggedIn).toBe(false);
  });
  it('keeps the reason when ChatGPT refuses after the sign-in was started', async () => {
    const b = backend({ FAKE_CODEX_NO_ACCOUNT: '1', OPENAI_API_KEY: '', CODEX_API_KEY: '', FAKE_CODEX_LOGIN_FAILS: '1' });
    await b.auth.startLogin();
    await new Promise((r) => setTimeout(r, 100));
    expect(await b.auth.status()).toMatchObject({ loggedIn: false, error: expect.stringMatching(/Settings → Security/) });
    // A fresh attempt forgets the old reason.
    await b.auth.startLogin();
    b.auth.cancel();
    b.auth.cancel();
  });
  it('says so when Codex offers a browser sign-in instead of a device code', async () => {
    const b = backend({ FAKE_CODEX_NO_DEVICE: '1' });
    await expect(b.auth.startLogin()).rejects.toThrow(/did not offer a sign-in code/);
  });
});

describe('Codex models and plan usage', () => {
  it('lists the visible models, the default first, naming one by its id when it has no name', async () => {
    const b = backend();
    await b.refresh();
    expect(b.models.map((m) => [m.id, m.label])).toEqual([['gpt-a', 'GPT A'], ['gpt-c', 'gpt-c']]);
  });
  it('keeps what it had when the list cannot be read', async () => {
    const b = backend({ FAKE_CODEX_NO_MODELS: '1' });
    await b.refresh();
    expect(b.models).toEqual([]);
  });
});

describe('Codex review', () => {
  const req = (prompt: string) => ({ cwd: '/w', model: 'gpt-a', prompt, schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } });
  it('returns the structured answer', async () => {
    expect(await backend().review(req('go'))).toMatchObject({ structured: { summary: 'ok', findings: [] }, failure: '', cost: 0 });
  });
  it('returns prose as text when it is not JSON', async () => {
    expect(await backend().review(req('prose'))).toMatchObject({ structured: undefined, text: 'looks fine to me', failure: '' });
  });
  it('reports a failed turn', async () => {
    expect((await backend().review(req('fail'))).failure).toBe('reviewer broke');
  });
  it('reports Codex stopping', async () => {
    expect((await backend().review(req('crash'))).failure).toBe('Codex stopped');
  });
});

describe('a Codex session', () => {
  it('starts a thread with the instructions, the environment and the MCP servers, and applies the mode per turn', async () => {
    const b = backend();
    const h = start(b, { permMode: 'ask', extraDirs: ['/up'], env: { GIT_AUTHOR_NAME: 'Codex' }, mcpServers: { gh: { type: 'http', url: 'https://x', headers: { a: 'b' } }, fs: { type: 'stdio', command: 'node', args: ['s.js'], env: { K: 'v' } } }, subagentLimit: 0 });
    h.send('hello');
    await take(h, (e) => e.t === 'result');
    const th = await debug(b, 'lastStart');
    expect(th).toMatchObject({ model: 'gpt-a', cwd: '/w', approvalPolicy: 'untrusted', sandbox: 'workspace-write', developerInstructions: 'be nice' });
    expect(th.config).toEqual({
      shell_environment_policy: { inherit: 'all', set: { GIT_AUTHOR_NAME: 'Codex' } },
      mcp_servers: { gh: { url: 'https://x', http_headers: { a: 'b' } }, fs: { command: 'node', args: ['s.js'], env: { K: 'v' } } },
      agents: { max_concurrent_threads_per_session: 1 }
    });
    const turn = await debug(b, 'lastTurn');
    expect(turn.sandboxPolicy).toMatchObject({ type: 'workspaceWrite', writableRoots: ['/w', '/up'], networkAccess: true });
    h.close();
  });

  it('follows a change of model, effort and mode, and sends images', async () => {
    const b = backend();
    const h = start(b, { permMode: 'edits' });
    await h.setModel('gpt-c');
    await h.setEffort('max');
    await h.setPermMode('all');
    h.send('', [{ mediaType: 'image/png', data: 'AAAA' }]);
    await take(h, (e) => e.t === 'result');
    const turn = await debug(b, 'lastTurn');
    expect(turn).toMatchObject({ model: 'gpt-c', effort: 'xhigh', approvalPolicy: 'never', sandboxPolicy: { type: 'dangerFullAccess' } });
    expect(turn.input[0]).toEqual({ type: 'image', url: 'data:image/png;base64,AAAA' });
    expect(turn.input[1].text).toBe('See the attached image.');
    expect((await debug(b, 'lastStart')).sandbox).toBe('danger-full-access');
    await h.setEffort(null);
    h.close();
  });

  it('is read-only in plan mode', async () => {
    const b = backend();
    const h = start(b, { permMode: 'plan' });
    h.send('hello');
    await take(h, (e) => e.t === 'result');
    expect((await debug(b, 'lastTurn')).sandboxPolicy).toEqual({ type: 'readOnly', networkAccess: false });
    expect((await debug(b, 'lastStart')).sandbox).toBe('read-only');
    h.close();
  });

  it('resumes a conversation it was given', async () => {
    const b = backend();
    const h = start(b, { resume: 'old-thread' });
    h.send('hello');
    const ev = await take(h, (e) => e.t === 'result');
    expect(ev[0]).toMatchObject({ t: 'init', sessionId: 'old-thread' });
    expect((await debug(b, 'lastStart')).resume).toBe('old-thread');
    h.close();
  });

  it('puts a message sent while it works into the turn that is running', async () => {
    const b = backend();
    const h = start(b);
    h.send('hang');
    const it = h.events[Symbol.asyncIterator]();
    await it.next(); // init
    await new Promise((r) => setTimeout(r, 100));
    h.send('and also this');
    const end = await it.next();
    expect(end.value).toEqual({ t: 'result', isError: false, text: '' });
    expect((await debug(b, 'lastSteer')).expectedTurnId).toBe('u9');
    h.close();
  });

  it('reports a turn that failed', async () => {
    const { ev } = await run(backend(), 'fail please');
    expect(ev[ev.length - 1]).toEqual({ t: 'result', isError: true, text: 'the model refused' });
  });

  it('reports Codex stopping mid-turn, and works again afterwards', async () => {
    const b = backend();
    const { ev } = await run(b, 'crash now');
    expect(ev[ev.length - 1]).toMatchObject({ t: 'result', isError: true, text: expect.stringMatching(/Codex stopped/) });
    await b.refresh();
    expect(b.models.length).toBeGreaterThan(0);
  });

  it('can be interrupted before it has started, and closed twice', async () => {
    const h = start(backend());
    await h.interrupt();
    h.close();
    h.close();
    expect(h.closed).toBe(true);
    const it = h.events[Symbol.asyncIterator]();
    expect((await it.next()).done).toBe(true);
  });

  it('shows each kind of tool item and what it returned', async () => {
    const { ev } = await run(backend(), 'tools');
    const names = ev.flatMap((e) => (e.t === 'assistant' ? e.blocks.filter((b) => b.type === 'tool_use').map((b: any) => b.name) : []));
    expect(names).toEqual(['mcp__gh__pr', 'mcp__gh__bad', 'calc', 'WebSearch', 'Read']);
    expect(texts(ev)).toEqual(['Step one']);
    const results = ev.filter((e) => e.t === 'tool_results').flatMap((e: any) => e.results);
    expect(results.map((r: any) => [r.id, r.isError])).toEqual([['k1', false], ['k2', true], ['k3', false], ['k4', false], ['k5', false]]);
    expect(results[0].text).toBe('[{"text":"merged"}]');
    expect(results[1].text).toBe('nope');
  });

  it('tracks several helpers, and the end of each', async () => {
    const { ev } = await run(backend(), 'spawn');
    expect(ev.filter((e) => e.t === 'subagent_started')).toEqual([{ t: 'subagent_started', id: 's1', agentId: 'child1' }, { t: 'subagent_started', id: 's1', agentId: 'child2' }]);
    // Both end under the call that started them; the second is a failure.
    const ended = ev.filter((e) => e.t === 'subagent_done');
    expect(ended.map((e: any) => [e.status, e.summary])).toEqual([['completed', 'found it'], ['failed', 'boom']]);
  });
});

describe('Codex asking the user', () => {
  it('asks about a file change, shows it, and shows one it was never told about', async () => {
    const asked: [string, any, any][] = [];
    const { ev } = await run(backend(), 'patchfiles', { canUseTool: async (t: string, i: any, d: any) => { asked.push([t, i, d]); return { behavior: 'allow' }; } });
    expect(asked).toEqual([['Write', { file_path: '/w/new.txt' }, { decisionReason: 'outside' }]]);
    const uses = ev.flatMap((e) => (e.t === 'assistant' ? e.blocks.filter((b) => b.type === 'tool_use').map((b: any) => [b.id, b.name]) : []));
    expect(uses).toEqual([['f2:0', 'Write'], ['f3:0', 'Edit']]);
  });
  it('declines a file change the user refused, and stops the turn when told to interrupt', async () => {
    const declined = await run(backend(), 'patchfiles', { canUseTool: async () => ({ behavior: 'deny', message: 'no' }) });
    const r = declined.ev.find((e) => e.t === 'tool_results') as any;
    expect(r.results[0]).toMatchObject({ id: 'f2:0', text: 'declined', isError: true });
    const cancelled = await run(backend(), 'patchfiles', { canUseTool: async () => ({ behavior: 'deny', message: 'stop', interrupt: true }) });
    expect(cancelled.ev[cancelled.ev.length - 1].t).toBe('result');
  });
  it('turns its questions into the question tool and the answers back', async () => {
    let asked: any;
    const { ev } = await run(backend(), 'ask me', { canUseTool: async (t: string, input: any) => { asked = [t, input]; return { behavior: 'allow', updatedInput: { answers: { 'Which colour?': 'red', 'Anything else?': 'no' } } }; } });
    expect(asked[0]).toBe('AskUserQuestion');
    expect(asked[1].questions).toEqual([
      { question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'red', description: 'warm' }, { label: 'blue', description: 'cool' }] },
      { question: 'Anything else?', header: 'Note', multiSelect: false, options: [] }
    ]);
    expect(texts(ev)).toEqual(['answers: {"color":{"answers":["red"]},"free":{"answers":["no"]}}']);
  });
  it('gives no answers when the user declines to answer', async () => {
    const { ev } = await run(backend(), 'ask me', { canUseTool: async () => ({ behavior: 'deny', message: 'no' }) });
    expect(texts(ev)).toEqual(['answers: {}']);
  });
  it('refuses permissions beyond its sandbox, and requests it does not know', async () => {
    expect(texts((await run(backend(), 'perm please')).ev)).toEqual(['perm: decline']);
    expect(texts((await run(backend(), 'mystery please')).ev)).toEqual(['mystery: helm does not handle mystery/method']);
  });
  it('refuses a request for a session it does not have', async () => {
    expect(texts((await run(backend(), 'ghost please')).ev)).toEqual(['ghost: decline']);
  });
  it('turns down a command the user refused, and an interrupt cancels it', async () => {
    const denied = await run(backend(), 'run it', { canUseTool: async () => ({ behavior: 'deny', message: 'no' }) });
    expect((denied.ev.find((e) => e.t === 'tool_results') as any).results[0].isError).toBe(true);
    const stopped = await run(backend(), 'run it', { canUseTool: async () => ({ behavior: 'deny', message: 'no', interrupt: true }) });
    expect(stopped.ev[stopped.ev.length - 1].t).toBe('result');
  });
});

describe('Codex conversations', () => {
  it('renames, lists, reads and fingerprints them', async () => {
    const c = backend().conversations;
    await c.rename('t9', '/w', 'New name');
    const list = await c.list('/w');
    expect(list.map((x) => [x.id, x.title, x.firstPrompt, x.branch, x.cwd, x.lastModified])).toEqual([['x1', 'One', 'first words', 'main', '/w', 5000], ['x2', undefined, 'second', undefined, '/w', 9000]]);
    expect(await c.signature('t9')).toBe('5:idle');
    expect(await c.signature('gone')).toBe('');
    expect(await c.info('gone')).toBeNull();
    expect(await c.live()).toBeNull();
    const sub = await c.subagentTranscript('t9', 'child1', '/w');
    expect(sub.map((e) => e.k)).toEqual(['agent', 'bash']);
  });
  it('forks with no message and names the copy', async () => {
    expect(await backend().conversations.fork({ sourceId: 't9', sourceDir: '/w', destDir: '/n', title: 'Copy' })).toBe('forked-all');
  });
});

describe('finding Codex', () => {
  it('uses the first `codex` on the PATH, else the plain name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'helm-path-'));
    const name = process.platform === 'win32' ? 'codex.cmd' : 'codex';
    const oldPath = process.env.PATH;
    try {
      writeFileSync(join(dir, name), '#!/bin/sh\n');
      chmodSync(join(dir, name), 0o755);
      process.env.PATH = dir;
      expect(findCodex()).toBe(join(dir, name));
      process.env.PATH = '/nonexistent-dir';
      expect(findCodex()).toMatch(/codex/);
    } finally { process.env.PATH = oldPath; rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Codex mapping details', () => {
  it('converts MCP servers to Codex\'s config, with and without environment and headers', () => {
    expect(codexMcp({ a: { type: 'stdio', command: 'x' }, b: { type: 'sse', url: 'u' } })).toEqual({ a: { command: 'x', args: [] }, b: { url: 'u' } });
    expect(codexMcp()).toEqual({});
  });
  it('makes a schema strict all the way down, through arrays, and leaves other values alone', () => {
    const s = strictSchema({ type: 'object', properties: { list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } }, n: { enum: [1] } }, anyOf: [{ type: 'null' }] });
    expect(s.properties.list.items.properties.a.type).toEqual(['string', 'null']);
    expect(s.properties.n).toEqual({ enum: [1] });
    expect(s.anyOf).toEqual([{ type: 'null' }]);
    expect(strictSchema('text')).toBe('text');
    expect(strictSchema(null)).toBeNull();
  });
  it('reads items it only half knows', () => {
    expect(toolUsesOf({ type: 'collabAgentToolCall', id: 'c', tool: 'wait' })).toEqual([]);
    expect(toolUsesOf({ type: 'webSearch', id: 'w', action: { query: 'q' } })[0].input).toEqual({ query: 'q' });
    expect(toolUsesOf({ type: 'fileChange', id: 'f' })).toEqual([]);
    expect(toolUsesOf({ type: 'fileChange', id: 'f', changes: [{ path: 'a', kind: { type: 'update', move_path: 'b' }, diff: '+x' }] })[0].input.file_path).toBe('b');
    expect(resultsOf({ type: 'fileChange', id: 'f', status: 'failed', changes: [{}] })[0]).toMatchObject({ isError: true, text: 'failed' });
    expect(resultsOf({ type: 'mcpToolCall', id: 'm', result: null, error: null, status: 'completed' })[0].text).toBe('""');
    expect(resultsOf({ type: 'dynamicToolCall', id: 'd', contentItems: null, success: false })[0]).toEqual({ id: 'd', text: '', isError: true });
    expect(resultsOf({ type: 'collabAgentToolCall', id: 'c', tool: 'wait' })).toEqual([]);
    expect(resultsOf({ type: 'collabAgentToolCall', id: 'c', tool: 'spawnAgent', status: 'failed', agentsStates: { x: { message: 'm' } } })[0]).toEqual({ id: 'c', text: 'm', isError: true });
    expect(resultsOf({ type: 'commandExecution', id: 'x' })[0]).toEqual({ id: 'x', text: '', isError: false });
    expect(resultsOf({ type: 'other' })).toEqual([]);
  });
  it('ignores a window with no usage or no reset', () => {
    expect(windowsOf({ primary: { usedPercent: null, resetsAt: 5 }, secondary: { usedPercent: 5, resetsAt: null } })).toEqual({});
  });
});
