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
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (this.buf.length) return Promise.resolve({ value: this.buf.shift(), done: false });
          if (this.ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise<IteratorResult<any>>((resolve, reject) => this.waiters.push({ resolve, reject }));
        }
      };
    }
  }
  const state = { queries: [] as FakeQuery[], info: null as any, infoThrows: false, renamed: [] as any[] };
  return { FakeQuery, state };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: ({ prompt, options }: any) => { const q = new fake.FakeQuery(prompt, options); fake.state.queries.push(q); return q; },
  getSessionInfo: async () => { if (fake.state.infoThrows) throw new Error('none'); return fake.state.info; },
  getSubagentMessages: async () => [],
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
const result = (id: string, content: any, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const done = (over: any = {}) => ({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.5, ...over });
const transcript = async (id: string) => store.transcript(id);
const priv = () => sm as any;
const rtOf = (id: string) => priv().rt.get(id);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-covb-'));
  oldTmp = process.env.TMPDIR;
  process.env.TMPDIR = join(root, 'tmp');
  mkdirSync(process.env.TMPDIR);
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 800));
  if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  rmSync(root, { recursive: true, force: true });
});

let n = 0;
beforeEach(async () => {
  fake.state.queries.length = 0; fake.state.info = null; fake.state.infoThrows = false; fake.state.renamed = [];
  repoPath = join(root, 'repo' + (n + 1));
  mkdirSync(repoPath);
  g(repoPath, 'init', '-q', '-b', 'main');
  writeFileSync(join(repoPath, 'a.txt'), 'one\n');
  g(repoPath, 'add', '.');
  g(repoPath, 'commit', '-q', '-m', 'init');
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

describe('tool use in the transcript', () => {
  it('shows a long Write as a capped diff and counts its lines', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const content = Array.from({ length: 30 }, (_, i) => 'line' + i).join('\n') + '\n';
    q().emit(tool('Write', { file_path: join(s.worktree, 'new.txt'), content }, 'w1'));
    await until(() => s.editing);
    const ev: any = (await transcript(id)).find((e) => e.k === 'edit');
    expect(ev).toMatchObject({ file: 'new.txt', add: 30, del: 0 });
    expect(ev.lines).toHaveLength(25);
    expect(ev.lines[24]).toEqual([' ', '… 7 more lines']);
    expect(s.step).toBe('Editing new.txt');
  });

  it('counts an empty Write as no added lines', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(tool('Write', { file_path: join(s.worktree, 'empty.txt') }, 'w2'));
    await until(() => s.editing);
    expect((await transcript(id)).find((e) => e.k === 'edit')).toMatchObject({ add: 0, del: 0 });
  });

  it('diffs MultiEdit entries, skipping a side that is empty, and reads a notebook path', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(tool('MultiEdit', { file_path: join(s.worktree, 'a.txt'), edits: [{ old_string: 'one', new_string: 'two\nthree' }, { new_string: 'only new' }, { old_string: 'gone' }] }, 'm1'));
    await until(() => s.editing);
    const ev: any = (await transcript(id)).find((e) => e.k === 'edit');
    expect(ev).toMatchObject({ add: 3, del: 2 });
    expect(ev.lines.map((l: any) => l[0]).join('')).toBe('-++' + '+' + '-');
    q().emit(tool('NotebookEdit', { notebook_path: join(s.worktree, 'n.ipynb') }, 'nb'));
    await until(() => (priv().rt.get(id).toolStart.has('nb')));
    const evs: any[] = (await transcript(id)).filter((e) => e.k === 'edit');
    expect(evs[1]).toMatchObject({ file: 'n.ipynb', add: 0, del: 0 });
    // MultiEdit with no edits at all
    q().emit(tool('MultiEdit', { file_path: join(s.worktree, 'a.txt') }, 'm2'));
    await until(() => rtOf(id).toolStart.has('m2'));
  });

  it('labels a subagent\'s command and edit with the subagent description and counts its tools', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const sub: any = { id: 'sa', description: 'Research', tools: 0 };
    await priv().onToolUse(s, rtOf(id), { id: 'b1', name: 'Bash', input: { command: 'git push origin x' } }, id, sub);
    await priv().onToolUse(s, rtOf(id), { id: 'e1', name: 'Edit', input: { file_path: join(s.worktree, 'a.txt'), old_string: 'one', new_string: 'two' } }, id, sub);
    await priv().onToolUse(s, rtOf(id), { id: 'r1', name: 'Read', input: { file_path: join(s.worktree, 'a.txt') } }, id, sub);
    expect(sub.tools).toBe(3);
    expect(s.step).toBe('Research: Reading a.txt');
    await priv().onToolUse(s, rtOf(id), { id: 'x1', name: 'Mystery', input: {} }, id, sub);
    expect(s.step).toBe('Research: Using Mystery');
    await priv().onToolUse(s, rtOf(id), { id: 'b2', name: 'Bash', input: { command: 'ls' } }, id, sub);
    expect(s.step).toBe('Research: Running ls');
    await priv().onToolUse(s, rtOf(id), { id: 'e2', name: 'Write', input: { file_path: join(s.worktree, 'w.txt'), content: 'x' } }, id, sub);
    expect(s.step).toBe('Research: Editing w.txt');
    // a tool without any input still gets a transcript entry
    await priv().onToolUse(s, rtOf(id), { id: 'n1', name: 'Read' }, id);
    expect(s.step).toBe('Reading ');
  });

  it('classifies git commands as push, git or plain commands', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    for (const [i, cmd] of ['git push origin x', 'git -C /tmp fetch', 'ls && git rebase main', 'echo hi'].entries()) {
      q().emit(tool('Bash', { command: cmd, description: 'd' }, 'c' + i));
    }
    await until(() => rtOf(id).toolStart.has('c3'));
    const kinds = store.data.activity.filter((a: any) => a.sessionId === id && /ran /.test(a.what)).map((a: any) => a.kind);
    expect(kinds.reverse()).toEqual(['push', 'git', 'git', 'bash']);
    expect(s.step).toBe('Running echo hi');
  });

  it('groups consecutive reads in one tools entry and labels them by tool', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(tool('Read', { file_path: join(s.worktree, 'a.txt') }, 't1'));
    q().emit(tool('Grep', { pattern: 'foo' }, 't2'));
    q().emit(tool('Glob', { path: '*.ts' }, 't3'));
    q().emit(tool('WebFetch', { url: 'http://x' }, 't4'));
    q().emit(tool('WebSearch', { query: 'cats' }, 't5'));
    await until(() => rtOf(id).toolStart.has('t5'));
    const tools: any[] = (await transcript(id)).filter((e) => e.k === 'tools');
    expect(tools).toHaveLength(1);
    expect(tools[0].items.map((i: any) => i[0])).toEqual(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);
    expect(tools[0].items[0][1]).toBe('a.txt');
    expect(s.step).toBe('Searching the web for cats');
  });
});

describe('tool results', () => {
  it('summarises Read, Grep and Glob results, and marks an error as failed', async () => {
    const id = await sm.create(input());
    q().emit(tool('Read', { file_path: 'a.txt' }, 'a'));
    q().emit(tool('Grep', { pattern: 'x' }, 'b'));
    q().emit(tool('Glob', { pattern: 'y' }, 'c'));
    q().emit(tool('Grep', { pattern: 'z' }, 'd'));
    q().emit(tool('WebFetch', { url: 'u' }, 'e'));
    await until(() => rtOf(id).toolStart.has('e'));
    q().emit(result('a', 'l1\nl2\nl3'));
    q().emit(result('b', [{ text: 'hit1' }, { type: 'image' }, { text: 'hit2' }]));
    q().emit(result('c', 'one'));
    q().emit(result('d', 'nope', true));
    q().emit(result('e', ''));
    await until(() => !rtOf(id).toolStart.has('e'));
    const items = ((await transcript(id)).find((e) => e.k === 'tools') as any).items.map((i: any) => i[2]);
    expect(items.slice(0, 4)).toEqual(['3 lines', '2 matches', '1 match', 'failed']);
    expect(items[4]).toMatch(/ms$/);
  });

  it('ignores results without a known tool and non-array content', async () => {
    const id = await sm.create(input());
    q().emit({ type: 'user', message: { content: 'plain string' } });
    q().emit({ type: 'user', message: { content: [{ type: 'text', text: 'x' }, { type: 'tool_result', tool_use_id: 'unknown', content: 'x' }] } });
    q().emit(text('still alive'));
    await until(async () => (await transcript(id)).some((e: any) => e.text === 'still alive'));
  });

  it('formats the duration in seconds and minutes', async () => {
    const id = await sm.create(input());
    q().emit(tool('WebFetch', { url: 'u' }, 'sec'));
    q().emit(tool('WebSearch', { query: 'u' }, 'min'));
    await until(() => rtOf(id).toolStart.has('min'));
    rtOf(id).toolStart.get('sec').t = Date.now() - 5500;
    rtOf(id).toolStart.get('min').t = Date.now() - 125_000;
    q().emit(result('sec', 'ok'));
    q().emit(result('min', 'ok'));
    await until(() => !rtOf(id).toolStart.has('min'));
    const items = ((await transcript(id)).find((e) => e.k === 'tools') as any).items.map((i: any) => i[2]);
    expect(items[0]).toMatch(/^5\.\ds$/);
    expect(items[1]).toBe('2m 5s');
  });

  it('reports the last output line of a command, a placeholder for none, and "failed" for an error with no output', async () => {
    const id = await sm.create(input());
    q().emit(tool('Bash', { command: 'a' }, 'k1'));
    q().emit(tool('Bash', { command: 'b' }, 'k2'));
    q().emit(tool('Bash', { command: 'c' }, 'k3'));
    q().emit(tool('Bash', { command: 'd' }, 'k4'));
    await until(() => rtOf(id).toolStart.has('k4'));
    q().emit(result('k1', 'first\n  last line  \n\n'));
    q().emit(result('k2', ''));
    q().emit(result('k3', '', true));
    q().emit(result('k4', 'x'.repeat(30000) + '\nend'));
    await until(() => !rtOf(id).toolStart.has('k4'));
    const outs = (await transcript(id)).filter((e) => e.k === 'bash').map((e: any) => [e.out, e.ok, e.done]);
    expect(outs).toEqual([['last line', true, true], ['✓', true, true], ['failed', false, true], ['end', true, true]]);
  });

  it('records a failed edit without tracking it, and a successful one with its location', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(s.worktree, 'a.txt'), 'x\ny\nmarker here\n');
    q().emit(tool('Edit', { file_path: join(s.worktree, 'a.txt'), old_string: 'y', new_string: 'marker here' }, 'ed1'));
    q().emit(tool('Edit', { file_path: join(s.worktree, 'a.txt'), old_string: 'y', new_string: 'z' }, 'ed2'));
    await until(() => rtOf(id).toolStart.has('ed2'));
    q().emit(result('ed2', 'bad', true));
    await until(() => !rtOf(id).toolStart.has('ed2'));
    expect(s.fileEdits).toBeUndefined();
    q().emit(result('ed1', 'ok'));
    await until(() => s.fileEdits);
    expect(s.fileEdits).toEqual({ 'a.txt': 1 });
    await until(() => s.editing?.line === 3);
    expect(s.tools!.Edit).toEqual({ n: 2, err: 1 });
  });

  it('locates an edit by its content, or at line 1 when there is nothing to find, and shrugs off a missing file', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await priv().locateEdit(s, { file_path: join(s.worktree, 'a.txt'), new_string: 'absent' });
    expect(s.editing).toEqual({ file: 'a.txt', line: 1 });
    await priv().locateEdit(s, { file_path: join(s.worktree, 'a.txt') });
    expect(s.editing).toEqual({ file: 'a.txt', line: 1 });
    s.editing = undefined;
    await priv().locateEdit(s, { file_path: join(s.worktree, 'missing.txt'), new_string: 'x' });
    expect(s.editing).toBeUndefined();
  });

  it('settles a subagent from its tool result, except a background one that finishes by notification', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.subagents.push({ id: 'sa1', description: 'fg', status: 'working', tools: 0 } as any, { id: 'sa2', description: 'bg', status: 'working', background: true, tools: 0 } as any, { id: 'sa3', description: 'err', status: 'working', background: true, tools: 0 } as any);
    const rt = rtOf(id);
    for (const k of ['sa1', 'sa2', 'sa3']) rt.toolStart.set(k, { t: Date.now(), idx: 0, kind: 'subagent', input: {}, tkey: id, name: 'Agent' });
    await priv().onToolResults(s, rt, result('sa1', ' all done '));
    await priv().onToolResults(s, rt, result('sa2', 'started'));
    await priv().onToolResults(s, rt, result('sa3', 'boom', true));
    expect(s.subagents.map((a) => a.status)).toEqual(['done', 'working', 'failed']);
    expect(s.subagents[0].summary).toBe('all done');
    // a result for a subagent that is no longer listed is ignored
    rt.toolStart.set('gone', { t: Date.now(), idx: 0, kind: 'subagent', input: {}, tkey: id, name: 'Agent' });
    await priv().onToolResults(s, rt, result('gone', 'x'));
  });
});

describe('stuck detection and commits', () => {
  it('flags repeated failures of one command once, and clears when it succeeds', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const rt = rtOf(id);
    for (let i = 0; i < 4; i++) priv().trackCommand(s, rt, 'npm test', false);
    expect(s.stuck).toMatch(/npm test/);
    expect(store.data.activity.filter((a: any) => a.kind === 'attention' && /looks stuck/.test(a.what))).toHaveLength(1);
    priv().trackCommand(s, rt, 'npm test', true);
    expect(rt.fails.has('npm test')).toBe(false);
    priv().setStuck(s, undefined);
    priv().setStuck(s, s.stuck);
  });

  it('stops counting new files after 200 but keeps counting known ones', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.fileEdits = Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['f' + i, 1]));
    priv().trackEdit(s, 'extra');
    expect('extra' in s.fileEdits).toBe(false);
    priv().trackEdit(s, 'f0');
    expect(s.fileEdits.f0).toBe(2);
  });

  it('records a commit from a subagent\'s command output and auto-pushes it', async () => {
    const remote = join(root, 'remote' + n + '.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    g(repoPath, 'remote', 'add', 'origin', remote);
    store.data.settings.autoPush = true;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(s.worktree, 'c.txt'), 'c');
    g(s.worktree, 'add', '.'); g(s.worktree, 'commit', '-q', '-m', 'work');
    q().emit(tool('Bash', { command: 'git commit -m work' }, 'gc'));
    await until(() => rtOf(id).toolStart.has('gc'));
    q().emit(result('gc', '[agent/fix-the-thing abc1234] work\n 1 file changed'));
    await until(() => s.commits.length === 1);
    expect(s.commits[0].hash).toBe('abc1234');
    await until(() => store.data.activity.some((a: any) => a.kind === 'push' && a.what === `pushed ${s.branch}`));
    expect(g(remote, 'branch', '--list', s.branch)).toContain(s.branch);
    // output without the commit line records nothing
    await priv().detectCommit(s, 'nothing to commit', id);
    expect(s.commits).toHaveLength(1);
  });
});

describe('pushing', () => {
  it('serialises pushes, bumps the epoch and survives a failed one before it', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const order: string[] = [];
    const e0 = sm.pushEpoch;
    const p1 = sm.serialPush(id, async () => { order.push('1a'); await new Promise((r) => setTimeout(r, 20)); order.push('1b'); throw new Error('x'); });
    const p2 = sm.serialPush(id, async () => { order.push('2'); return 'ok'; });
    await expect(p1).rejects.toThrow('x');
    expect(await p2).toBe('ok');
    expect(order).toEqual(['1a', '1b', '2']);
    expect(sm.pushEpoch).toBe(e0 + 2);
    expect(s.pushedAt).toBeGreaterThan(0);
    await sm.serialPush('unknown', async () => 1);
  });

  it('does not push a free agent or a session without a branch or worktree', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.worktreeGone = true;
    await sm.autoPush(s);
    s.worktreeGone = false; s.branch = '';
    await sm.autoPush(s);
    s.free = { managed: true };
    await sm.autoPush(s);
    expect(store.data.activity.some((a: any) => a.kind === 'push')).toBe(false);
  });

  it('logs a failed push with the first line of the error', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.autoPush(s); // no origin remote
    const ev: any = store.data.activity.find((a: any) => a.kind === 'push');
    expect(ev.ok).toBe(false);
    expect(ev.what).toMatch(/^push of agent\/fix-the-thing failed: /);
  });

  it('pushes extra repositories that have commits and skips those without', async () => {
    const mk = (name: string) => {
      const dir = join(root, name + n);
      const bare = join(root, name + n + '.git');
      mkdirSync(dir);
      g(dir, 'init', '-q', '-b', 'main');
      writeFileSync(join(dir, 'f'), '1');
      g(dir, 'add', '.'); g(dir, 'commit', '-q', '-m', 'i');
      execFileSync('git', ['init', '-q', '--bare', bare]);
      g(dir, 'remote', 'add', 'origin', bare);
      return { dir, bare, base: g(dir, 'rev-parse', 'HEAD').trim() };
    };
    const main = mk('main'), ahead = mk('ahead'), still = mk('still');
    writeFileSync(join(ahead.dir, 'f2'), '2');
    g(ahead.dir, 'add', '.'); g(ahead.dir, 'commit', '-q', '-m', 'more');
    store.data.repos[0].localPath = main.dir;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.extras = [
      { repoId: 'o/ahead', worktree: ahead.dir, branch: 'main', base: ahead.base } as any,
      { repoId: 'o/still', worktree: still.dir, branch: 'main', base: still.base } as any
    ];
    expect(await sm.extraAhead(s.extras[0])).toBe(1);
    expect(await sm.extraAhead(s.extras[1])).toBe(0);
    expect(await sm.extraAhead({ worktree: join(root, 'nonexistent'), base: 'x' } as any)).toBe(0);
    await sm.autoPush(s);
    const what = store.data.activity.map((a: any) => a.what);
    expect(what).toContain('pushed o/ahead main');
    expect(what).not.toContain('pushed o/still main');
    expect(g(ahead.bare, 'branch', '--list', 'main')).toContain('main');
    expect(g(still.bare, 'branch', '--list')).toBe('');
  });
});

describe('stats', () => {
  it('schedules a single stats refresh and picks up the diff', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const id = await sm.create(input());
      const s = sm.get(id)!;
      const rt = rtOf(id);
      writeFileSync(join(s.worktree, 'a.txt'), 'one\ntwo\n');
      priv().scheduleStats(s, rt);
      const timer = rt.statsTimer;
      expect(timer).toBeDefined();
      priv().scheduleStats(s, rt);
      expect(rt.statsTimer).toBe(timer);
      vi.advanceTimersByTime(1600);
      expect(rt.statsTimer).toBeUndefined();
    } finally { vi.useRealTimers(); }
    const s = sm.get('fix-the-thing')!;
    await until(() => s.files === 1);
    expect(s).toMatchObject({ add: 1, del: 0, filesTouched: { 'a.txt': { add: 1, del: 0 } } });
  });

  it('skips sessions with no worktree or a folder helm does not own', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.files = 7;
    s.worktreeGone = true;
    await sm.refreshStats(s);
    expect(s.files).toBe(7);
    s.worktreeGone = false; s.free = { managed: false };
    await sm.refreshStats(s);
    expect(s.files).toBe(7);
    s.free = undefined; s.worktree = join(root, 'nowhere');
    await sm.refreshStats(s);
    expect(s.files).toBe(7);
  });
});

describe('results', () => {
  it('corrects the cost estimate with the SDK total', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(done({ total_cost_usd: 1.25 }));
    await until(() => s.cost === 1.25);
    q().emit(done({ total_cost_usd: 1.25 })); // nothing to correct
    await until(() => s.status === 'idle');
    expect(s.cost).toBe(1.25);
  });

  it('keeps the estimate when the SDK reports a zero total (subscription), and when it reports nothing', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const rt = rtOf(id);
    rt.turnCost = 0.4;
    q().emit(done({ total_cost_usd: 0 }));
    await until(() => rt.baseCost === 0.4);
    expect(rt.turnCost).toBe(0);
    rt.turnCost = 0.2;
    q().emit({ type: 'result', subtype: 'success', is_error: false });
    await until(() => s.status === 'idle');
    expect(rt.turnCost).toBe(0.2);
  });

  it('stays paused after the result when a budget pause is in place', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const rt = rtOf(id);
    rt.budgetPaused = true; rt.interrupted = true;
    s.status = 'attention';
    q().emit(done());
    await until(() => rt.interrupted === false);
    expect(s.status).toBe('attention');
  });

  it('says it was paused when the user interrupted', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.interrupt(id);
    q().emit(done());
    await until(() => s.status === 'idle');
    expect(s.step).toBe('Paused. Reply to continue');
    expect(q().interrupt).toHaveBeenCalled();
  });

  it('shows a failed run as an error and notifies', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(done({ is_error: true, result: 'Rate limited' }));
    await until(() => s.status === 'error');
    expect(s.error).toBe('Rate limited');
    expect(hooks.notify).toHaveBeenCalledWith('failed', `${id} failed`, 'Rate limited', id);
    expect((await transcript(id)).some((e: any) => e.k === 'note' && e.tone === 'error' && e.text === 'Rate limited')).toBe(true);
    q().emit(done({ is_error: true, subtype: 'error_max_turns', result: undefined }));
    await until(() => s.error === 'error_max_turns');
    q().emit(done({ is_error: true, subtype: undefined, result: undefined }));
    await until(() => s.error === 'The run failed');
  });

  it('waits for background subagents instead of finishing', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.subagents.push({ id: 'b1', description: 'Index docs', status: 'working', background: true, tools: 0 } as any);
    q().emit(done());
    await until(() => /Waiting for/.test(s.step));
    expect(s.step).toBe('Waiting for subagent: Index docs');
    s.subagents.push({ id: 'b2', description: 'More', status: 'working', background: true, tools: 0 } as any);
    q().emit(done());
    await until(() => s.step === 'Waiting for 2 subagents');
  });

  it('marks a session with changes as ready for review, singular or plural, and one without as finished', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(s.worktree, 'a.txt'), 'changed\n');
    q().emit(done());
    await until(() => s.status === 'ready');
    expect(s.step).toBe('1 file changed · ready for review');
    expect(hooks.notify).toHaveBeenCalledWith('ready', `${id} is ready for review`, 'o/r · 1 files', id);
    expect(hooks.toast).toHaveBeenCalledWith(expect.objectContaining({ tone: 'ready', sessionId: id, tab: 'changes' }));
    writeFileSync(join(s.worktree, 'b.txt'), 'new\n');
    g(s.worktree, 'add', '-N', 'b.txt');
    s.status = 'working';
    q().emit(done());
    await until(() => s.step === '2 files changed · ready for review');
  });

  it('finishes a clean session as idle, and a free agent is done even with changes', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(done());
    await until(() => s.status === 'idle' && s.step === 'Finished');
    const fid = await sm.create(input({ repoId: FREE_ID, task: 'Scratch it' }));
    const f = sm.get(fid)!;
    f.commits.push({ hash: 'abc1234', at: 1 });
    q().emit(done());
    await until(() => f.status === 'idle' && f.step === 'Finished');
  });

  it('shows the session as working again when output follows a result', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.status = 'idle';
    priv().resumeWorking(s);
    expect(s).toMatchObject({ status: 'working', step: 'Continuing' });
    s.status = 'ready';
    priv().resumeWorking(s, 'Custom step');
    expect(s.step).toBe('Custom step');
    s.status = 'attention';
    priv().resumeWorking(s, 'nope');
    expect(s.status).toBe('attention');
    s.status = 'idle'; s.archivedAt = 1;
    priv().resumeWorking(s, 'nope');
    expect(s.status).toBe('idle');
  });

  it('continues when a subagent hands its result back after the turn ended', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.subagents.push({ id: 'ts', description: 'Dig', status: 'working', tools: 0 } as any);
    s.status = 'idle';
    await priv().onTaskDone(s, rtOf(id), { tool_use_id: 'ts', status: 'completed', summary: '  found it  ' });
    expect(s.subagents[0]).toMatchObject({ status: 'done', summary: 'found it' });
    expect(s.step).toBe('Continuing with the result of Dig');
    s.subagents.push({ id: 'ts2', description: 'Stop', status: 'working', tools: 0 } as any);
    s.status = 'idle';
    await priv().onTaskDone(s, rtOf(id), { tool_use_id: 'ts2', status: 'stopped' });
    expect(s.subagents[1].status).toBe('stopped');
    expect(s.status).toBe('idle');
  });
});

describe('plan limits', () => {
  const sub = () => { store.data.settings.billing = 'subscription'; };

  it('reads utilisation from the window map or from the event itself', async () => {
    sub();
    await sm.create(input());
    q().emit({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.2, resetsAt: 9 } });
    q().emit({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.3, resetsAt: 10 } } } });
    await until(() => store.data.plan.weekly);
    expect(store.data.plan.fiveHour).toEqual({ util: 0.2, resetsAt: 9 });
    expect(store.data.plan.weekly).toEqual({ util: 0.3, resetsAt: 10 });
    q().emit({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: null, resetsAt: 9 } } } });
    q().emit({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.9 } } } });
    q().emit(text('marker'));
    await until(async () => (await transcript('fix-the-thing')).some((e: any) => e.text === 'marker'));
    expect(store.data.plan.fiveHour!.util).toBe(0.2);
  });

  it('does nothing for the API billing mode and for expired windows, and pauses only working sessions without an ask', async () => {
    store.data.settings.planPause5h = 50;
    store.data.settings.planPauseWeek = 50;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.data.plan.fiveHour = { util: 0.9, resetsAt: Math.floor(Date.now() / 1000) + 3600 };
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
    sub();
    store.data.plan.fiveHour = { util: 0.9, resetsAt: Math.floor(Date.now() / 1000) - 10 };
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
    store.data.plan.fiveHour = { util: 0.4, resetsAt: Math.floor(Date.now() / 1000) + 3600 };
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
    store.data.plan.fiveHour = { util: 0.9, resetsAt: Math.floor(Date.now() / 1000) + 3600 };
    s.status = 'idle';
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
    s.status = 'working';
    rtOf(id).budgetPaused = true;
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
  });

  it('words the reset time in minutes or hours, and pauses on the weekly window', async () => {
    sub();
    store.data.settings.planPause5h = 0;
    store.data.settings.planPauseWeek = 60;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.data.plan.weekly = { util: 0.75, resetsAt: Math.floor(Date.now() / 1000) + 3 * 3600 };
    await sm.enforcePlan();
    expect(s.ask!.head).toBe('Paused at 75% of your weekly plan usage');
    expect(s.ask!.note).toContain('resets in 3h');
    expect(s.status).toBe('attention');
    expect(hooks.notify).toHaveBeenCalledWith('attention', `${id} is paused`, s.ask!.head, id);
    // resolving remembers the override, so the same window does not pause it again
    await sm.resolveAsk(id, s.ask!.id, {});
    await sm.enforcePlan();
    expect(s.ask).toBeUndefined();
  });

  it('describes a window that resets soon in minutes', async () => {
    sub();
    store.data.settings.planPauseWeek = 60;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.data.plan.weekly = { util: 0.75, resetsAt: Math.floor(Date.now() / 1000) + 1200 };
    await sm.enforcePlan();
    expect(s.ask!.note).toMatch(/resets in (19|20)m/);
  });

  it('checks the plan rather than a money budget when billing is a subscription', async () => {
    sub();
    store.data.settings.planPause5h = 50;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.data.plan.fiveHour = { util: 0.8, resetsAt: Math.floor(Date.now() / 1000) + 600 };
    await priv().checkBudget(s, rtOf(id));
    expect(s.ask!.scope).toBe('plan');
  });

  it('resolves a plan pause with the default window when none is stored', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const rt = rtOf(id);
    const ask: any = { id: 'pl', type: 'budget', scope: 'plan', at: Date.now(), head: 'h', note: 'n' };
    rt.asks.set('pl', { ask, scope: 'plan', planKey: 'weekly', resolve: () => undefined });
    s.ask = ask; rt.budgetPaused = true;
    await sm.resolveAsk(id, 'pl', {});
    expect(priv().planOverride.weekly).toBeGreaterThan(Date.now() / 1000);
    expect(rt.budgetPaused).toBe(false);
    expect(rt.queue).toBeDefined();
  });
});

describe('budget checks', () => {
  it('does nothing when already paused, within budget, or when asked again while an ask is open', async () => {
    const id = await sm.create(input({ budget: 5 }));
    const s = sm.get(id)!;
    const rt = rtOf(id);
    await priv().checkBudget(s, rt);
    expect(s.ask).toBeUndefined();
    s.cost = 9;
    rt.budgetPaused = true;
    await priv().checkBudget(s, rt);
    expect(s.ask).toBeUndefined();
    rt.budgetPaused = false;
    await priv().checkBudget(s, rt);
    expect(s.ask!.head).toMatch(/session budget/);
    const first = s.ask;
    await priv().checkBudget(s, rt);
    expect(s.ask).toBe(first);
  });

  it('words the repository cap and raises the repository limit when answered', async () => {
    store.data.repos[0].cap = 2;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.addUsage('o/r', 3, 0);
    await priv().checkBudget(s, rtOf(id));
    expect(s.ask!.scope).toBe('repo');
    expect(s.ask!.head).toMatch(/^o\/r reached its .* weekly budget$/);
    await sm.resolveAsk(id, s.ask!.id, {});
    expect(store.data.repos[0].cap).toBe(7);
  });
});

describe('permissions', () => {
  const ask = (name: string, inp: any) => q().options.canUseTool(name, inp, {});

  it('asks about a question, and records the answers on the transcript', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const questions = [{ question: 'Which db?', options: [{ description: 'Postgres' }] }];
    const p = ask('AskUserQuestion', { questions });
    await until(() => s.ask);
    expect(s.ask).toMatchObject({ type: 'question', head: 'Which db?', note: 'Postgres' });
    expect(s.step).toBe('Asked: Which db?');
    await sm.resolveAsk(id, s.ask!.id, { answers: { 'Which db?': 'pg' } });
    expect(await p).toMatchObject({ behavior: 'allow', updatedInput: { answers: { 'Which db?': 'pg' } } });
    expect((await transcript(id)).find((e) => e.k === 'question')).toMatchObject({ answered: 'pg' });
    expect(s.status).toBe('working');
    expect(store.data.audit.some((a: any) => a.kind === 'question' && a.decision === 'approved')).toBe(true);
  });

  it('copes with a question that has no questions or answers', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('AskUserQuestion', {});
    await until(() => s.ask);
    expect(s.ask).toMatchObject({ head: 'The agent has a question', note: '' });
    await sm.resolveAsk(id, s.ask!.id, {});
    expect(await p).toMatchObject({ behavior: 'allow', updatedInput: { answers: {} } });
  });

  it('asks before an edit outside the worktree, and allows one inside a declared extra worktree', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const extra = join(root, 'extra-wt');
    s.extras = [{ repoId: 'o/x', worktree: extra, branch: 'b', base: 'main' } as any];
    expect((await ask('Write', { file_path: join(extra, 'f.txt') })).behavior).toBe('allow');
    expect((await ask('Write', {})).behavior).toBe('allow');
    const p = ask('NotebookEdit', { notebook_path: '/etc/outside.ipynb' });
    await until(() => s.ask);
    expect(s.ask).toMatchObject({ head: 'Wants to edit a file outside its worktree', command: '/etc/outside.ipynb' });
    expect(s.step).toBe('Wants to run /etc/outside.ipynb');
    await sm.resolveAsk(id, s.ask!.id, { decision: 'approve' });
    expect(await p).toMatchObject({ behavior: 'allow' });
  });

  it('lets any other tool through', async () => {
    await sm.create(input());
    expect(await ask('Read', { file_path: '/etc/hosts' })).toEqual({ behavior: 'allow', updatedInput: { file_path: '/etc/hosts' } });
  });

  it('lets a pre-approved edit through once', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.preApproved = ['Edit:/etc/x', 'other'];
    expect((await ask('Edit', { file_path: '/etc/x' })).behavior).toBe('allow');
    expect(s.preApproved).toEqual(['other']);
  });

  it('shows a plan for approval, and switches to Allow edits when approved', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('ExitPlanMode', { plan: 'Do A then B' });
    await until(() => s.ask);
    expect(s.ask).toMatchObject({ head: 'Plan ready for approval', note: 'Do A then B' });
    expect((await transcript(id)).some((e: any) => e.k === 'agent' && e.text === 'Do A then B')).toBe(true);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'approve' });
    expect((await p).behavior).toBe('allow');
    expect(s.permMode).toBe('edits');
    expect(q().setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('keeps the mode when the plan is denied, even with no plan text', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('ExitPlanMode', {});
    await until(() => s.ask);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'deny' });
    expect((await p).behavior).toBe('deny');
    expect(s.permMode).toBe('ask');
  });

  it('uses the SDK\'s reason for a command prompt and a pattern for always-allow without duplicating it', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = q().options.canUseTool('Bash', { command: 'make deploy', description: 'ship it' }, { decisionReason: 'Because' });
    await until(() => s.ask);
    expect(s.ask!.note).toBe('Because');
    const pattern = s.ask!.pattern!;
    store.data.settings.alwaysAllow = [pattern];
    await sm.resolveAsk(id, s.ask!.id, { decision: 'always' });
    await p;
    expect(store.data.settings.alwaysAllow).toEqual([pattern]);
    expect(store.data.audit.some((a: any) => a.decision === 'always')).toBe(true);
    expect(s.step).toBe('Running');
  });

  it('does not auto-allow a compound command even if it starts with a safe one', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    store.data.settings.alwaysAllow = ['ls*'];
    const p = ask('Bash', { command: 'ls; rm -rf x' });
    await until(() => s.ask);
    await sm.resolveAsk(id, s.ask!.id, { decision: 'deny', text: 'no' });
    expect(await p).toMatchObject({ behavior: 'deny', message: 'The user denied this: no' });
    expect(s.step).toBe('Continuing without it');
  });

  it('replying to a waiting question answers it, and replying to an approval denies it with the text', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = ask('AskUserQuestion', { questions: [{ question: 'Color?' }] });
    await until(() => s.ask);
    await sm.send(id, 'blue');
    expect(await p).toMatchObject({ updatedInput: { answers: { 'Color?': 'blue' } } });
    const p2 = ask('AskUserQuestion', { questions: [{}] });
    await until(() => s.ask);
    await sm.send(id, 'whatever');
    expect(await p2).toMatchObject({ updatedInput: { answers: { answer: 'whatever' } } });
    const p3 = ask('Bash', { command: 'rm y' });
    await until(() => s.ask);
    await sm.send(id, 'please not');
    expect(await p3).toMatchObject({ behavior: 'deny', message: 'The user denied this: please not' });
  });

  it('resolveAsk ignores unknown sessions and an answer for a stale ask on a running session', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.resolveAsk('nope', 'x', {});
    s.ask = { id: 'live', type: 'approve', at: 1, head: 'h' } as any;
    await sm.resolveAsk(id, 'other', {});
    expect(s.ask).toBeUndefined();
  });

  it('default-denies a budget answer with no amount to add five dollars', async () => {
    const id = await sm.create(input({ budget: 1 }));
    const s = sm.get(id)!;
    q().emit(text('x', { input_tokens: 1_000_000, output_tokens: 0 }));
    await until(() => s.ask);
    await sm.resolveAsk(id, s.ask!.id, { addBudget: 'abc' });
    expect(s.budget).toBe(6);
  });
});

describe('answers that arrive after helm restarted', () => {
  const orphan = async (ask: any, answer: any, prep?: (s: any) => void) => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    prep?.(s);
    s.ask = { id: 'o1', at: Date.now(), head: 'Head', ...ask };
    const before = fake.state.queries.length;
    await sm.resolveAsk(id, 'o1', answer);
    await until(() => fake.state.queries.length === before + 1);
    return { id, s, sent: async () => { await until(() => q().received.length >= 1); return String(q().received[0].message.content); } };
  };

  it('clears an ask that does not match', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    await sm.resolveAsk(id, 'zzz', {});
    s.ask = { id: 'a', type: 'approve', at: 1, head: 'h' } as any;
    await sm.resolveAsk(id, 'b', {});
    expect(s.ask).toBeUndefined();
    expect(sm.isRunning(id)).toBe(false);
  });

  it('continues a plan-limit pause, overriding both windows', async () => {
    store.data.plan.fiveHour = { util: 0.9, resetsAt: 111 };
    store.data.plan.weekly = { util: 0.9, resetsAt: 222 };
    const r = await orphan({ type: 'budget', scope: 'plan' }, {});
    expect(priv().planOverride).toEqual({ fiveHour: 111, weekly: 222 });
    expect(await r.sent()).toMatch(/plan usage limit/);
    expect(r.s.ask).toBeUndefined();
    expect((await transcript(r.id)).some((e: any) => /helm was restarted while this waited/.test(e.text || ''))).toBe(true);
  });

  it('continues a plan-limit pause when no window is stored', async () => {
    store.data.plan.fiveHour = undefined as any;
    store.data.plan.weekly = undefined as any;
    const r = await orphan({ type: 'budget', scope: 'plan' }, {});
    expect(priv().planOverride).toEqual({});
    expect(await r.sent()).toMatch(/plan usage limit/);
  });

  it('raises a session budget, or the repository cap, and says so', async () => {
    const r = await orphan({ type: 'budget', scope: 'session' }, { addBudget: 3 }, (s) => { s.budget = 1; });
    expect(r.s.budget).toBe(4);
    expect(await r.sent()).toMatch(/spending limit and it has been raised/);
    const r2 = await orphan({ type: 'budget', scope: 'repo' }, {}, () => { store.data.repos[0].cap = 1; });
    expect(store.data.repos[0].cap).toBe(6);
    expect(r2.s.id).toBe(r.s.id.replace(/$/, '') === r2.s.id ? r.s.id : r2.s.id);
  });

  it('passes an answered question back to the agent, quoting it', async () => {
    const r = await orphan({ type: 'question', questions: [{ question: 'Which?' }] }, { answers: { a: 'one', b: 'two' } });
    expect(await r.sent()).toBe('helm was restarted while you waited. The user answered your question "Which?": one, two. Continue.');
  });

  it('handles a question with neither a question text nor answers', async () => {
    const r = await orphan({ type: 'question' }, {});
    expect(await r.sent()).toContain('answered your question "": . Continue.');
  });

  it('marks the question and approval on the transcript when they are there', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = q().options.canUseTool('Bash', { command: 'rm z' }, {});
    await until(() => s.ask);
    const askId = s.ask!.id;
    sm.shutdown();
    void p;
    const sm2 = new SessionManager(store, hooks);
    sm2.recover();
    await sm2.resolveAsk(id, askId, { decision: 'always' });
    const mark: any = (await transcript(id)).find((e) => e.k === 'permission');
    expect(mark.resolved).toBe('always');
    expect(store.data.settings.alwaysAllow).toContain(s.ask?.pattern ?? mark.pattern);
    await sm2.stopAll();
  });

  it('tells the agent a denial, with or without the reason', async () => {
    const r = await orphan({ type: 'approve', command: 'rm -rf x' }, { decision: 'deny', text: 'too risky' });
    expect(await r.sent()).toBe('helm was restarted while you waited for approval to run "rm -rf x". The user denied it: too risky. Do not run it; ask what they would prefer.');
    const r2 = await orphan({ type: 'approve' }, { decision: 'deny' });
    expect(await r2.sent()).toContain('approval to run "Head". The user denied it. Do not run it');
  });

  it('approves a plan by switching to Allow edits', async () => {
    const r = await orphan({ type: 'approve', tool: 'ExitPlanMode' }, { decision: 'approve' });
    expect(r.s.permMode).toBe('edits');
    expect(await r.sent()).toMatch(/approved your plan/);
  });

  it('pre-approves an edit by tool and path, and remembers an always-allow pattern once', async () => {
    store.data.settings.alwaysAllow = [];
    const r = await orphan({ type: 'approve', tool: 'Write', command: '/etc/f', pattern: 'P*' }, { decision: 'always' });
    expect(r.s.preApproved).toEqual(['Write:/etc/f']);
    expect(store.data.settings.alwaysAllow).toEqual(['P*']);
    const r2 = await orphan({ type: 'approve', tool: 'Bash', command: 'make', pattern: 'P*' }, { decision: 'always' });
    expect(r2.s.preApproved).toEqual(['make']);
    expect(store.data.settings.alwaysAllow).toEqual(['P*']);
  });
});

describe('copying untracked files', () => {
  it('copies files matching the patterns, skipping comments and missing ones', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    writeFileSync(join(repoPath, '.local'), 'x');
    mkdirSync(join(repoPath, 'cfg'));
    writeFileSync(join(repoPath, 'cfg', 'k.json'), '{}');
    await priv().copyUntracked(repoPath, s.worktree, '# only a comment\n\n');
    expect(existsSync(join(s.worktree, '.local'))).toBe(false);
    await priv().copyUntracked(repoPath, s.worktree, '# c\r\n.local\r\ncfg/\r\n');
    expect(existsSync(join(s.worktree, '.local'))).toBe(true);
    expect(existsSync(join(s.worktree, 'cfg', 'k.json'))).toBe(true);
    await priv().copyUntracked(join(root, 'not-a-repo'), s.worktree, '.local');
  });
});

describe('controls', () => {
  it('refuses to message a merged or remote-owned session, and brings an archived one back', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    s.worktreeGone = true;
    await expect(sm.send(id, 'hi')).rejects.toThrow(/cannot be continued/);
    s.worktreeGone = false; s.remoteOwner = 'laptop';
    await expect(sm.send(id, 'hi')).rejects.toThrow(/running on laptop/);
    s.remoteOwner = undefined; s.archivedAt = 5; s.archivedAuto = true; s.queued = { at: 1 } as any;
    await expect(sm.send('missing', 'hi')).rejects.toThrow('Session not found');
    await sm.send(id, 'hi');
    expect(s).toMatchObject({ archivedAt: undefined, archivedAuto: undefined, queued: undefined });
    expect(s.step).toBe('Starting');
    await until(() => (priv().rt.has(id)));
  });

  it('stores images on the user message and a running agent gets a "reading" status', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.send(id, 'look', [{ mediaType: 'image/png', data: 'AA' } as any]);
    expect(s.step).toBe('Reading your message');
    expect((await transcript(id)).filter((e: any) => e.k === 'user')[1]).toMatchObject({ text: 'look', images: [{ data: 'AA' }] });
    await sm.send(id, 'plain');
    expect((await transcript(id)).filter((e: any) => e.k === 'user')[2].images).toBeUndefined();
  });

  it('does nothing when interrupting, stopping or configuring an unknown or idle session', async () => {
    await sm.interrupt('nope');
    await sm.stop('nope');
    await sm.setModel('nope', 'opus');
    await sm.setEffort('nope', 'high');
    await sm.setPermMode('nope', 'edits');
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    expect(s.step).toBe('Stopped');
    await sm.interrupt(id);
    await sm.setModel(id, 'opus');
    expect(s.model).toBe('opus');
    await sm.setEffort(id, null);
    expect(s.effort).toBeUndefined();
    await sm.setPermMode(id, 'edits');
    expect(s.permMode).toBe('edits');
  });

  it('applies model, effort and permission mode to the running agent', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.setModel(id, 'opus');
    expect(q().setModel).toHaveBeenCalled();
    await sm.setEffort(id, 'high');
    expect(q().applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'high' });
    expect(s.effort).toBe('high');
    await sm.setPermMode(id, 'edits');
    expect(q().setPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });

  it('shrugs off a running agent that rejects the changes', async () => {
    const id = await sm.create(input());
    q().interrupt.mockRejectedValue(new Error('x'));
    q().setModel.mockRejectedValue(new Error('x'));
    q().applyFlagSettings.mockRejectedValue(new Error('x'));
    q().setPermissionMode.mockRejectedValue(new Error('x'));
    await sm.interrupt(id);
    await sm.setModel(id, 'opus');
    await sm.setEffort(id, 'low');
    await sm.setPermMode(id, 'edits');
    expect(sm.get(id)!.permMode).toBe('edits');
  });

  it('tells the running agent about a user edit, and ignores it otherwise', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.userEdited('nope', 'f');
    s.status = 'idle';
    await sm.userEdited(id, 'a.txt');
    expect(q().received).toHaveLength(1);
    s.status = 'working';
    await sm.userEdited(id, 'a.txt');
    await until(() => q().received.length === 2);
    expect(String(q().received[1].message.content)).toContain('they edited a.txt');
    expect((await transcript(id)).some((e: any) => e.text === 'You edited a.txt. The agent was told.')).toBe(true);
  });

  it('halts every working agent, holds the queue and resumes only those that were paused', async () => {
    const a = await sm.create(input({ task: 'Task A' }));
    const qa = q();
    const b = await sm.create(input({ task: 'Task B' }));
    sm.get(b)!.status = 'idle';
    expect(await sm.haltAll()).toBe(1);
    expect(qa.interrupt).toHaveBeenCalled();
    expect(priv().held).toBe(true);
    const sa = sm.get(a)!;
    await sm.stop(a);
    sa.status = 'idle'; sa.step = 'Paused. Reply to continue';
    const sb = sm.get(b)!;
    sb.step = 'Finished';
    await sm.stop(b);
    sb.status = 'idle';
    expect(await sm.resumeAll()).toBe(1);
    expect(priv().held).toBe(false);
    await until(() => sm.isRunning(a));
    expect(sm.isRunning(b)).toBe(false);
  });

  it('logs when a session cannot be resumed', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    s.status = 'idle'; s.step = 'Stopped when helm closed';
    vi.spyOn(sm, 'send').mockRejectedValueOnce(new Error('boom'));
    expect(await sm.resumeAll()).toBe(1);
    expect(store.data.activity.some((a: any) => a.kind === 'error' && a.what === 'could not resume: boom')).toBe(true);
    // a session that is deleted while it is being resumed is not reported
    s.step = 'Paused. x';
    const before = store.data.activity.length;
    vi.spyOn(sm, 'send').mockImplementationOnce(async (sid: string) => { store.data.sessions = store.data.sessions.filter((x: any) => x.id !== sid); throw new Error('late'); });
    expect(await sm.resumeAll()).toBe(1);
    expect(store.data.activity.length).toBe(before);
    vi.restoreAllMocks();
  });

  it('skips sessions that cannot be resumed after helm closed, and logs a failure to resume', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    s.status = 'idle';
    priv().interruptedByQuit = ['nope', id];
    vi.spyOn(sm, 'send').mockRejectedValueOnce(new Error('cannot'));
    await sm.resumeInterrupted();
    expect(store.data.activity.some((a: any) => a.kind === 'error' && a.what === 'could not resume: cannot')).toBe(true);
    priv().interruptedByQuit = [id];
    s.archivedAt = 1;
    await sm.resumeInterrupted();
    expect(priv().interruptedByQuit).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('titles and branch names', () => {
  const withClaudeId = async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.claudeSessionId = 'claude-1';
    return { id, s };
  };

  it('does nothing without a Claude session, a summary, or with one that echoes the prompt or the current title', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await priv().refreshTitle(s);
    s.claudeSessionId = 'c';
    fake.state.info = null;
    await priv().refreshTitle(s);
    fake.state.info = { summary: '  ', firstPrompt: 'x' };
    await priv().refreshTitle(s);
    fake.state.info = { summary: 'Fix the thing', firstPrompt: ' Fix the thing ' };
    await priv().refreshTitle(s);
    s.title = 'Same';
    fake.state.info = { summary: 'Same' };
    await priv().refreshTitle(s);
    expect(s.title).toBe('Same');
    fake.state.infoThrows = true;
    await priv().refreshTitle(s);
    expect(s.title).toBe('Same');
  });

  it('renames the branch after Claude\'s title', async () => {
    const { s } = await withClaudeId();
    const old = s.branch;
    fake.state.info = { summary: 'Add dark mode', firstPrompt: 'Fix the thing' };
    await priv().refreshTitle(s);
    expect(s.title).toBe('Add dark mode');
    expect(s.branch).toBe('agent/add-dark-mode');
    expect(g(repoPath, 'branch', '--list', 'agent/add-dark-mode')).toContain('agent/add-dark-mode');
    expect(g(repoPath, 'branch', '--list', old).trim()).toBe('');
    expect(store.data.activity.some((a: any) => a.what === 'branch renamed to agent/add-dark-mode')).toBe(true);
  });

  it('numbers the new branch name when it is taken, and leaves the name when it is already right', async () => {
    const { s } = await withClaudeId();
    g(repoPath, 'branch', 'agent/taken');
    g(repoPath, 'branch', 'agent/taken-2');
    await priv().nameBranch(s, 'Taken');
    expect(s.branch).toBe('agent/taken-3');
    s.branchNamed = false;
    await priv().nameBranch(s, 'Taken');
    expect(s.branch).toBe('agent/taken-3');
  });

  it('leaves the branch alone when it is pushed, has a PR, is a free agent, was already renamed or is not ours', async () => {
    const { s } = await withClaudeId();
    const old = s.branch;
    s.branchNamed = true;
    await priv().nameBranch(s, 'New one');
    s.branchNamed = false; s.prUrl = 'http://pr';
    await priv().nameBranch(s, 'New one');
    expect(s.branchNamed).toBe(true);
    s.branchNamed = false; s.prUrl = undefined;
    g(repoPath, 'update-ref', 'refs/remotes/origin/' + old, 'HEAD');
    await priv().nameBranch(s, 'New one');
    expect(s.branch).toBe(old);
    s.branchNamed = false; s.free = { managed: true };
    await priv().nameBranch(s, 'New one');
    expect(s.branchNamed).toBe(false);
    s.free = undefined; s.branch = 'other/x';
    await priv().nameBranch(s, 'New one');
    expect(s.branchNamed).toBe(false);
    s.branch = '';
    await priv().nameBranch(s, 'New one');
    expect(s.branchNamed).toBe(false);
  });

  it('keeps the branch if git cannot rename it', async () => {
    const { s } = await withClaudeId();
    const old = s.branch;
    s.worktree = join(root, 'missing-wt');
    await priv().nameBranch(s, 'Brand new');
    expect(s.branch).toBe(old);
  });

  it('keeps the branch when the title slugs to the same name', async () => {
    const { s } = await withClaudeId();
    await priv().nameBranch(s, 'Fix the thing');
    expect(s.branch).toBe('agent/fix-the-thing');
  });

  it('checks remote branches when looking for a free name', async () => {
    const { s } = await withClaudeId();
    g(repoPath, 'update-ref', 'refs/remotes/origin/agent/remote-only', 'HEAD');
    await priv().nameBranch(s, 'Remote only');
    expect(s.branch).toBe('agent/remote-only-2');
  });
});

describe('renaming, archiving and artifacts', () => {
  it('renames, trims, falls back to Claude\'s name, and syncs with Claude Code', async () => {
    await sm.rename('nope', 'x');
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.rename(id, '  My name  ');
    expect(s.customTitle).toBe('My name');
    expect(fake.state.renamed).toEqual([]);
    s.claudeSessionId = 'c1';
    await sm.rename(id, 'x'.repeat(200));
    expect(s.customTitle).toHaveLength(120);
    expect(fake.state.renamed).toHaveLength(1);
    await sm.rename(id, '   ');
    expect(s.customTitle).toBeUndefined();
    expect(store.data.activity.some((a: any) => a.what === 'went back to Claude\'s name')).toBe(true);
    expect(fake.state.renamed).toHaveLength(1);
  });

  it('archives and restores, refuses while running, and ignores unknown ids', async () => {
    sm.archive('nope', true);
    sm.touchAccess('nope');
    const id = await sm.create(input());
    const s = sm.get(id)!;
    expect(() => sm.archive(id, true)).toThrow(/Stop the session/);
    await sm.stop(id);
    s.status = 'attention';
    expect(() => sm.archive(id, true)).toThrow(/Stop the session/);
    s.status = 'idle';
    s.artifacts = [{ name: 'a', label: 'a', at: 1 }];
    sm.archive(id, true);
    expect(s.archivedAt).toBeGreaterThan(0);
    expect(s.artifacts[0].dismissed).toBe(true);
    s.lastAccess = 1;
    sm.archive(id, false);
    expect(s.archivedAt).toBeUndefined();
    expect(s.lastAccess).toBeGreaterThan(1);
    s.lastAccess = 1;
    sm.touchAccess(id);
    expect(s.lastAccess).toBeGreaterThan(1);
  });

  it('collects artifact links once, decodes names, and keeps a malformed escape as written', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    q().emit(text('See [Report](artifact:my%20report.md) and [](artifact:plain.txt) and [Bad](artifact:100%.txt)'));
    await until(() => s.artifacts?.length === 3);
    expect(s.artifacts!.map((a) => [a.name, a.label])).toEqual([['my report.md', 'Report'], ['plain.txt', 'plain.txt'], ['100%.txt', 'Bad']]);
    q().emit(text('Again [Report](artifact:my%20report.md)'));
    await until(async () => (await transcript(id)).filter((e: any) => e.k === 'agent').length === 2);
    expect(s.artifacts).toHaveLength(3);
  });

  it('dismisses an artifact once, and ignores unknown ones', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.artifacts = [{ name: 'a', label: 'a', at: 1 }];
    await sm.dismissArtifact('nope', 'a');
    await sm.dismissArtifact(id, 'zzz');
    await sm.dismissArtifact(id, 'a');
    expect(s.artifacts[0].dismissed).toBe(true);
    const touches = hooks.emitState.mock.calls.length;
    await sm.dismissArtifact(id, 'a');
    expect(hooks.emitState.mock.calls.length).toBe(touches);
  });

  it('auto-archives only idle sessions nobody opened, and leaves unreviewed finished work', async () => {
    store.data.settings.archiveAfterDays = 7;
    const mk = async (task: string) => { const id = await sm.create(input({ task })); await sm.stop(id); return sm.get(id)!; };
    const old = Date.now() - 30 * 86_400_000;
    const idle = await mk('Idle one'), archived = await mk('Archived'), ready = await mk('Ready'), readyPr = await mk('Ready pr'), recent = await mk('Recent'), asking = await mk('Asking'), working = await mk('Working');
    for (const s of [idle, archived, ready, readyPr, recent, asking, working]) { s.lastAccess = old; s.status = 'idle'; }
    archived.archivedAt = 5;
    ready.status = 'ready';
    readyPr.status = 'ready'; readyPr.prUrl = 'http://pr';
    recent.lastAccess = Date.now();
    asking.ask = { id: 'x' } as any;
    working.status = 'working';
    idle.artifacts = [{ name: 'a', label: 'a', at: 1 }];
    sm.autoArchive();
    expect(idle).toMatchObject({ archivedAuto: true });
    expect(idle.artifacts![0].dismissed).toBe(true);
    expect(readyPr.archivedAt).toBeGreaterThan(0);
    expect(archived.archivedAt).toBe(5);
    for (const s of [ready, recent, asking, working]) expect(s.archivedAt).toBeUndefined();
    // a session with no access time falls back to when it started
    recent.lastAccess = 0; recent.startedAt = old;
    sm.autoArchive();
    expect(recent.archivedAt).toBeGreaterThan(0);
  });
});

describe('deleting and cleaning up', () => {
  it('describes a free scratch folder, a chosen folder and a missing worktree', async () => {
    const fid = await sm.create(input({ repoId: FREE_ID, task: 'Scratch' }));
    const f = sm.get(fid)!;
    await sm.stop(fid);
    writeFileSync(join(f.worktree, 'dirty.txt'), 'x');
    expect(await sm.deleteInfo(fid)).toMatchObject({ free: 'scratch', branch: '', worktreeExists: true, dirty: 1, unpushed: 0, pushed: false, running: false });
    f.free = { managed: false };
    expect(await sm.deleteInfo(fid)).toMatchObject({ free: 'folder', dirty: 0 });
    f.free = { managed: true }; f.worktree = join(root, 'gone-scratch');
    expect(await sm.deleteInfo(fid)).toMatchObject({ free: 'scratch', worktreeExists: false, dirty: 0 });
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    const real = s.worktree;
    s.worktree = join(root, 'gone-wt');
    expect(await sm.deleteInfo(id)).toMatchObject({ worktreeExists: false, dirty: 0, unpushed: 0 });
    s.worktree = real;
  });

  it('counts commits ahead of the base, or of the pushed branch', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    writeFileSync(join(s.worktree, 'n.txt'), 'n');
    g(s.worktree, 'add', '.'); g(s.worktree, 'commit', '-q', '-m', 'one');
    expect(await sm.deleteInfo(id)).toMatchObject({ unpushed: 1, pushed: false });
    g(repoPath, 'update-ref', 'refs/remotes/origin/' + s.branch, 'main');
    expect(await sm.deleteInfo(id)).toMatchObject({ unpushed: 1, pushed: true });
    g(repoPath, 'update-ref', 'refs/remotes/origin/' + s.branch, s.branch);
    expect(await sm.deleteInfo(id)).toMatchObject({ unpushed: 0, pushed: true });
    s.branch = 'no-such-branch';
    expect((await sm.deleteInfo(id)).unpushed).toBe(0);
  });

  it('keeps a merged session as it is, archives it, or deletes it, as the setting says', async () => {
    const mk = async (task: string) => { const id = await sm.create(input({ task })); return sm.get(id)!; };
    await sm.finishMerged('nope', { into: 'main' }, { worktree: true, branch: true });
    store.data.settings.afterMerge = 'keep';
    const keep = await mk('Keep it');
    await sm.finishMerged(keep.id, { into: 'main', at: 1234 }, { worktree: false, branch: false });
    expect(keep).toMatchObject({ mergedInto: 'main', mergedAt: 1234 });
    expect(keep.worktreeGone).toBeUndefined();
    expect(keep.archivedAt).toBeUndefined();
    expect(sm.isRunning(keep.id)).toBe(false);
    store.data.settings.afterMerge = 'archive';
    const arch = await mk('Archive it');
    arch.artifacts = [{ name: 'a', label: 'a', at: 1 }];
    const wt = arch.worktree;
    await sm.finishMerged(arch.id, { into: 'main' }, { worktree: true, branch: false });
    expect(arch.worktreeGone).toBe(true);
    expect(arch.archivedAt).toBeGreaterThan(0);
    expect(arch.artifacts[0].dismissed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(store.data.activity.some((a: any) => a.what === 'cleaned up after the merge: worktree removed')).toBe(true);
    const both = await mk('Both gone');
    await sm.finishMerged(both.id, { into: 'main' }, { worktree: true, branch: true });
    expect(store.data.activity.some((a: any) => a.what === 'cleaned up after the merge: worktree and branch removed')).toBe(true);
    expect(g(repoPath, 'branch', '--list', both.branch).trim()).toBe('');
    store.data.settings.afterMerge = 'delete';
    const del = await mk('Delete it');
    await sm.finishMerged(del.id, { into: 'main' }, { worktree: true, branch: true });
    expect(sm.get(del.id)).toBeUndefined();
  });

  it('removes the extra worktrees too, skipping an extra whose repository is gone', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const other = join(root, 'other-repo' + n);
    mkdirSync(other);
    g(other, 'init', '-q', '-b', 'main');
    writeFileSync(join(other, 'f'), '1');
    g(other, 'add', '.'); g(other, 'commit', '-q', '-m', 'i');
    const xwt = join(root, 'xwt' + n);
    g(other, 'worktree', 'add', '-q', '-b', 'agent/x', xwt);
    store.data.repos.push({ id: 'o/other', owner: 'o', name: 'other', private: false, lang: null, defaultBranch: 'main', localPath: other, cap: 0, addedAt: 0 });
    s.extras = [{ repoId: 'o/other', worktree: xwt, branch: 'agent/x', base: 'main' } as any, { repoId: 'o/ghost', worktree: '/nowhere', branch: 'b', base: 'main' } as any];
    await sm.remove(id, { worktree: true, branch: true });
    expect(existsSync(xwt)).toBe(false);
    expect(g(other, 'branch', '--list', 'agent/x').trim()).toBe('');
  });

  it('deletes a session without touching the worktree when not asked, and a free folder only if it is helm\'s', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.remove(id, { worktree: false, branch: false });
    expect(sm.get(id)).toBeUndefined();
    expect(existsSync(s.worktree)).toBe(true);
    expect(store.data.activity.some((a: any) => a.what === 'deleted')).toBe(true);
    const f1 = sm.get(await sm.create(input({ repoId: FREE_ID, task: 'Free one' })))!;
    await sm.remove(f1.id, { worktree: true, branch: false });
    expect(existsSync(f1.worktree)).toBe(false);
    expect(store.data.activity.some((a: any) => a.what === 'deleted with its worktree')).toBe(true);
    const f2 = sm.get(await sm.create(input({ repoId: FREE_ID, task: 'Free two' })))!;
    f2.free = { managed: false };
    await sm.remove(f2.id, { worktree: true, branch: false });
    expect(existsSync(f2.worktree)).toBe(true);
    const f3 = sm.get(await sm.create(input({ repoId: FREE_ID, task: 'Free three' })))!;
    await sm.remove(f3.id, { worktree: false, branch: false });
    expect(existsSync(f3.worktree)).toBe(true);
  });

  it('removes a session\'s uploads', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const dir = join(root, 'uploads' + n);
    mkdirSync(dir);
    writeFileSync(join(dir, 'u.png'), 'x');
    s.uploads = { dir } as any;
    await sm.remove(id, { worktree: false, branch: false });
    expect(existsSync(dir)).toBe(false);
  });
});

describe('subagent limits', () => {
  it('blocks a subagent when the repository limit is reached and records why', async () => {
    store.data.settings.maxSubagentsSession = 5;
    store.data.settings.maxSubagentsRepo = 1;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const hook = q().options.hooks.PreToolUse[0].hooks[0];
    expect(await hook({ tool_use_id: 'a' })).toEqual({});
    s.subagents.push({ id: 'a', description: 'one', status: 'working', tools: 0 } as any);
    const out = await hook({});
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^o\/r already has 1 subagents running across its sessions, which is the repository limit\./);
    expect((await transcript(id)).some((e: any) => e.k === 'note' && /^Subagent blocked\./.test(e.text))).toBe(true);
    store.data.repos[0].maxSubagents = 3;
    expect(await hook({ tool_use_id: 'z' })).toEqual({});
    expect(sm.repoLimit(s)).toBe(3);
    s.maxSubagents = 2;
    expect(sm.sessionLimit(s)).toBe(2);
  });

  it('words the session limit in the singular and counts only admitted subagents', async () => {
    store.data.settings.maxSubagentsSession = 1;
    const id = await sm.create(input());
    const s = sm.get(id)!;
    s.subagents.push({ id: 'a', description: 'one', status: 'working', tools: 0 } as any, { id: 'b', description: 'two', status: 'done', tools: 0 } as any);
    const hook = q().options.hooks.PreToolUse[0].hooks[0];
    // not admitted through the hook, so not counted against the limit
    expect(await hook({ tool_use_id: 'c' })).toEqual({});
    rtOf(id).admitted.add('a');
    expect((await hook({ tool_use_id: 'd' })).hookSpecificOutput.permissionDecisionReason).toMatch(/already has 1 subagent running/);
    s.subagents.push({ id: 'e', description: 'x', status: 'working', tools: 0 } as any);
    rtOf(id).admitted.add('e');
    expect((await hook({ tool_use_id: 'f' })).hookSpecificOutput.permissionDecisionReason).toMatch(/already has 2 subagents running/);
  });

  it('marks working subagents as stopped, touching only if there were any', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const before = hooks.emitState.mock.calls.length;
    priv().stopSubagents(s);
    expect(hooks.emitState.mock.calls.length).toBe(before);
    s.subagents.push({ id: 'a', status: 'working' } as any, { id: 'b', status: 'done' } as any);
    priv().stopSubagents(s);
    expect(s.subagents.map((a) => a.status)).toEqual(['stopped', 'done']);
    expect(s.subagents[0].endedAt).toBeGreaterThan(0);
  });
});

describe('shutdown', () => {
  it('stopAll ends every agent and leaves their sessions idle', async () => {
    const a = await sm.create(input({ task: 'One' }));
    const b = await sm.create(input({ task: 'Two' }));
    await sm.stopAll();
    expect(sm.isRunning(a) || sm.isRunning(b)).toBe(false);
    expect(sm.get(a)!.step).toBe('Stopped');
  });

  it('stop denies any open ask and rejects pending ones with an interrupt', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    const p = q().options.canUseTool('Bash', { command: 'rm q' }, {});
    await until(() => s.ask);
    await sm.stop(id);
    expect(await p).toMatchObject({ behavior: 'deny', message: 'Session stopped', interrupt: true });
    expect(s.ask).toBeUndefined();
  });
});
