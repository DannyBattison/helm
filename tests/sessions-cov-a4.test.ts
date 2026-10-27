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
  const state = { queries: [] as FakeQuery[], info: null as any, subMsgs: [] as any[], renamed: [] as any[], msgs: [] as any[], forkResult: null as any, forkArgs: [] as any[] };
  return { FakeQuery, state };
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
  fake.state.queries.length = 0; fake.state.msgs = []; fake.state.forkResult = null; fake.state.forkArgs = []; fake.state.info = null; fake.state.subMsgs = []; fake.state.renamed = [];
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

describe('small helpers through convertMessages', () => {
  const asst = (...content: any[]) => ({ type: 'assistant', message: { content } });
  it('keeps paths outside the worktree whole, understands Windows paths, and shortens long targets', () => {
    const ev = sm.convertMessages([asst(
      { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/elsewhere/x.ts', old_string: 'a', new_string: 'b' } },
      { type: 'tool_use', id: 'e3', name: 'Edit', input: { file_path: 'rel/y.ts' } }
    )], '/w') as any[];
    expect(ev.map((e) => e.file)).toEqual(['/elsewhere/x.ts', 'rel/y.ts']);
    const win = sm.convertMessages([asst({ type: 'tool_use', id: 'e', name: 'Edit', input: { file_path: 'C:\\proj\\src\\a.ts', old_string: 'a', new_string: 'b' } })], 'C:\\proj') as any[];
    expect(win[0].file).toBe('src/a.ts');
    const long = sm.convertMessages([asst({ type: 'tool_use', id: 't', name: 'WebFetch', input: { url: 'http://x/' + 'a'.repeat(300) } })], '/w') as any[];
    expect(long[0].items[0][1]).toHaveLength(140);
    expect(long[0].items[0][1].endsWith('…')).toBe(true);
  });

  it('handles tool results without text, and non-string content', () => {
    const ev = sm.convertMessages([
      asst({ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a' } }),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r', content: null }] } }
    ], '/w') as any[];
    expect(ev[0].items[0][2]).toBe('1 lines');
  });
});

describe('recovering after helm was closed', () => {
  it('stops what was running, remembers what to resume, and keeps a pending question', async () => {
    const a = await sm.create(input({ task: 'A' }));
    const b = await sm.create(input({ task: 'B' }));
    const c = await sm.create(input({ task: 'C' }));
    sm.shutdown();
    const sa = sm.get(a)!, sb = sm.get(b)!, sc = sm.get(c)!;
    sa.subagents = [{ id: 'x', status: 'working', startedAt: 1 } as any, { id: 'y', status: 'working', startedAt: 1, endedAt: 5 } as any];
    sb.status = 'attention'; sb.ask = { id: 'q1' } as any;
    sc.status = 'attention';
    const sm2 = new SessionManager(store, hooks);
    sm2.recover();
    expect(sa.status).toBe('idle');
    expect(sa.step).toBe('Stopped when helm closed');
    expect(sa.subagents.map((x) => [x.status, x.endedAt !== undefined])).toEqual([['stopped', true], ['stopped', true]]);
    expect(sa.subagents[1].endedAt).toBe(5);
    expect(sb.status).toBe('attention');
    expect(sb.ask!.orphaned).toBe(true);
    expect(sc.status).toBe('idle');
    expect(sc.timeline.at(-1)!.status).toBe('idle');
  });

  it('gives a session with no subagent list an empty one', async () => {
    const id = await sm.create(input());
    sm.shutdown();
    delete (sm.get(id) as any).subagents;
    new SessionManager(store, hooks).recover();
    expect(sm.get(id)!.subagents).toEqual([]);
  });
});

describe('restoring while attention is pending, and without a safety checkpoint', () => {
  it('refuses while the agent waits on a question', async () => {
    const id = await sm.create(input());
    sm.get(id)!.status = 'attention';
    await expect(sm.restoreTo(id, 1)).rejects.toThrow(/Stop the session first/);
  });

  it('restores without mentioning a safety checkpoint when none could be made', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    s.checkpoints = 1;
    // Make taking the next checkpoint fail by removing the helm checkpoint repo location it writes to.
    const orig = (sm as any).checkpoint;
    (sm as any).checkpoint = async () => undefined;
    try { await sm.restoreTo(id, 1); } finally { (sm as any).checkpoint = orig; }
    const last = (await transcript(id)).at(-1) as any;
    expect(last.text).toMatch(/^Restored the worktree to checkpoint 1 \(.*\)\.$/);
  });
});

describe('fork and continue defaults', () => {
  it('forks the whole session when no message is picked', async () => {
    const id = await sm.create(input());
    await sm.stop(id);
    const f = sm.get(await sm.fork(id, null, 'whole'))!;
    expect(f.base).toBe(sm.get(id)!.branch);
    expect(f.parentId).toBe(id);
  });

  it('forks a conversation from the start of a message that is the second of two identical ones', async () => {
    const id = await sm.create(input(), { conversation: async () => 'dup' });
    await sm.stop(id);
    const t = await store.transcript(id);
    t.push({ k: 'user', t: 1, text: 'Fix the thing' } as any);
    fake.state.msgs = [
      { type: 'user', uuid: 'u0', message: { content: 'Fix the thing' } },
      { type: 'assistant', uuid: 'a0' },
      { type: 'user', uuid: 'u1', message: { content: ' Fix the thing ' } }
    ];
    fake.state.forkResult = { sessionId: 'dupcopy' };
    mkdirSync(claudeProjectDir(sm.get(id)!.worktree), { recursive: true });
    writeFileSync(join(claudeProjectDir(sm.get(id)!.worktree), 'dupcopy.jsonl'), '1');
    await sm.fork(id, 1, 'second');
    expect(fake.state.forkArgs[0][1].upToMessageId).toBe('a0');
  });

  it('names a continued session generically when Claude Code gave it no title', async () => {
    fake.state.info = { cwd: repoPath };
    fake.state.forkResult = { sessionId: 'gen' };
    mkdirSync(claudeProjectDir(repoPath), { recursive: true });
    writeFileSync(join(claudeProjectDir(repoPath), 'gen.jsonl'), 'x');
    await sm.continueExternal('o/r', 'orig', 'go');
    expect(fake.state.forkArgs[0][1].title).toBe('Session (in helm)');
  });
});

describe('usage and subagent defaults', () => {
  it('counts a reply with sparse usage, and gives a subagent its defaults', async () => {
    const id = await sm.create(input({ task: 'Usage' }));
    const s = sm.get(id)!;
    q().emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }], usage: {} } });
    q().emit({ type: 'assistant', message: { usage: { output_tokens: 10 } } });
    await until(() => s.tokens.output === 10);
    expect(s.tokens).toEqual({ input: 0, output: 10, cacheRead: 0 });
    expect(s.ctx).toBe(0);
    q().emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'bg', name: 'Task', input: { run_in_background: true } }] } });
    await until(() => s.subagents.length === 1);
    expect(s.subagents[0]).toMatchObject({ description: 'Subagent', agentType: 'general-purpose', background: true, parentId: null });
    expect((await transcript(`${id}~bg`))[0]).toMatchObject({ k: 'user', text: '', from: id });
    q().emit({ type: 'assistant', parent_tool_use_id: 'bg', message: { content: [], usage: { input_tokens: 3, output_tokens: 4 } } });
    await until(() => s.subagents[0].tokens === 7);
    expect(s.ctx).toBe(0);
  });

  it('prices an unknown model like sonnet', async () => {
    const id = await sm.create(input({ task: 'Odd' }));
    const s = sm.get(id)!;
    s.model = 'mystery' as any;
    q().emit(text('x', { input_tokens: 1_000_000 }));
    await until(() => s.cost > 0);
    expect(s.cost).toBeCloseTo(3, 5);
  });

  it('reports a thrown value that is not an Error', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().fail('plain string' as any);
    await until(() => s.status === 'error');
    expect(s.error).toBe('plain string');
  });
});
