import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Agent SDK: each query() is a channel the test pushes messages into.
const fake = vi.hoisted(() => {
  class FakeQuery {
    buf: any[] = [];
    waiters: { resolve: (r: IteratorResult<any>) => void; reject: (e: any) => void }[] = [];
    ended = false;
    failWith: Error | null = null;
    received: any[] = [];
    interrupt = vi.fn(async () => undefined);
    setModel = vi.fn(async () => undefined);
    setPermissionMode = vi.fn(async () => undefined);
    applyFlagSettings = vi.fn(async () => undefined);
    close = vi.fn();
    constructor(public prompt: any, public options: any) {
      if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') void (async () => { if (fake.delay.ms) await new Promise((r) => setTimeout(r, fake.delay.ms)); for await (const m of prompt) this.received.push(m); })();
    }
    emit(m: any) { const w = this.waiters.shift(); if (w) w.resolve({ value: m, done: false }); else this.buf.push(m); }
    end() { this.ended = true; for (const w of this.waiters.splice(0)) w.resolve({ value: undefined, done: true }); }
    fail(e: Error) { this.failWith = e; for (const w of this.waiters.splice(0)) w.reject(e); }
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (this.buf.length) return Promise.resolve({ value: this.buf.shift(), done: false });
          if (this.failWith) return Promise.reject(this.failWith);
          if (this.ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<any>>((resolve, reject) => this.waiters.push({ resolve, reject }));
        }
      };
    }
  }
  const state = { queries: [] as FakeQuery[], info: null as any, subMsgs: [] as any[], renamed: [] as any[], msgs: [] as any[], forkResult: null as any, forkArgs: [] as any[] };
  const delay = { ms: 0 };
  return { FakeQuery, state, delay };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: any) => { const q = new fake.FakeQuery(prompt, options); fake.state.queries.push(q); return q; },
  getSessionInfo: async () => fake.state.info,
  getSubagentMessages: async () => fake.state.subMsgs,
  getSessionMessages: async () => fake.state.msgs,
  forkSession: async (...a: any[]) => { fake.state.forkArgs.push(a); return fake.state.forkResult ?? { sessionId: 'forked' }; },
  renameSession: async (...a: any[]) => { fake.state.renamed.push(a); }
}));

import { SessionManager } from '../src/core/sessions';
import { claudeProjectDir } from '../src/core/claudeBackend';
import { Store } from '../src/core/store';
import { FREE_ID, type NewSessionInput } from '../src/shared/types';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const until = async (fn: () => any, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting: ' + fn.toString()); await new Promise((r) => setTimeout(r, 5)); }
};

const untilAsync = async (fn: () => Promise<any>, ms = 3000) => {
  const t0 = Date.now();
  while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 5)); }
};

let root: string, repoPath: string, store: Store, sm: SessionManager, hooks: any;
let oldTmp: string | undefined, oldHome: string | undefined;
const q = () => fake.state.queries[fake.state.queries.length - 1];
const input = (over: Partial<NewSessionInput> = {}): NewSessionInput => ({ repoId: 'o/r', base: 'main', task: 'Fix the thing', model: 'sonnet', budget: 0, permMode: 'ask', ...over });
const text = (t: string, usage?: any) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }], usage } });
const tool = (name: string, inp: any, id = 'tu' + Math.random()) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: inp }] }, _id: id });
const result = (id: string, content: string, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const done = (over: any = {}) => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, ...over });
const transcript = async (id: string) => store.transcript(id);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-sess-'));
  oldTmp = process.env.TMPDIR;
  process.env.TMPDIR = join(root, 'tmp');
  mkdirSync(process.env.TMPDIR);
  oldHome = process.env.HOME;
  process.env.HOME = join(root, 'home');
  mkdirSync(process.env.HOME);
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 800)); // let delayed saves land before the folder goes
  await store.flushAll().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 50));
  if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  rmSync(root, { recursive: true, force: true });
});

let n = 0;
beforeEach(async () => {
  fake.delay.ms = 0; fake.state.queries.length = 0; fake.state.msgs = []; fake.state.forkResult = null; fake.state.forkArgs = []; fake.state.info = null; fake.state.subMsgs = []; fake.state.renamed = [];
  repoPath = join(root, 'repo' + (n + 1));
  mkdirSync(repoPath);
  g(repoPath, 'init', '-q', '-b', 'main');
  writeFileSync(join(repoPath, 'a.txt'), 'one\n');
  writeFileSync(join(repoPath, '.gitignore'), '.env\n');
  g(repoPath, 'add', '.');
  g(repoPath, 'commit', '-q', '-m', 'init');
  writeFileSync(join(repoPath, '.env'), 'SECRET=1');
  store = new Store();
  await store.load(join(root, 'data' + ++n));
  store.data.settings.worktreeRoot = join(root, 'wt' + n);
  store.data.settings.freeRoot = join(root, 'free' + n);
  store.data.settings.billing = 'api';
  store.data.settings.billingDetected = true;
  store.data.repos.push({ id: 'o/r', owner: 'o', name: 'r', private: false, lang: null, defaultBranch: 'main', localPath: repoPath, cap: 0, addedAt: 0 });
  hooks = { emitState: vi.fn(), emitTranscript: vi.fn(), toast: vi.fn(), notify: vi.fn(), claudePath: () => '/bin/claude' };
  sm = new SessionManager(store, hooks);
});
afterEach(async () => { await sm.stopAll(); sm.shutdown(); });


describe('the input stream to the agent', () => {
  it('sends an image-only reply with a stand-in sentence', async () => {
    const id = await sm.create(input());
    await sm.send(id, '', [{ mediaType: 'image/png', data: 'QQ==' } as any]);
    await until(() => q().received.length === 2);
    const c = q().received[1].message.content;
    expect(c[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QQ==' } });
    expect(c[1]).toEqual({ type: 'text', text: 'See the attached image.' });
  });

  it('delivers a message queued before the agent read it, then ends the stream once stopped', async () => {
    fake.delay.ms = 40;
    const id = await sm.create(input());
    await sm.stop(id);
    await until(() => q().received.length === 1);
    expect(q().received[0].message.content).toBe('Fix the thing');
    await new Promise((r) => setTimeout(r, 30));
    expect(q().received).toHaveLength(1);
  });
});

describe('the queue and release', () => {
  it('releases a session waiting on a merge even if resetting its branch fails', async () => {
    store.data.settings.maxRunning = 1;
    const a = await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second', after: a }));
    const s = sm.get(b)!;
    s.base = 'no-such-ref';
    await sm.startNow(b);
    expect(s.status).toBe('working');
    expect(sm.isRunning(b)).toBe(true);
    expect(s.step).toBe('Starting');
  });

  it('does not reset the branch of a session whose worktree is gone', async () => {
    store.data.settings.maxRunning = 1;
    const a = await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second', after: a }));
    const s = sm.get(b)!;
    s.worktreeGone = true;
    await sm.startNow(b);
    expect(s.queued).toBeUndefined();
  });
});

describe('fork and review edge cases', () => {
  it('says so when Claude Code\'s project folder does not exist at all', async () => {
    const id = await sm.create(input(), { conversation: async () => 'src-x' });
    await sm.stop(id);
    fake.state.msgs = [{ type: 'assistant', uuid: 'a0' }, { type: 'user', uuid: 'u0', message: { content: 'Fix the thing' } }];
    const home = process.env.HOME;
    process.env.HOME = join(root, 'emptyhome' + n);
    mkdirSync(process.env.HOME);
    try {
      await expect(sm.fork(id, 0, 'x')).rejects.toThrow(/could not be found on disk/);
    } finally { process.env.HOME = home; }
  });

  it('reviews even when the head cannot be read', async () => {
    const id = await sm.create(input());
    await sm.stop(id);
    const s = sm.get(id)!;
    s.worktree = mkdtempSync(join(root, 'notgit'));
    await sm.review(id);
    expect(s.review).toMatchObject({ state: 'running', head: '' });
    q().end();
    await until(() => s.review!.state !== 'running');
    expect(s.review!.state).toBe('failed');
  });
});

describe('the run loop', () => {
  it('detects billing from the first init when it was not known, and leaves a known setting alone', async () => {
    store.data.settings.billingDetected = false;
    store.data.settings.billing = 'api';
    const a = await sm.create(input({ task: 'One' }));
    q().emit({ type: 'system', subtype: 'init', session_id: 'c1', model: 'm', apiKeySource: 'none' });
    await until(() => store.data.settings.billingDetected);
    expect(store.data.settings.billing).toBe('subscription');
    q().emit({ type: 'system', subtype: 'init', session_id: 'c1b', model: 'm', apiKeySource: 'user' });
    await until(() => sm.get(a)!.agentSessionId === 'c1b');
    expect(store.data.settings.billing).toBe('subscription');
    store.data.settings.billingDetected = false;
    await sm.create(input({ task: 'Two' }));
    q().emit({ type: 'system', subtype: 'init', session_id: 'c2', model: 'm', apiKeySource: 'ANTHROPIC_API_KEY' });
    await until(() => store.data.settings.billingDetected);
    expect(store.data.settings.billing).toBe('api');
  });

  it('ignores unrelated message types', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit({ type: 'system', subtype: 'other' });
    q().emit({ type: 'system', subtype: 'task_started' });
    q().emit({ type: 'system', subtype: 'task_started', tool_use_id: 'ghost', task_id: 't' });
    q().emit({ type: 'stream_event' });
    q().emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
    q().emit(text('marker'));
    await untilAsync(async () => (await transcript(id)).some((e: any) => e.text === 'marker'));
    expect(s.subagents).toEqual([]);
  });

  it('reports a failure of the agent process, and ends quietly when it was stopped', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const ask = q().options.canUseTool('Bash', { command: 'rm x' }, {});
    await until(() => s.ask);
    q().fail(new Error('process exited'));
    await until(() => s.status === 'error');
    expect(await ask).toMatchObject({ behavior: 'deny', message: 'Session ended' });
    expect(s.error).toBe('process exited');
    expect(s.ask).toBeUndefined();
    expect(hooks.notify).toHaveBeenCalledWith('failed', `${id} failed`, 'process exited', id);
    expect((await transcript(id)).at(-1)).toMatchObject({ k: 'note', tone: 'error', text: 'process exited' });
    expect(sm.isRunning(id)).toBe(false);

    const id2 = await sm.create(input({ task: 'Quiet' }));
    const q2 = q();
    await sm.stop(id2);
    q2.fail(new Error('killed'));
    await new Promise((r) => setTimeout(r, 30));
    expect(sm.get(id2)!.error).toBeUndefined();
    expect(sm.get(id2)!.status).toBe('idle');
  });

  it('turns a dead stream into Stopped, but leaves a finished session as it was', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(done());
    await until(() => s.status === 'idle');
    const step = s.step;
    q().end();
    await until(() => !sm.isRunning(id));
    expect(s.status).toBe('idle');
    expect(s.step).toBe(step);
    expect(step).not.toBe('Stopped');
    const id2 = await sm.create(input({ task: 'Dies' }));
    q().end();
    await until(() => sm.get(id2)!.step === 'Stopped');
    expect(sm.get(id2)!.status).toBe('idle');
  });

  it('does not touch a session that was running when helm quit', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const qq = q();
    sm.shutdown();
    qq.end();
    await new Promise((r) => setTimeout(r, 30));
    expect(s.status).toBe('working');
    expect(s.step).not.toBe('Stopped');
  });
});

describe('subagents in the run loop', () => {
  const startAgent = async (parent?: string, id = 'sa1') => q().emit({ ...tool('Agent', { description: 'Sub ' + id, prompt: 'p' }, id), ...(parent ? { parent_tool_use_id: parent } : {}) });

  it('nests subagents, and a change deep down keeps every parent from being archived', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await startAgent();
    await until(() => s.subagents.length === 1);
    await startAgent('sa1', 'sa2');
    await until(() => s.subagents.length === 2);
    expect(s.subagents[1].parentId).toBe('sa1');
    expect((await transcript(`${id}~sa1`)).at(-1)).toMatchObject({ k: 'subagent', id: 'sa2' });
    expect(await transcript(`${id}~sa2`)).toMatchObject([{ k: 'user', from: 'Sub sa1' }]);
    q().emit({ ...tool('Write', { file_path: join(s.worktree, 'n.txt'), content: 'x' }, 'w1'), parent_tool_use_id: 'sa2' });
    await until(() => s.subagents[1].changed);
    expect(s.subagents[0].changed).toBe(true);
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa2', status: 'completed', summary: '  ok  ' });
    await until(() => s.subagents[1].status === 'done');
    expect(s.subagents[1].archived).toBeFalsy();
    expect(s.subagents[1].summary).toBe('ok');
    // a second notification for a finished one, or an unknown one, changes nothing
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa2', status: 'failed', summary: 'late' });
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'nobody', status: 'failed' });
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa1', status: 'stopped' });
    await until(() => s.subagents[0].status === 'stopped');
    expect(s.subagents[1].status).toBe('done');
    expect(s.subagents[1].summary).toBe('ok');
  });

  it('marks a failed subagent and wakes the parent that had finished its turn', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await startAgent();
    await until(() => s.subagents.length === 1);
    q().emit(done());
    await until(() => s.status !== 'working');
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa1', status: 'failed' });
    await until(() => s.subagents[0].status === 'failed');
    await until(() => s.status === 'working');
    expect(s.step).toBe('Continuing with the result of Sub sa1');
    expect(s.subagents[0].summary).toBeUndefined();
  });

  it('does not wake a session that was archived, merged or is asking', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await startAgent();
    await until(() => s.subagents.length === 1);
    q().emit(done());
    await until(() => s.status === 'idle');
    s.mergedAt = Date.now();
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa1', status: 'completed' });
    await until(() => s.subagents[0].status === 'done');
    expect(s.status).toBe('idle');

  });

  it('tracks progress without usage, ignores unknown subagents, and syncs the transcript at most every few seconds', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit({ type: 'system', subtype: 'init', session_id: 'claude-sync', model: 'm', apiKeySource: 'none' });
    await until(() => s.agentSessionId);
    await startAgent();
    await until(() => s.subagents.length === 1);
    q().emit({ type: 'system', subtype: 'task_started', tool_use_id: 'sa1', task_id: 'ag-1' });
    await until(() => s.subagents[0].agentId === 'ag-1');
    q().emit({ type: 'system', subtype: 'task_progress', tool_use_id: 'ghost', usage: { tool_uses: 9 } });
    fake.state.subMsgs = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'first' }, { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a' } }] } }];
    q().emit({ type: 'system', subtype: 'task_progress', tool_use_id: 'sa1', usage: {} });
    const key = `${id}~sa1`;
    await untilAsync(async () => (await transcript(key)).some((e: any) => e.text === 'first'));
    expect(s.subagents[0].tools).toBe(0);
    expect(s.step).toBe('Subagent: Sub sa1');
    // a second progress straight away does not read again
    fake.state.subMsgs = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'second' }] } }];
    q().emit({ type: 'system', subtype: 'task_progress', tool_use_id: 'sa1', last_tool_name: 'Grep', usage: { tool_uses: 2, total_tokens: 7 } });
    await until(() => s.step === 'Sub sa1: Grep');
    expect(s.subagents[0]).toMatchObject({ tools: 2, tokens: 7 });
    expect((await transcript(key)).some((e: any) => e.text === 'second')).toBe(false);
    // an explicit refresh does: changed events replace, and a shorter transcript is cut
    const emitted = hooks.emitTranscript.mock.calls.length;
    await sm.refreshSubagent(id, 'sa1');
    const t = await transcript(key);
    expect(t.map((e: any) => e.k)).toEqual(['user', 'agent']);
    expect((t[1] as any).text).toBe('second');
    expect(hooks.emitTranscript.mock.calls.length).toBeGreaterThan(emitted);
    expect(s.subagents[0].agentId).toBe('ag-1');
  });

  it('keeps the old transcript when the session file cannot be read yet', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit({ type: 'system', subtype: 'init', session_id: 'cs', model: 'm', apiKeySource: 'none' });
    await until(() => s.agentSessionId);
    await startAgent();
    await until(() => s.subagents.length === 1);
    s.subagents[0].agentId = 'ag';
    fake.state.subMsgs = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'kept' }] } }];
    await sm.refreshSubagent(id, 'sa1');
    fake.state.subMsgs = null as any; // convertMessages throws on null
    await sm.refreshSubagent(id, 'sa1');
    expect((await transcript(`${id}~sa1`)).some((e: any) => e.text === 'kept')).toBe(true);
  });
});
