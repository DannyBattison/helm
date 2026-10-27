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

import { claudeProjectDir, SessionManager } from '../src/core/sessions';
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

const mkRepo = (name: string) => {
  const p = join(root, name + n);
  mkdirSync(p);
  g(p, 'init', '-q', '-b', 'main');
  writeFileSync(join(p, 'b.txt'), 'x\n');
  g(p, 'add', '.');
  g(p, 'commit', '-q', '-m', 'init');
  store.data.repos.push({ id: 'o/' + name, owner: 'o', name, private: false, lang: null, defaultBranch: 'main', localPath: p, cap: 0, addedAt: 0 });
  return p;
};

describe('convertMessages', () => {
  const wt = '/w';
  const asst = (...content: any[]) => ({ type: 'assistant', timestamp: '2026-01-02T03:04:05Z', message: { content } });
  const usr = (...content: any[]) => ({ type: 'user', message: { content } });

  it('turns text, commands and results into events, accepting string content and skipping junk', () => {
    const ev = sm.convertMessages([
      { type: 'assistant', message: { content: 'plain' } },
      { type: 'system' },
      asst({ type: 'text', text: '  hello  ' }, { type: 'text', text: '   ' }, { type: 'thinking' }),
      asst({ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'npm test', description: 'run tests' } }, { type: 'tool_use', id: 'b2', name: 'Bash', input: {} }, { type: 'tool_use', id: 'b3', name: 'Bash' }),
      usr({ type: 'tool_result', tool_use_id: 'b1', content: 'a\n\nlast line\n' }, { type: 'tool_result', tool_use_id: 'b2', content: '  \n' }, { type: 'tool_result', tool_use_id: 'b3', content: [{ text: 'boom' }, {}], is_error: true }, { type: 'tool_result', tool_use_id: 'zz', content: 'orphan' }, { type: 'text', text: 'ignored' })
    ], wt);
    expect(ev[0]).toMatchObject({ k: 'agent', text: 'plain', at: undefined });
    expect(ev[1]).toMatchObject({ k: 'agent', text: 'hello', at: Date.parse('2026-01-02T03:04:05Z') });
    expect(ev[2]).toMatchObject({ k: 'bash', cmd: 'npm test', out: 'last line', ok: true, done: true });
    expect(ev[3]).toMatchObject({ k: 'bash', cmd: '', out: '✓', ok: true, done: true });
    expect(ev[4]).toMatchObject({ k: 'bash', out: 'boom', ok: false, done: true });
    expect(ev).toHaveLength(5);
  });

  it('a failed command with no output says failed', () => {
    const ev = sm.convertMessages([asst({ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'x' } }), usr({ type: 'tool_result', tool_use_id: 'b', content: '', is_error: true })], wt);
    expect(ev[0]).toMatchObject({ out: 'failed', ok: false });
  });

  it('shows edits as diffs with line counts, for Edit, MultiEdit, Write and notebooks', () => {
    const ev = sm.convertMessages([asst(
      { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/w/src/a.ts', old_string: 'a\nb', new_string: 'c' } },
      { type: 'tool_use', id: 'e2', name: 'MultiEdit', input: { file_path: '/w/m.ts', edits: [{ old_string: 'x', new_string: '' }, { old_string: '', new_string: 'y\nz' }] } },
      { type: 'tool_use', id: 'e3', name: 'MultiEdit', input: { file_path: '/w/n.ts' } },
      { type: 'tool_use', id: 'e4', name: 'Write', input: { file_path: '/w/w.ts', content: Array.from({ length: 30 }, (_, i) => 'l' + i).join('\n') } },
      { type: 'tool_use', id: 'e5', name: 'Write', input: {} },
      { type: 'tool_use', id: 'e6', name: 'NotebookEdit', input: { notebook_path: '/w/nb.ipynb' } }
    )], wt) as any[];
    expect(ev[0]).toMatchObject({ k: 'edit', file: 'src/a.ts', add: 1, del: 2, lines: [['-', 'a'], ['-', 'b'], ['+', 'c']] });
    expect(ev[1]).toMatchObject({ file: 'm.ts', add: 2, del: 1, lines: [['-', 'x'], ['+', 'y'], ['+', 'z']] });
    expect(ev[2]).toMatchObject({ add: 0, del: 0, lines: [] });
    expect(ev[3].add).toBe(30);
    expect(ev[3].lines).toHaveLength(24);
    expect(ev[4]).toMatchObject({ file: '', add: 1, lines: [['+', '']] });
    expect(ev[5]).toMatchObject({ file: 'nb.ipynb', add: 0, del: 0 });
  });

  it('groups consecutive tool calls and summarises their results', () => {
    const ev = sm.convertMessages([
      asst({ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/w/a.ts' } }, { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'foo' } }, { type: 'tool_use', id: 't3', name: 'Glob', input: { path: '/w' } }, { type: 'tool_use', id: 't4', name: 'WebFetch', input: { url: 'http://x' } }, { type: 'tool_use', id: 't5', name: 'Task', input: { prompt: 'p' } }, { type: 'tool_use', id: 't6', name: 'Other' }),
      usr(
        { type: 'tool_result', tool_use_id: 't1', content: 'a\nb\nc' },
        { type: 'tool_result', tool_use_id: 't2', content: 'one\n' },
        { type: 'tool_result', tool_use_id: 't3', content: 'x\ny\n' },
        { type: 'tool_result', tool_use_id: 't4', content: 'z' },
        { type: 'tool_result', tool_use_id: 't5', content: 'z', is_error: true }
      ),
      asst({ type: 'tool_use', id: 't7', name: 'Read', input: { file_path: '/w/b.ts' } }),
      asst({ type: 'text', text: 'between' }, { type: 'tool_use', id: 't8', name: 'Read', input: { file_path: '/w/c.ts' } })
    ], wt) as any[];
    expect(ev[0].k).toBe('tools');
    expect(ev[0].items.map((i: any) => i.slice(0, 2))).toEqual([['Read', 'a.ts'], ['Grep', 'foo'], ['Glob', ''], ['WebFetch', 'http://x'], ['Task', 'p'], ['Other', ''], ['Read', 'b.ts']]);
    expect(ev[0].items.map((i: any) => i[2])).toEqual(['3 lines', '1 match', '2 matches', '', 'failed', '', '']);
    // the tool results in between do not end the group, but agent text does
    expect(ev[1]).toMatchObject({ k: 'agent', text: 'between' });
    expect(ev[2].items.map((i: any) => i[1])).toEqual(['c.ts']);
  });

  it('keeps user messages only when asked, dropping system-injected ones', () => {
    const msgs = [usr({ type: 'text', text: 'do it' }, { type: 'text', text: 'now' }), usr({ type: 'text', text: '<system-reminder>x' }), usr({ type: 'text', text: '  ' }), { type: 'user', message: { content: '<command-name>/x' } }];
    expect(sm.convertMessages(msgs, wt)).toEqual([]);
    expect(sm.convertMessages(msgs, wt, true)).toEqual([{ k: 'user', t: 0, text: 'do it\nnow' }]);
  });
});
