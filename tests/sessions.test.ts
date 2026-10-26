import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
      if (prompt && typeof prompt[Symbol.asyncIterator] === 'function') void (async () => { for await (const m of prompt) this.received.push(m); })();
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
  const state = { queries: [] as FakeQuery[], info: null as any, subMsgs: [] as any[], renamed: [] as any[] };
  return { FakeQuery, state };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: any) => { const q = new fake.FakeQuery(prompt, options); fake.state.queries.push(q); return q; },
  getSessionInfo: async () => fake.state.info,
  getSubagentMessages: async () => fake.state.subMsgs,
  getSessionMessages: async () => [],
  forkSession: async () => ({ sessionId: 'forked' }),
  renameSession: async (...a: any[]) => { fake.state.renamed.push(a); }
}));

import { SessionManager } from '../src/core/sessions';
import { Store } from '../src/core/store';
import { FREE_ID, type NewSessionInput } from '../src/shared/types';

const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
const until = async (fn: () => any, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting: ' + fn.toString()); await new Promise((r) => setTimeout(r, 5)); }
};

let root: string, repoPath: string, store: Store, sm: SessionManager, hooks: any;
let oldTmp: string | undefined;
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
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 800)); // let delayed saves land before the folder goes
  if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  rmSync(root, { recursive: true, force: true });
});

let n = 0;
beforeEach(async () => {
  fake.state.queries.length = 0; fake.state.info = null; fake.state.subMsgs = []; fake.state.renamed = [];
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

describe('starting a session', () => {
  it('makes a worktree, copies ignored files, and starts the agent with the task', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    expect(id).toBe('fix-the-thing');
    expect(s.branch).toBe('agent/fix-the-thing');
    expect(existsSync(join(s.worktree, 'a.txt'))).toBe(true);
    expect(existsSync(join(s.worktree, '.env'))).toBe(true);
    const opts = q().options;
    expect(opts.cwd).toBe(s.worktree);
    expect(opts.model).toBe('sonnet');
    expect(opts.permissionMode).toBe('default');
    expect(opts.pathToClaudeCodeExecutable).toBe('/bin/claude');
    expect(opts.systemPrompt.append).toContain('agent/fix-the-thing');
    expect(opts.systemPrompt.append).toContain('helm session fix-the-thing');
    await until(() => q().received.length === 1);
    expect(q().received[0].message.content).toBe('Fix the thing');
    expect(sm.isRunning(id)).toBe(true);
    expect((await transcript(id))[0]).toMatchObject({ k: 'user', text: 'Fix the thing', cp: 1 });
  });

  it('names a second session with the same task apart', async () => {
    await sm.create(input());
    expect(await sm.create(input())).toBe('fix-the-thing-2');
  });

  it('rejects an unknown repository and starts nothing', async () => {
    await expect(sm.create(input({ repoId: 'x/y' }))).rejects.toThrow(/not found/);
  });

  it('starts a free agent in a scratch folder, or in a folder you chose', async () => {
    const id = await sm.create(input({ repoId: FREE_ID, task: 'Scratch work' }));
    const s = sm.get(id)!;
    expect(s.free).toEqual({ managed: true });
    expect(existsSync(join(s.worktree, '.git'))).toBe(true);
    expect(q().options.systemPrompt.append).toContain('free agent');
    const own = join(root, 'own');
    mkdirSync(own);
    const id2 = await sm.create(input({ repoId: FREE_ID, task: 'In my folder', folder: own }));
    expect(sm.get(id2)!.free).toEqual({ managed: false });
    expect(q().options.systemPrompt.append).toContain('one of the user');
    await expect(sm.create(input({ repoId: FREE_ID, task: 'Nowhere', folder: join(root, 'missing') }))).rejects.toThrow(/does not exist/);
  });

  it('queues when too many sessions run, and starts the queued one when a slot frees', async () => {
    store.data.settings.maxRunning = 1;
    const a = await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second' }));
    expect(sm.get(b)!.queued).toBeTruthy();
    expect(sm.get(b)!.status).toBe('idle');
    expect(fake.state.queries).toHaveLength(1);
    await sm.stop(a);
    await until(() => !sm.get(b)!.queued);
    await until(() => fake.state.queries.length === 2);
    expect(sm.get(b)!.status).toBe('working');
  });

  it('starts a queued session now, or takes it out of the queue', async () => {
    store.data.settings.maxRunning = 1;
    await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second' }));
    const c = await sm.create(input({ task: 'Third' }));
    await sm.dequeue(c);
    expect(sm.get(c)!.queued).toBeUndefined();
    expect(sm.get(c)!.step).toBe('Not started');
    await sm.startNow(b);
    expect(sm.isRunning(b)).toBe(true);
    await sm.startNow('nope');
  });

  it('compares models side by side', async () => {
    await expect(sm.createGroup(input(), [{ model: 'sonnet' }])).rejects.toThrow(/at least two/);
    await expect(sm.createGroup(input({ repoId: FREE_ID }), [{ model: 'sonnet' }, { model: 'opus' }])).rejects.toThrow(/repository/);
    const ids = await sm.createGroup(input({ task: 'Compare' }), [{ model: 'sonnet' }, { model: 'opus', effort: 'high' }]);
    expect(ids).toHaveLength(2);
    expect(sm.get(ids[1])!.model).toBe('opus');
    const group = sm.get(ids[0])!.group!;
    await expect(sm.keepFromGroup(group, 'nope')).rejects.toThrow();
    await sm.keepFromGroup(group, ids[0]);
    expect(sm.get(ids[1])!.archivedAt).toBeTruthy();
    expect(sm.get(ids[0])!.archivedAt).toBeUndefined();
  });
});

describe('the agent talking', () => {
  it('records the init, text, token use and cost', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit({ type: 'system', subtype: 'init', session_id: 'claude-1', model: 'claude-sonnet-5', apiKeySource: 'none' });
    await until(() => s.agentSessionId);
    expect(s.modelName).toBe('claude-sonnet-5');
    q().emit(text('Working on it [chart](artifact:c%20d.png)', { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 }));
    await until(() => s.tokens.output === 50);
    expect(s.tokens).toEqual({ input: 110, output: 50, cacheRead: 1000 });
    expect(s.ctx).toBe(1110);
    expect(s.cost).toBeGreaterThan(0);
    expect(s.artifacts?.map((a) => a.name)).toEqual(['c d.png']);
    expect(store.data.totals['o/r'].output).toBe(50);
    q().emit(done({ total_cost_usd: 1.25 }));
    await until(() => s.status === 'idle');
    expect(s.cost).toBe(1.25);
    expect(s.step).toBe('Finished');
  });

  it('shows a session that changed things as ready for review, and tells you', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(s.worktree, 'a.txt'), 'one\ntwo\n');
    q().emit(done());
    await until(() => s.status === 'ready');
    expect(s.files).toBe(1);
    expect(s.add).toBe(1);
    expect(hooks.notify).toHaveBeenCalledWith('ready', expect.any(String), expect.any(String), id);
    expect(hooks.toast).toHaveBeenCalled();
  });

  it('shows a failed run as an error', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(done({ is_error: true, result: 'Credit balance too low' }));
    await until(() => s.status === 'error');
    expect(s.error).toBe('Credit balance too low');
    expect(hooks.notify).toHaveBeenCalledWith('failed', expect.any(String), 'Credit balance too low', id);
  });

  it('shows a crashed agent process as an error', async () => {
    const id = await sm.create(input());
    q().fail(new Error('process exited'));
    await until(() => sm.get(id)!.status === 'error');
    expect(sm.isRunning(id)).toBe(false);
  });

  it('goes idle when the agent just ends', async () => {
    const id = await sm.create(input());
    q().end();
    await until(() => sm.get(id)!.status === 'idle');
    expect(sm.get(id)!.step).toBe('Stopped');
  });

  it('records commands, results, commits and stuck loops', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(tool('Bash', { command: 'git commit -m x', description: 'commit' }, 'b1'));
    await until(() => s.tools?.Bash);
    q().emit(result('b1', '[agent/fix 1234abc] x\n 1 file changed'));
    await until(() => s.commits.length === 1);
    const t = await transcript(id);
    expect(t.find((e) => e.k === 'bash')).toMatchObject({ done: true, ok: true });
    expect(t.some((e) => e.k === 'commit')).toBe(true);
    expect(store.data.audit.some((a) => a.kind === 'command')).toBe(true);
    for (let i = 0; i < 3; i++) {
      q().emit(tool('Bash', { command: 'npm test' }, 'f' + i));
      q().emit(result('f' + i, 'FAIL', true));
    }
    await until(() => s.stuck);
    q().emit(tool('Bash', { command: 'git push origin x' }, 'p1'));
    q().emit(tool('Bash', { command: 'git checkout x' }, 'p2'));
    await until(() => s.tools!.Bash.n >= 6);
  });

  it('records edits, reads and subagent-free tool groups', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(s.worktree, 'a.txt'), 'one\nnew line\n');
    q().emit(tool('Read', { file_path: join(s.worktree, 'a.txt') }, 'r1'));
    q().emit(tool('Grep', { pattern: 'one' }, 'r2'));
    q().emit(result('r1', 'a\nb\nc'));
    q().emit(result('r2', 'x:1\nx:2'));
    q().emit(tool('Edit', { file_path: join(s.worktree, 'a.txt'), old_string: 'one', new_string: 'new line' }, 'e1'));
    q().emit(tool('MultiEdit', { file_path: join(s.worktree, 'a.txt'), edits: [{ old_string: 'a', new_string: 'b' }] }, 'e2'));
    q().emit(tool('Write', { file_path: join(s.worktree, 'w.txt'), content: Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n') }, 'e3'));
    q().emit(result('e1', 'ok'));
    q().emit(result('e2', 'ok'));
    q().emit(result('e3', 'bad', true));
    await until(() => s.tools?.Write?.err === 1);
    const t = await transcript(id);
    const tools = t.find((e) => e.k === 'tools') as any;
    expect(tools.items.map((i: any) => i[0])).toEqual(['Read', 'Grep']);
    expect(tools.items[0][2]).toBe('3 lines');
    expect(tools.items[1][2]).toBe('2 matches');
    const edits = t.filter((e) => e.k === 'edit') as any[];
    expect(edits[0]).toMatchObject({ file: 'a.txt', add: 1, del: 1 });
    expect(edits[2].lines.at(-1)[1]).toMatch(/6 more lines/);
    expect(s.editing?.file).toBe('a.txt');
    expect(s.tools!.Write.err).toBe(1);
    q().emit(done());
    await until(() => s.status === 'ready');
  });

  it('follows subagents from start to hand-back', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(tool('Agent', { description: 'Look around', prompt: 'find x', subagent_type: 'Explore' }, 'sa1'));
    await until(() => s.subagents.length === 1);
    q().emit({ type: 'system', subtype: 'task_started', tool_use_id: 'sa1', task_id: 'agent-9' });
    await until(() => s.subagents[0].agentId === 'agent-9');
    q().emit({ type: 'system', subtype: 'task_progress', tool_use_id: 'sa1', usage: { tool_uses: 3, total_tokens: 400 }, last_tool_name: 'Read' });
    await until(() => s.subagents[0].tools === 3);
    q().emit({ type: 'assistant', parent_tool_use_id: 'sa1', message: { content: [{ type: 'text', text: 'found it' }], usage: { input_tokens: 5, output_tokens: 5 } } });
    q().emit({ type: 'assistant', parent_tool_use_id: 'unknown', message: { content: [{ type: 'text', text: 'lost' }] } });
    fake.state.subMsgs = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'synced' }] } }];
    q().emit(result('sa1', 'All done: it is in a.txt'));
    await until(() => s.subagents[0].status === 'done');
    expect(s.subagents[0].archived).toBe(true);
    expect(s.subagents[0].summary).toContain('in a.txt');
    expect((await transcript(`${id}~sa1`)).some((e: any) => e.text === 'found it' || e.text === 'synced')).toBe(true);
    // a background one finishes by its notification
    q().emit(tool('Task', { description: 'Later', prompt: 'p', run_in_background: true }, 'sa2'));
    await until(() => s.subagents.length === 2);
    q().emit(result('sa2', 'started'));
    q().emit(done());
    await until(() => s.step.startsWith('Waiting for subagent'));
    q().emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'sa2', status: 'completed', summary: 'fine' });
    await until(() => s.subagents[1].status === 'done');
    expect(s.status).toBe('working');
    await sm.refreshSubagent(id, 'sa2');
    await sm.refreshSubagent(id, 'zzz');
  });

  it('limits how many subagents run at once', async () => {
    store.data.settings.maxSubagentsSession = 1;
    const id = await sm.create(input());
    const hook = q().options.hooks.PreToolUse[0].hooks[0];
    expect(await hook({ tool_use_id: 'a' })).toEqual({});
    q().emit(tool('Agent', { description: 'one', prompt: 'p' }, 'a'));
    await until(() => sm.get(id)!.subagents.length === 1);
    const out = await hook({ tool_use_id: 'b' });
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/limit/);
    store.data.settings.maxSubagentsSession = 0;
    expect((await hook({ tool_use_id: 'c' })).hookSpecificOutput.permissionDecisionReason).toMatch(/turned off/);
  });
});

describe('permissions', () => {
  const ask = (name: string, inp: any) => q().options.canUseTool(name, inp, {});

  it('lets safe commands, always-allowed ones and edits inside the worktree through', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    expect((await ask('Bash', { command: 'ls -la' })).behavior).toBe('allow');
    expect((await ask('Bash', { command: 'git status' })).behavior).toBe('allow');
    store.data.settings.alwaysAllow = ['npm test*'];
    expect((await ask('Bash', { command: 'npm test -- x' })).behavior).toBe('allow');
    expect((await ask('Edit', { file_path: join(s.worktree, 'a.txt') })).behavior).toBe('allow');
    expect((await ask('Read', { file_path: '/etc/hosts' })).behavior).toBe('allow');
    s.preApproved = ['rm -rf build'];
    expect((await ask('Bash', { command: 'rm -rf build' })).behavior).toBe('allow');
    expect(s.preApproved).toEqual([]);
  });

  it('waits for approval of a command and lets it through when approved', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('Bash', { command: 'npm install' });
    await until(() => s.ask);
    expect(s.status).toBe('attention');
    expect(hooks.notify).toHaveBeenCalledWith('attention', expect.any(String), expect.any(String), id);
    expect((await transcript(id)).some((e) => e.k === 'permission')).toBe(true);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'approve' });
    expect((await p).behavior).toBe('allow');
    expect(s.status).toBe('working');
    expect(store.data.audit.at(-1)).toMatchObject({ kind: 'approval', decision: 'approved' });
  });

  it('can deny with a reason, or always allow a pattern', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    let p = ask('Bash', { command: 'make deploy' });
    await until(() => s.ask);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'deny', text: 'not on prod' });
    expect(await p).toMatchObject({ behavior: 'deny', message: expect.stringContaining('not on prod') });
    p = ask('Bash', { command: 'make build' });
    await until(() => s.ask);
    const pattern = s.ask!.pattern!;
    await sm.resolveAsk(id, s.ask!.id, { decision: 'always' });
    expect((await p).behavior).toBe('allow');
    expect(store.data.settings.alwaysAllow).toContain(pattern);
  });

  it('asks before editing outside the worktree', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('Write', { file_path: '/etc/outside.txt' });
    await until(() => s.ask);
    expect(s.ask!.head).toMatch(/outside/);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'approve' });
    expect((await p).behavior).toBe('allow');
  });

  it('relays questions and a plan for approval', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    let p = ask('AskUserQuestion', { questions: [{ question: 'Which db?', options: [{ label: 'pg', description: 'Postgres' }] }] });
    await until(() => s.ask);
    expect(s.ask!.head).toBe('Which db?');
    await sm.resolveAsk(id, s.ask!.id, { answers: { 'Which db?': 'pg' } });
    expect(await p).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which db?': 'pg' } } });
    p = ask('ExitPlanMode', { plan: 'Do A then B' });
    await until(() => s.ask);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'approve' });
    expect((await p).behavior).toBe('allow');
    expect(s.permMode).toBe('edits');
    expect(q().setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('treats a typed reply as the answer to a question or a denial', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    let p = ask('AskUserQuestion', { questions: [{ question: 'Name?' }] });
    await until(() => s.ask);
    await sm.send(id, 'Bob');
    expect(await p).toMatchObject({ updatedInput: { answers: { 'Name?': 'Bob' } } });
    p = ask('Bash', { command: 'rm x' });
    await until(() => s.ask);
    await sm.send(id, 'use trash instead');
    expect((await p).message).toContain('use trash instead');
  });

  it('denies what is waiting when the session stops', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('Bash', { command: 'rm x' });
    await until(() => s.ask);
    await sm.stop(id);
    expect(await p).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(s.status).toBe('idle');
  });
});

describe('budgets and plan limits', () => {
  it('pauses at the session budget and resumes when raised', async () => {
    const id = await sm.create(input({ budget: 0.01 }));
    const s = sm.get(id)!;
    q().emit(text('x', { input_tokens: 1_000_000, output_tokens: 0 }));
    await until(() => s.ask);
    expect(s.ask!.type).toBe('budget');
    expect(q().interrupt).toHaveBeenCalled();
    q().emit(done({ total_cost_usd: 3 }));
    await sm.resolveAsk(id, s.ask!.id, { addBudget: 10 });
    expect(s.budget).toBeCloseTo(10.01);
    expect(s.status).toBe('working');
    await until(() => q().received.some((m: any) => /spending limit/.test(String(m.message.content))));
  });

  it('pauses at the weekly cap of a repository', async () => {
    store.data.repos[0].cap = 0.001;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(text('x', { input_tokens: 10000, output_tokens: 0 }));
    await until(() => s.ask);
    expect(s.ask!.scope).toBe('repo');
    await sm.resolveAsk(id, s.ask!.id, { addBudget: 50 });
    expect(store.data.repos[0].cap).toBe(50.001);
  });

  it('pauses when a plan window passes the limit, and carries on when told to', async () => {
    store.data.settings.billing = 'subscription';
    store.data.settings.planPause5h = 80;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    q().emit({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.9, resetsAt } } } });
    await until(() => s.ask);
    expect(s.ask!.scope).toBe('plan');
    expect(store.data.plan.fiveHour).toEqual({ util: 0.9, resetsAt });
    await sm.resolveAsk(id, s.ask!.id, {});
    expect(s.status).toBe('working');
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
  });

  it('ignores empty rate limit info and a plan limit that is off', async () => {
    store.data.settings.billing = 'subscription';
    await sm.create(input());
    q().emit({ type: 'rate_limit_event' });
    q().emit({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.5, resetsAt: 5 } });
    await until(() => store.data.plan.weekly);
    await sm.enforcePlan();
  });
});

describe('controls', () => {
  it('sends a message to a running agent, or restarts a stopped one', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.agentNote = 'Note A';
    await sm.send(id, 'also do B');
    await until(() => q().received.length === 2);
    expect(q().received[1].message.content).toBe('Note A\n\nalso do B');
    await sm.stop(id);
    const before = fake.state.queries.length;
    await sm.send(id, 'continue', [{ mediaType: 'image/png', data: 'AA' } as any]);
    expect(fake.state.queries.length).toBe(before + 1);
    await until(() => q().received.length === 1);
    expect(q().received[0].message.content[0].type).toBe('image');
    await expect(sm.send('nope', 'x')).rejects.toThrow(/not found/);
    s.worktreeGone = true;
    await expect(sm.send(id, 'x')).rejects.toThrow(/worktree removed/);
  });

  it('interrupts, and shows the session as paused after the result', async () => {
    const id = await sm.create(input());
    await sm.interrupt(id);
    expect(q().interrupt).toHaveBeenCalled();
    q().emit(done());
    await until(() => sm.get(id)!.step.startsWith('Paused'));
    await sm.interrupt('nope');
  });

  it('changes model, effort and permission mode, live and for later', async () => {
    const id = await sm.create(input());
    await sm.setModel(id, 'opus');
    expect(q().setModel).toHaveBeenCalledWith('opus');
    await sm.setEffort(id, 'high');
    expect(sm.get(id)!.effort).toBe('high');
    await sm.setEffort(id, null);
    expect(sm.get(id)!.effort).toBeUndefined();
    await sm.setPermMode(id, 'all');
    expect(q().setPermissionMode).toHaveBeenCalledWith('bypassPermissions');
    await sm.setModel('nope', 'opus');
  });

  it('tells a running agent when you edit a file', async () => {
    const id = await sm.create(input());
    await sm.userEdited(id, 'a.txt');
    await until(() => q().received.some((m: any) => /edited a\.txt/.test(String(m.message.content))));
  });

  it('halts every agent and resumes the paused ones', async () => {
    const id = await sm.create(input());
    expect(await sm.haltAll()).toBe(1);
    q().emit(done());
    await until(() => sm.get(id)!.step.startsWith('Paused'));
    q().end();
    await until(() => !sm.isRunning(id));
    expect(await sm.resumeAll()).toBe(1);
    expect(sm.isRunning(id)).toBe(true);
  });

  it('renames, and keeps Claude Code\'s name in step', async () => {
    const id = await sm.create(input());
    sm.get(id)!.agentSessionId = 'c1';
    await sm.rename(id, '  My name ');
    expect(sm.get(id)!.customTitle).toBe('My name');
    expect(fake.state.renamed[0][0]).toBe('c1');
    await sm.rename(id, '');
    expect(sm.get(id)!.customTitle).toBeUndefined();
  });

  it('names the branch after Claude\'s title', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.agentSessionId = 'c1';
    fake.state.info = { summary: 'Repair cart totals', firstPrompt: 'Fix the thing' };
    q().emit(done());
    await until(() => s.branch === 'agent/repair-cart-totals');
    expect(s.title).toBe('Repair cart totals');
  });
});

describe('archive, cleanup and recovery', () => {
  it('archives and restores, but not while running', async () => {
    const id = await sm.create(input());
    expect(() => sm.archive(id, true)).toThrow(/Stop the session/);
    await sm.stop(id);
    sm.archive(id, true);
    expect(sm.get(id)!.archivedAt).toBeTruthy();
    sm.archive(id, false);
    expect(sm.get(id)!.archivedAt).toBeUndefined();
    sm.touchAccess(id);
    sm.archive('nope', true);
  });

  it('archives idle sessions after the set days, leaving unreviewed work alone', async () => {
    const a = await sm.create(input({ task: 'Old idle' }));
    const b = await sm.create(input({ task: 'Old ready' }));
    await sm.stop(a); await sm.stop(b);
    const old = Date.now() - 30 * 86_400_000;
    sm.get(a)!.lastAccess = old;
    sm.get(b)!.lastAccess = old; sm.get(b)!.status = 'ready';
    store.data.settings.archiveAfterDays = 14;
    sm.autoArchive();
    expect(sm.get(a)!.archivedAuto).toBe(true);
    expect(sm.get(b)!.archivedAt).toBeUndefined();
    store.data.settings.archiveAfterDays = 0;
    sm.autoArchive();
  });

  it('marks sessions that were working when helm closed, and resumes them', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    sm.shutdown();
    const sm2 = new SessionManager(store, hooks);
    s.subagents.push({ id: 'x', status: 'working' } as any);
    sm2.recover();
    expect(s.status).toBe('idle');
    expect(s.step).toBe('Stopped when helm closed');
    expect(s.subagents[0].status).toBe('stopped');
    await sm2.resumeInterrupted();
    expect(sm2.isRunning(id)).toBe(true);
    await sm2.stopAll();
  });

  it('answers a question that was pending when helm closed by starting again with the answer', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = q().options.canUseTool('Bash', { command: 'rm x' }, {});
    await until(() => s.ask);
    const askId = s.ask!.id;
    sm.shutdown();
    void p;
    const sm2 = new SessionManager(store, hooks);
    sm2.recover();
    expect(s.ask!.orphaned).toBe(true);
    await sm2.resolveAsk(id, askId, { decision: 'approve' });
    expect(s.preApproved).toEqual(['rm x']);
    await until(() => q().received.some((m: any) => /go ahead and run it now: rm x/.test(String(m.message.content))));
    await sm2.stopAll();
    await sm2.resolveAsk(id, 'stale', {});
    expect(s.ask).toBeUndefined();
  });

  it('describes what deleting would lose, then deletes with worktree and branch', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    writeFileSync(join(s.worktree, 'dirty.txt'), 'x');
    const info = await sm.deleteInfo(id);
    expect(info).toMatchObject({ branch: s.branch, worktreeExists: true, dirty: 1, pushed: false, running: false });
    await sm.remove(id, { worktree: true, branch: true });
    expect(sm.get(id)).toBeUndefined();
    expect(existsSync(s.worktree)).toBe(false);
    await expect(sm.deleteInfo(id)).rejects.toThrow();
    await sm.remove('nope', { worktree: true, branch: true });
  });

  it('deletes a free agent\'s scratch folder but never your own', async () => {
    const id = await sm.create(input({ repoId: FREE_ID, task: 'Scratch' }));
    const wt = sm.get(id)!.worktree;
    expect(await sm.deleteInfo(id)).toMatchObject({ free: 'scratch', worktreeExists: true });
    await sm.remove(id, { worktree: true, branch: false });
    expect(existsSync(wt)).toBe(false);
    const own = join(root, 'keep' + n);
    mkdirSync(own);
    const id2 = await sm.create(input({ repoId: FREE_ID, task: 'Mine', folder: own }));
    expect((await sm.deleteInfo(id2)).free).toBe('folder');
    await sm.remove(id2, { worktree: true, branch: false });
    expect(existsSync(own)).toBe(true);
  });

  it('cleans up after a merge: archives, or deletes, as the setting says', async () => {
    const a = await sm.create(input({ task: 'Merged one' }));
    const s = sm.get(a)!;
    await sm.finishMerged(a, { into: 'main' }, { worktree: true, branch: true });
    expect(s.worktreeGone).toBe(true);
    expect(s.mergedInto).toBe('main');
    expect(s.archivedAt).toBeTruthy();
    expect(await sm.checkpoints(a)).toEqual([]);
    store.data.settings.afterMerge = 'delete';
    const b = await sm.create(input({ task: 'Merged two' }));
    await sm.finishMerged(b, { into: 'main' }, { worktree: true, branch: false });
    expect(sm.get(b)).toBeUndefined();
  });
});

describe('checkpoints and review', () => {
  it('restores the worktree to an earlier checkpoint', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    writeFileSync(join(s.worktree, 'a.txt'), 'changed\n');
    await sm.snapshot(id, 'before restore');
    const cps = await sm.checkpoints(id);
    expect(cps.length).toBeGreaterThanOrEqual(2);
    await expect(sm.restoreTo(id, 99)).rejects.toThrow(/no longer exists/);
    await sm.restoreTo(id, 1);
    expect(s.agentNote).toMatch(/restored your worktree/);
    await expect(sm.restoreTo('nope', 1)).rejects.toThrow();
  });

  it('refuses to restore while the agent works', async () => {
    const id = await sm.create(input());
    await expect(sm.restoreTo(id, 1)).rejects.toThrow(/Stop the session/);
  });

  it('runs a self review and records its findings, or its failure', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    const before = fake.state.queries.length;
    await sm.review(id);
    expect(s.review!.state).toBe('running');
    await sm.review(id);
    expect(fake.state.queries.length).toBe(before + 1);
    q().emit(done({ structured_output: { summary: 'Looks fine', findings: [{ severity: 'blocker', title: 'Bug', file: 'a.txt', detail: 'x' }] }, total_cost_usd: 0.2 }));
    q().end();
    await until(() => s.review!.state === 'done');
    expect(s.review!.summary).toBe('Looks fine');
    await sm.review(id);
    q().emit(done({ is_error: true, result: 'boom' }));
    q().end();
    await until(() => s.review!.state === 'failed');
    expect(s.review!.summary).toBe('boom');
    await expect(sm.review('nope')).rejects.toThrow();
    sm.setReviewed(id, ['a', 'b'], true);
    sm.setReviewed(id, ['a'], false);
    expect(s.reviewed).toEqual(['b']);
  });

  it('will not review a free agent', async () => {
    const id = await sm.create(input({ repoId: FREE_ID, task: 'Free one' }));
    await expect(sm.review(id)).rejects.toThrow(/free agent/);
  });
});

describe('forking and continuing', () => {
  it('forks a session from one of its messages into a new worktree', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    await expect(sm.fork(id, null, '  ')).rejects.toThrow(/Say what/);
    await expect(sm.fork(id, 5, 'try again')).rejects.toThrow(/Pick one of your messages/);
    const forked = await sm.fork(id, 0, 'try again');
    expect(sm.get(forked)!.parentId).toBe(id);
    expect(existsSync(sm.get(forked)!.worktree)).toBe(true);
    await expect(sm.fork('nope', null, 'x')).rejects.toThrow();
    void s;
  });

  it('will not fork a free agent', async () => {
    const id = await sm.create(input({ repoId: FREE_ID, task: 'Free two' }));
    await expect(sm.fork(id, null, 'x')).rejects.toThrow(/Free agents/);
  });

  it('continues a Claude Code session started outside helm', async () => {
    await expect(sm.continueExternal('x/y', 'e1', 'go')).rejects.toThrow(/not found/);
    await expect(sm.continueExternal('o/r', 'e1', ' ')).rejects.toThrow(/Say what/);
    await expect(sm.continueExternal('o/r', 'e1', 'go')).rejects.toThrow(/could not be found/);
    fake.state.info = { fileSize: 400 * 1024 * 1024 };
    await expect(sm.continueExternal('o/r', 'e1', 'go')).rejects.toThrow(/300 MB/);
  });
});
