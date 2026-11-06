import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgentEvent, ToolDecision } from '../src/core/backend';
import { acpMcp, localModels, modeFor, pullModel, QWEN_SETTINGS, QwenBackend, runtimeState, toolUseOf, withContext } from '../src/core/qwenBackend';

const fake = resolve(__dirname, 'fixtures/fake-qwen.mjs');

// A stand-in for Ollama's HTTP API.
let server: Server;
let url = '';
const tags = [{ name: 'qwen3-coder:30b', size: 19e9 }, { name: 'tiny:1b', size: 1e9 }];
const created: any[] = [];
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const j = (o: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/api/version') return j({ version: '0.0.0' });
      if (req.url === '/api/tags') return j({ models: tags });
      if (req.url === '/api/create') { const b = JSON.parse(body); created.push(b); tags.push({ name: b.model, size: 19e9 }); return j({ status: 'success' }); }
      if (req.url === '/api/pull') {
        const b = JSON.parse(body);
        if (b.model === 'nope') return res.end(JSON.stringify({ error: 'pull model manifest: file does not exist' }) + '\n');
        return res.end([{ status: 'pulling manifest' }, { status: 'downloading', total: 100, completed: 40 }, { status: 'success' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
      }
      res.statusCode = 404; res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

const data = mkdtempSync(join(tmpdir(), 'helm-qwen-'));
const backend = () => new QwenBackend({ cli: () => fake, url: () => url, context: () => 32768, dataDir: () => data });
const take = async (it: AsyncIterator<AgentEvent>, until: (e: AgentEvent) => boolean, ms = 6000) => {
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
const opts = (decide: (tool: string, input: any) => ToolDecision = () => ({ behavior: 'allow' })) => ({
  cwd: process.cwd(), model: 'qwen3-coder:30b', permMode: 'ask' as const, systemAppend: 'be nice',
  canUseTool: async (tool: string, input: any) => decide(tool, input), admitSubagent: async () => undefined
});
const isResult = (e: AgentEvent) => e.t === 'result';

describe('ACP mapping', () => {
  it('maps tool calls into Claude Code\'s vocabulary', () => {
    expect(toolUseOf({ kind: 'execute', rawInput: { command: 'ls' } })).toEqual({ name: 'Bash', input: { command: 'ls' } });
    expect(toolUseOf({ kind: 'read', locations: [{ path: '/a' }] })).toEqual({ name: 'Read', input: { file_path: '/a' } });
    expect(toolUseOf({ kind: 'edit', content: [{ type: 'diff', path: '/a', oldText: 'x', newText: 'y' }] })).toEqual({ name: 'Edit', input: { file_path: '/a', old_string: 'x', new_string: 'y' } });
    expect(toolUseOf({ kind: 'edit', content: [{ type: 'diff', path: '/a', oldText: null, newText: 'new' }] })).toEqual({ name: 'Write', input: { file_path: '/a', content: 'new' } });
    expect(toolUseOf({ kind: 'search', rawInput: { pattern: 'foo' } }).name).toBe('Grep');
    expect(toolUseOf({ kind: 'fetch', rawInput: { url: 'u' } })).toEqual({ name: 'WebFetch', input: { url: 'u', prompt: '' } });
    expect(toolUseOf({ kind: 'other', title: 'Thing', rawInput: { a: 1 } })).toEqual({ name: 'Thing', input: { a: 1 } });
    // The wrapper for on-demand tools is shown as the tool it calls.
    expect(toolUseOf({ kind: 'other', title: 'ToolCall', _meta: { toolName: 'tool_call' }, rawInput: { name: 'web_fetch', arguments: { url: 'u', prompt: 'p' } } })).toEqual({ name: 'WebFetch', input: { url: 'u', prompt: 'p' } });
    expect(toolUseOf({ kind: 'fetch', _meta: { toolName: 'web_fetch' }, rawInput: { url: 'u' } }).name).toBe('WebFetch');
    expect(toolUseOf({ kind: 'other', _meta: { toolName: 'todo_write' }, rawInput: { todos: [1] } })).toEqual({ name: 'TodoWrite', input: { todos: [1] } });
  });
  it('names permission modes the way Qwen Code does', () => {
    expect(['ask', 'edits', 'plan', 'all'].map((m) => modeFor(m as any))).toEqual(['default', 'auto-edit', 'plan', 'yolo']);
  });
  it('converts MCP servers to ACP\'s shape', () => {
    expect(acpMcp({ a: { type: 'stdio', command: 'x', args: ['1'], env: { K: 'v' } }, b: { type: 'http', url: 'u', headers: { H: 'h' } } })).toEqual([
      { name: 'a', command: 'x', args: ['1'], env: [{ name: 'K', value: 'v' }] },
      { type: 'http', name: 'b', url: 'u', headers: [{ name: 'H', value: 'h' }] }
    ]);
  });
});

describe('the local model server', () => {
  it('lists models, hides helm\'s own copies, and reports its state', async () => {
    expect(await runtimeState(url)).toBe('running');
    expect((await localModels(url)).map((m) => [m.name, m.sizeGb])).toEqual([['qwen3-coder:30b', 19], ['tiny:1b', 1]]);
  });
  it('makes a larger-context copy once and reuses it', async () => {
    expect(await withContext(url, 'qwen3-coder:30b', 32768)).toBe('qwen3-coder:30b-helm32k');
    expect(await withContext(url, 'qwen3-coder:30b', 32768)).toBe('qwen3-coder:30b-helm32k');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ from: 'qwen3-coder:30b', parameters: { num_ctx: 32768 } });
    expect((await localModels(url)).map((m) => m.name)).not.toContain('qwen3-coder:30b-helm32k');
  });
  it('reports pull progress and failures', async () => {
    const seen: number[] = [];
    await pullModel(url, 'x', (_s, p) => seen.push(p));
    expect(seen).toEqual([0, 40, 0]);
    await expect(pullModel(url, 'nope', () => undefined)).rejects.toThrow('does not exist');
  });
  it('says the server is missing when nothing answers', async () => {
    expect(['missing', 'stopped']).toContain(await runtimeState('http://127.0.0.1:1'));
  });
});

describe('Qwen Code through a stand-in ACP agent', () => {
  it('reads the version, models and what is still needed', async () => {
    const b = backend();
    expect(b.setupNeeded()).toMatch(/not installed/);
    expect(await b.version()).toBe('9.9.9');
    await b.refresh();
    expect(b.models.map((m) => m.id)).toEqual(['qwen3-coder:30b', 'tiny:1b']);
    expect(b.setupNeeded()).toBeNull();
    const down = new QwenBackend({ cli: () => fake, url: () => 'http://127.0.0.1:1', context: () => 0 });
    await down.version(); await down.refresh();
    expect(down.setupNeeded()).toMatch(/Ollama|not running/);
  });

  it('runs a turn: text, context usage and the end', async () => {
    const h = backend().start(opts());
    h.send('say hello');
    const ev = await take(h.events[Symbol.asyncIterator](), isResult);
    expect(ev[0]).toMatchObject({ t: 'init', model: 'qwen3-coder:30b' });
    expect(ev.find((e) => e.t === 'assistant' && e.blocks.length)).toMatchObject({ blocks: [{ type: 'text', text: 'Hello there.' }] });
    // Each model call reports its own tokens as it goes, with the window from the usage update before it.
    expect(ev.find((e) => e.t === 'assistant' && e.usage)).toMatchObject({ usage: { input: 1000, output: 15, cacheRead: 234, contextWindow: 32768 } });
    expect(ev.at(-1)).toEqual({ t: 'result', isError: false, text: '' });
    h.close();
  });

  it('points qwen at the local server with the model, and leads with the instructions once', async () => {
    const h = backend().start(opts());
    const it = h.events[Symbol.asyncIterator]();
    h.send('show env');
    const first = await take(it, isResult);
    const text = (first.find((e) => e.t === 'assistant' && e.blocks.length) as any).blocks[0].text as string;
    expect(text).toContain(`qwen3-coder:30b-helm32k ${url}/v1 ollama`);
    expect(text).toContain('led');
    // Web tools are offered directly, through a settings file of helm's own.
    const file = text.split(' ').pop()!;
    expect(file).toBe(join(data, 'qwen-settings.json'));
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(QWEN_SETTINGS);
    expect(QWEN_SETTINGS.tools.visible).toContain('web_fetch');
    // It chose the OpenAI-compatible method and the stand-in saw the mode set.
    expect(text).toContain('authenticate');
    expect(text).toContain('session/set_mode');
    h.send('show env');
    const again = await take(it, isResult);
    expect((again.find((e) => e.t === 'assistant' && e.blocks.length) as any).blocks[0].text).toContain('bare');
    h.close();
  });

  it('asks helm before a command and reports its output', async () => {
    const asked: any[] = [];
    const h = backend().start(opts((tool, input) => { asked.push([tool, input]); return { behavior: 'allow' }; }));
    h.send('run ls');
    const ev = await take(h.events[Symbol.asyncIterator](), isResult);
    expect(asked).toEqual([['Bash', { command: 'ls -l' }]]);
    expect(ev.find((e) => e.t === 'assistant' && e.blocks[0]?.type === 'tool_use')).toMatchObject({ blocks: [{ id: 't1', name: 'Bash', input: { command: 'ls -l' } }] });
    expect(ev.find((e) => e.t === 'tool_results')).toMatchObject({ results: [{ id: 't1', text: 'a.txt', isError: false }] });
    expect(ev.at(-1)).toMatchObject({ isError: false });
    h.close();
  });

  it('waits for a tool\'s arguments before showing it, and shows what the model really called', async () => {
    const h = backend().start(opts());
    const it = h.events[Symbol.asyncIterator]();
    h.send('bridge ok');
    const ev = await take(it, isResult);
    const uses = ev.flatMap((e) => (e.t === 'assistant' ? e.blocks : [])).filter((b) => b.type === 'tool_use');
    expect(uses).toEqual([{ type: 'tool_use', id: 'b2', name: 'WebFetch', input: { url: 'https://example.com', prompt: 'logo' } }]);
    h.send('bridge fail');
    const bad = await take(it, isResult);
    expect(bad.find((e) => e.t === 'tool_results')).toMatchObject({ results: [{ id: 'b1', isError: true, text: expect.stringContaining('bridge refused') }] });
    h.close();
  });

  it('refuses a command when told to', async () => {
    const h = backend().start(opts(() => ({ behavior: 'deny', message: 'no' })));
    h.send('run ls');
    const ev = await take(h.events[Symbol.asyncIterator](), isResult);
    expect(ev.find((e) => e.t === 'tool_results')).toMatchObject({ results: [{ isError: true }] });
    expect(JSON.stringify(ev)).toContain('Declined.');
    h.close();
  });

  it('cancels the turn on interrupt', async () => {
    const h = backend().start(opts());
    const it = h.events[Symbol.asyncIterator]();
    h.send('slow');
    await take(it, (e) => e.t === 'init');
    await new Promise((r) => setTimeout(r, 100));
    await h.interrupt();
    const ev = await take(it, isResult);
    expect(ev.at(-1)).toEqual({ t: 'result', isError: false, text: '' });
    h.close();
  });

  it('reports a refusal and a crash as failures', async () => {
    const h = backend().start(opts());
    h.send('refuse');
    expect((await take(h.events[Symbol.asyncIterator](), isResult)).at(-1)).toMatchObject({ t: 'result', isError: true, text: expect.stringContaining('refusal') });
    h.close();
    const c = backend().start(opts());
    c.send('crash');
    expect((await take(c.events[Symbol.asyncIterator](), isResult)).at(-1)).toMatchObject({ t: 'result', isError: true, text: expect.stringContaining('stopped') });
    c.close();
  });

  it('starts again on a changed model and reloads the conversation (same id)', async () => {
    const h = backend().start(opts());
    const it = h.events[Symbol.asyncIterator]();
    h.send('say hello');
    const first = await take(it, isResult);
    const id = (first[0] as any).sessionId;
    await h.setModel('tiny:1b');
    h.send('show env');
    const ev = await take(it, isResult);
    expect(JSON.stringify(ev)).toContain('tiny:1b-helm32k');
    expect(JSON.stringify(ev)).toContain('session/load');
    expect(id).toMatch(/^sess-/);
    expect(ev[0]).toMatchObject({ sessionId: id });
    h.close();
  });

  it('resumes with session/load', async () => {
    const h = backend().start({ ...opts(), resume: 'old-session' });
    h.send('show env');
    const ev = await take(h.events[Symbol.asyncIterator](), isResult);
    expect(ev[0]).toMatchObject({ t: 'init', sessionId: 'old-session' });
    expect(JSON.stringify(ev)).toContain('session/load');
    expect(JSON.stringify(ev)).toContain('bare');
    h.close();
  });

  it('says so when qwen is not installed', async () => {
    const b = new QwenBackend({ cli: () => '/nonexistent/qwen', url: () => url, context: () => 0 });
    const h = b.start(opts());
    h.send('hi');
    const ev = await take(h.events[Symbol.asyncIterator](), isResult);
    expect(ev.at(-1)).toMatchObject({ isError: true, text: expect.stringMatching(/qwen|installed|not be started|stopped/i) });
    h.close();
  });

  it('answers a review in JSON', async () => {
    const b = backend();
    const r = await b.review({ cwd: process.cwd(), model: 'tiny:1b', prompt: 'say hello', schema: {} });
    expect(r.failure).toBe('');
    expect(r.text).toBe('Hello there.');
  });

  it('tracks downloads', async () => {
    const b = backend();
    b.pull('x');
    await new Promise((r) => setTimeout(r, 300));
    const rt = await b.runtime();
    expect(rt.state).toBe('running');
    expect(rt.pulls).toEqual([]);
    expect(rt.recommended.map((m) => m.name)).toContain('qwen3-coder:30b');
    b.pull('nope');
    await new Promise((r) => setTimeout(r, 300));
    expect((await b.runtime()).pulls[0]).toMatchObject({ name: 'nope', error: expect.stringContaining('does not exist') });
    b.dismissPull('nope');
    expect((await b.runtime()).pulls).toEqual([]);
  });
});
