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

describe('create, further paths', () => {
  it('adds a worktree in each extra repository and tells the agent about them', async () => {
    mkRepo('other');
    const id = await sm.create(input({ extraRepos: ['o/r', 'o/other', 'o/other'] }));
    const s = sm.get(id)!;
    expect(s.extras).toHaveLength(1);
    expect(s.extras![0]).toMatchObject({ repoId: 'o/other', branch: s.branch, base: 'main' });
    expect(existsSync(join(s.extras![0].worktree, 'b.txt'))).toBe(true);
    expect(q().options.additionalDirectories).toEqual([s.extras![0].worktree]);
    expect(q().options.systemPrompt.append).toContain('spans more than one repository');
    expect(q().options.systemPrompt.append).toContain('- o/other:');
  });

  it('removes what it made when an extra repository is unknown', async () => {
    await expect(sm.create(input({ extraRepos: ['nope/none'] }))).rejects.toThrow(/Repository not found: nope\/none/);
    expect(sm.sessions).toHaveLength(0);
    expect(existsSync(join(store.data.settings.worktreeRoot, 'r', 'fix-the-thing'))).toBe(false);
  });

  it('removes the extra worktrees already made when a later step fails', async () => {
    mkRepo('other');
    await expect(sm.create(input({ extraRepos: ['o/other'] }), { claude: async () => { throw new Error('copy failed'); } })).rejects.toThrow('copy failed');
    expect(existsSync(join(store.data.settings.worktreeRoot, 'other', 'fix-the-thing'))).toBe(false);
    expect(existsSync(join(store.data.settings.worktreeRoot, 'r', 'fix-the-thing'))).toBe(false);
  });

  it('bases on a remote-tracking branch, or a branch that only exists on the remote', async () => {
    g(repoPath, 'update-ref', 'refs/remotes/origin/only-remote', 'HEAD');
    const a = await sm.create(input({ task: 'Remote one', base: 'only-remote' }));
    expect(sm.get(a)!.base).toBe('origin/only-remote');
    const b = await sm.create(input({ task: 'Explicit remote', base: 'origin/only-remote' }));
    expect(sm.get(b)!.base).toBe('origin/only-remote');
    const c = await sm.create(input({ task: 'Local one', base: 'main' }));
    expect(sm.get(c)!.base).toBe('main');
  });

  it('resumes the conversation a claude hook returns, and passes the effort, the executable and remote control', async () => {
    store.data.settings.remoteControl = true;
    store.data.settings.claudePath = '/custom/claude';
    const id = await sm.create(input({ effort: 'high' }), { claude: async () => 'sess-9' });
    const o = q().options;
    expect(sm.get(id)!.claudeSessionId).toBe('sess-9');
    expect(o.resume).toBe('sess-9');
    expect(o.effort).toBe('high');
    expect(o.settings).toEqual({ remoteControlAtStartup: true });
    expect(o.pathToClaudeCodeExecutable).toBe('/custom/claude');
    expect(o.additionalDirectories).toBeUndefined();
  });

  it('does not set an executable when none is known, and signs as Claude alone when asked', async () => {
    hooks.claudePath = () => '';
    store.data.settings.commitAuthor = 'sole';
    store.data.settings.autoPush = true;
    store.data.settings.runTests = true;
    const id = await sm.create(input());
    const o = q().options;
    expect(o.pathToClaudeCodeExecutable).toBeUndefined();
    expect(o.settings).toBeUndefined();
    expect(o.env.GIT_AUTHOR_NAME).toBe('Claude');
    expect(o.systemPrompt.append).toContain(`Helm-Session: ${id}`);
    expect(o.systemPrompt.append).toContain('helm pushes your branch');
    expect(o.systemPrompt.append).toContain('run the project');
    expect(o.effort).toBeUndefined();
  });

  it('saves uploaded files outside the worktree, renaming duplicates and stripping paths', async () => {
    const b64 = (t: string) => Buffer.from(t).toString('base64');
    const id = await sm.create(input({ files: [{ name: 'notes.txt', data: b64('1') }, { name: 'notes.txt', data: b64('22') }, { name: 'C:\\dir\\..\\x.md', data: b64('3') }, { name: '..', data: b64('4') }, { name: 'noext', data: b64('5') }, { name: 'noext', data: b64('6') }] as any }));
    const s = sm.get(id)!;
    expect(s.uploads!.files.map((f) => f.name)).toEqual(['notes.txt', 'notes-2.txt', 'x.md', 'file', 'noext', 'noext-2']);
    expect(s.uploads!.files[1].size).toBe(2);
    expect(readFileSync(join(s.uploads!.dir, 'notes-2.txt'), 'utf8')).toBe('22');
    expect(q().options.additionalDirectories).toEqual([s.uploads!.dir]);
    expect(q().options.systemPrompt.append).toContain('uploaded files for this task alone');
    const one = await sm.create(input({ task: 'Single', files: [{ name: 'a.txt', data: b64('1') }] as any }));
    expect(q().options.systemPrompt.append).toContain('uploaded a file for');
    expect(sm.get(one)!.uploads!.files).toHaveLength(1);
  });

  it('refuses too many or too large uploads and leaves nothing behind', async () => {
    const f = (i: number, size = 1) => ({ name: 'f' + i, data: Buffer.alloc(size).toString('base64') });
    await expect(sm.create(input({ files: Array.from({ length: 200 }, (_, i) => f(i)) as any }))).rejects.toThrow(/At most/);
    const real = Buffer.from.bind(Buffer) as any;
    const spy = vi.spyOn(Buffer, 'from').mockImplementation(((v: any, ...a: any[]) => (a[0] === 'base64' && v === 'HUGE' ? { length: 361 * 1024 * 1024 } : real(v, ...a))) as any);
    try { await expect(sm.create(input({ files: [{ name: 'big', data: 'HUGE' }] as any }))).rejects.toThrow(/add up to more than 360 MB/); } finally { spy.mockRestore(); }
    expect(existsSync(join(store.root, 'uploads', 'fix-the-thing'))).toBe(false);
    expect(sm.sessions).toHaveLength(0);
  });

  it('keeps the images of a queued task until it starts', async () => {
    store.data.settings.maxRunning = 1;
    await sm.create(input({ task: 'First' }));
    const img = { mediaType: 'image/png', data: 'AAAA' } as any;
    const b = await sm.create(input({ task: 'Second', images: [img], after: 'first' }));
    expect(sm.get(b)!.queued).toMatchObject({ after: 'first' });
    expect(sm.get(b)!.step).toMatch(/^Queued\./);
    expect((await transcript(b))[0]).toMatchObject({ images: [img] });
    await sm.startNow(b);
    await until(() => q().received.length === 1);
    expect(JSON.stringify(q().received[0])).toContain('AAAA');
    expect(sm.get(b)!.queued).toBeUndefined();
  });
});

describe('the queue', () => {
  it('does not pump while quitting or held, and a session waiting on a merge is reset to the base when released', async () => {
    store.data.settings.maxRunning = 1;
    const a = await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second', after: a }));
    const s = sm.get(b)!;
    // Move the base on; the queued branch has not been touched, so it follows.
    writeFileSync(join(repoPath, 'new.txt'), 'n');
    g(repoPath, 'add', '.'); g(repoPath, 'commit', '-q', '-m', 'more');
    await sm.startNow(b);
    expect(existsSync(join(s.worktree, 'new.txt'))).toBe(true);
    expect(s.status).toBe('working');
    expect(s.timeline.at(-1)!.status).toBe('working');
  });

  it('startNow and dequeue ignore a session that is not queued', async () => {
    const id = await sm.create(input());
    const before = fake.state.queries.length;
    await sm.startNow(id);
    await sm.dequeue(id);
    expect(fake.state.queries).toHaveLength(before);
  });

  it('is a no-op to pump while another pump runs or while shutting down', async () => {
    store.data.settings.maxRunning = 1;
    await sm.create(input({ task: 'First' }));
    const b = await sm.create(input({ task: 'Second' }));
    sm.shutdown();
    await sm.pumpQueue();
    expect(sm.get(b)!.queued).toBeTruthy();
  });
});

describe('checkpoints and restoring', () => {
  it('lists checkpoints, restores one, and notes what happened', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    expect(await sm.checkpoints('nope')).toEqual([]);
    expect((await sm.checkpoints(id)).map((c) => c.n)).toEqual([1]);
    await sm.stop(id);
    writeFileSync(join(s.worktree, 'a.txt'), 'changed\n');
    await sm.snapshot(id, 'Before: tweak');
    await sm.snapshot('nope', 'x');
    expect((await sm.checkpoints(id)).map((c) => c.n)).toEqual([1, 2]);
    s.stuck = { reason: 'x' } as any;
    await sm.restoreTo(id, 1);
    expect(readFileSync(join(s.worktree, 'a.txt'), 'utf8')).toBe('one\n');
    expect(s.agentNote).toContain('restored your worktree');
    expect(s.stuck).toBeUndefined();
    const last = (await transcript(id)).at(-1) as any;
    expect(last.text).toMatch(/Restored the worktree to checkpoint 1 \(.*\)\. Checkpoint 3 holds/);
  });

  it('refuses to restore in the wrong circumstances', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await expect(sm.restoreTo('nope', 1)).rejects.toThrow(/not found/);
    await expect(sm.restoreTo(id, 1)).rejects.toThrow(/Stop the session first/);
    await sm.stop(id);
    await expect(sm.restoreTo(id, 99)).rejects.toThrow(/no longer exists/);
    s.worktreeGone = true;
    await expect(sm.restoreTo(id, 1)).rejects.toThrow(/worktree is gone/);
    expect(await sm.checkpoints(id)).toEqual([]);
    await sm.snapshot(id, 'ignored');
    expect(s.checkpoints).toBe(1);
  });

  it('takes no checkpoint in a folder of the user\'s own', async () => {
    const own = join(root, 'ownfolder');
    mkdirSync(own);
    const id = await sm.create(input({ repoId: FREE_ID, task: 'Mine', folder: own }));
    expect(sm.get(id)!.checkpoints).toBeUndefined();
    expect((await transcript(id))[0].cp).toBeUndefined();
  });

  it('a checkpoint that cannot be taken does not block the message', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    rmSync(s.worktree, { recursive: true, force: true });
    await sm.snapshot(id, 'fails');
    expect(s.checkpoints).toBe(1);
  });
});

describe('forking from a Claude Code conversation', () => {
  const user = (uuid: string, content: any, extra: any = {}) => ({ type: 'user', uuid, message: { content }, ...extra });

  it('copies the conversation up to the message before the picked one', async () => {
    const id = await sm.create(input(), { claude: async () => 'src-1' });
    const s = sm.get(id)!;
    await sm.stop(id);
    await sm.send(id, 'second').catch(() => undefined);
    // Transcript: [0] the task, [1] maybe the second message; add one by hand to be certain.
    const t = await store.transcript(id);
    t.push({ k: 'user', t: 1, text: 'Fix the thing' } as any);
    fake.state.msgs = [
      user('u0', 'Fix the thing'),
      { type: 'assistant', uuid: 'a0', message: { content: [] } },
      user('u1', [{ type: 'tool_result', tool_use_id: 'x', content: 'r' }]),
      user('u2', [{ type: 'text', text: 'Fix' }, { type: 'text', text: 'the thing' }], { parent_tool_use_id: 'sub' }),
      user('u3', [{ type: 'image' }]),
      user('u4', 5),
      user('u5', [{ type: 'text', text: 'Fix the thing' }]),
      { type: 'user', uuid: 'u6' }
    ];
    // The file the SDK "wrote" for the fork, in the source worktree's project folder.
    mkdirSync(claudeProjectDir(s.worktree), { recursive: true });
    fake.state.forkResult = { sessionId: 'copy-1' };
    writeFileSync(join(claudeProjectDir(s.worktree), 'copy-1.jsonl'), '{"a":1}\n');
    const idx = t.length - 1;
    const forked = await sm.fork(id, idx, '  retry  ');
    const f = sm.get(forked)!;
    expect(f.task).toBe('retry');
    expect(fake.state.forkArgs[0][0]).toBe('src-1');
    expect(fake.state.forkArgs[0][1]).toMatchObject({ upToMessageId: 'u4', title: expect.stringContaining('Fork of') });
    expect(f.claudeSessionId).toBe('copy-1');
    expect(readFileSync(join(claudeProjectDir(f.worktree), 'copy-1.jsonl'), 'utf8')).toBe('{"a":1}\n');
  });

  it('forks from the first message with a fresh conversation, and finds the copy in another folder', async () => {
    const id = await sm.create(input(), { claude: async () => 'src-2' });
    await sm.stop(id);
    fake.state.msgs = [user('u0', 'Fix the thing')];
    const forked = await sm.fork(id, 0, 'again');
    expect(fake.state.forkArgs).toHaveLength(0);
    expect(sm.get(forked)!.claudeSessionId).toBeUndefined();

    // The copy sits in a differently named project folder.
    const id2 = await sm.create(input({ task: 'Other task' }), { claude: async () => 'src-3' });
    await sm.stop(id2);
    fake.state.msgs = [{ type: 'assistant', uuid: 'a' }, user('u1', 'Other task')];
    fake.state.forkResult = { sessionId: 'elsewhere' };
    const dir = join(process.env.HOME!, '.claude', 'projects', 'shortened');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'elsewhere.jsonl'), 'moved');
    const f2 = sm.get(await sm.fork(id2, 0, 'branch off'))!;
    expect(fake.state.forkArgs[0][1].upToMessageId).toBe('a');
    expect(readFileSync(join(claudeProjectDir(f2.worktree), 'elsewhere.jsonl'), 'utf8')).toBe('moved');
  });

  it('fails clearly when the message or the copy cannot be found', async () => {
    const id = await sm.create(input(), { claude: async () => 'src-4' });
    await sm.stop(id);
    fake.state.msgs = [user('u0', 'something else')];
    await expect(sm.fork(id, 0, 'x')).rejects.toThrow(/Could not find that message/);
    fake.state.msgs = [{ type: 'assistant', uuid: 'a' }, user('u1', 'Fix the thing')];
    fake.state.forkResult = { sessionId: 'nowhere' };
    await expect(sm.fork(id, 0, 'x')).rejects.toThrow(/could not be found on disk/);
  });

  it('forks from a checkpoint when the message has one, or from the branch when it does not', async () => {
    const id = await sm.create(input());
    await sm.stop(id);
    const withCp = sm.get(await sm.fork(id, 0, 'from cp'))!;
    expect(withCp.base).toBe('main');
    const s = sm.get(id)!;
    const t = await store.transcript(id);
    t.push({ k: 'user', t: 2, text: 'no checkpoint' } as any);
    const noCp = sm.get(await sm.fork(id, 1, 'from branch'))!;
    expect(noCp.base).toBe(s.branch);
    s.worktreeGone = true;
    const gone = sm.get(await sm.fork(id, 1, 'from base'))!;
    expect(gone.base).toBe('main');
    expect(gone.parentId).toBe(id);
  });
});

describe('continuing an outside session', () => {
  it('carries on from the branch it was on when that exists locally, or on the remote, else the default', async () => {
    g(repoPath, 'branch', 'feature');
    g(repoPath, 'update-ref', 'refs/remotes/origin/rem', 'HEAD');
    const mk = async (gitBranch: string | undefined, name: string) => {
      fake.state.info = { fileSize: 1, cwd: repoPath, gitBranch, customTitle: 'T' };
      mkdirSync(join(process.env.HOME!, '.claude', 'projects', 'p' + name), { recursive: true });
      writeFileSync(join(process.env.HOME!, '.claude', 'projects', 'p' + name, 'ext-' + name + '.jsonl'), 'x');
      fake.state.forkResult = { sessionId: 'ext-' + name };
      return sm.get(await sm.continueExternal('o/r', 'orig', 'Continue ' + name))!;
    };
    expect((await mk('feature', 'a')).base).toBe('feature');
    expect((await mk('rem', 'b')).base).toBe('origin/rem');
    expect((await mk('missing', 'c')).base).toBe('main');
    expect((await mk('agent/mine', 'd')).base).toBe('main');
    expect((await mk(undefined, 'e')).base).toBe('main');
    expect(fake.state.forkArgs.at(-1)[1].title).toBe('T (in helm)');
  });

  it('uses the repo folder and a generic title when the session has neither', async () => {
    fake.state.info = { cwd: '', summary: 'Sum' };
    fake.state.forkResult = { sessionId: 'ext-z' };
    mkdirSync(claudeProjectDir(repoPath), { recursive: true });
    writeFileSync(join(claudeProjectDir(repoPath), 'ext-z.jsonl'), 'x');
    await sm.continueExternal('o/r', 'orig', 'go on');
    expect(fake.state.forkArgs[0][1]).toMatchObject({ dir: repoPath, title: 'Sum (in helm)' });
  });
});

describe('groups', () => {
  it('caps a comparison at six variants and stops the others when one is kept', async () => {
    const variants = Array.from({ length: 8 }, () => ({ model: 'haiku' as const }));
    const ids = await sm.createGroup(input({ task: 'Many' }), variants);
    expect(ids).toHaveLength(6);
    const group = sm.get(ids[0])!.group!;
    await sm.keepFromGroup(group, ids[2]);
    expect(ids.filter((i) => sm.get(i)!.archivedAt)).toHaveLength(5);
    expect(sm.isRunning(ids[2])).toBe(true);
    expect(sm.isRunning(ids[0])).toBe(false);
  });
});

describe('self review, further paths', () => {
  const reviewResult = (over: any = {}) => done({ structured_output: { summary: 'Looks fine', findings: [{ severity: 'blocker', text: 't', file: 'a.txt', line: 1 }] }, total_cost_usd: 0.25, ...over });
  const run = async (id: string, fn: (rq: any) => void | Promise<void>) => {
    const s = sm.get(id)!;
    const before = fake.state.queries.length;
    await sm.review(id);
    await until(() => fake.state.queries.length > before);
    const rq = q();
    await fn(rq);
    await until(() => s.review!.state !== 'running');
    return s.review!;
  };

  it('records the findings, the cost, and the read-only options', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    const rev = await run(id, (rq) => { rq.emit({ type: 'assistant' }); rq.emit(reviewResult()); rq.end(); });
    expect(rev.state).toBe('done');
    expect(rev.summary).toBe('Looks fine');
    expect(rev.cost).toBe(0.25);
    expect(rev.head).toMatch(/^[0-9a-f]+$/);
    const o = q().options;
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.disallowedTools).toContain('Write');
    expect(o.pathToClaudeCodeExecutable).toBe('/bin/claude');
    expect(q().close).toHaveBeenCalled();
    expect(s.review!.findings[0].severity).toBe('blocker');
  });

  it('reports a reviewer that stops early, or throws, or answers nonsense', async () => {
    const id = await sm.create(input());
    await sm.stop(id);
    let rev = await run(id, (rq) => { rq.emit(done({ is_error: true, result: 'out of turns', total_cost_usd: 0 })); rq.end(); });
    expect(rev).toMatchObject({ state: 'failed', summary: 'out of turns' });
    rev = await run(id, (rq) => { rq.emit({ type: 'result', subtype: 'error_max_turns', is_error: true }); rq.end(); });
    expect(rev.summary).toBe('error_max_turns');
    rev = await run(id, (rq) => { rq.emit({ type: 'result', is_error: true }); rq.end(); });
    expect(rev.summary).toBe('The reviewer stopped early');
    rev = await run(id, (rq) => rq.fail(new Error('spawn failed')));
    expect(rev.summary).toBe('spawn failed');
    rev = await run(id, (rq) => { rq.emit(done({ result: 'no json here' })); rq.end(); });
    expect(rev).toMatchObject({ state: 'failed', summary: 'The reviewer did not return a usable answer.' });
  });

  it('does not start a second review while one runs, and refuses when the worktree is gone', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    await sm.stop(id);
    await sm.review(id);
    const at = s.review!.at;
    const n0 = fake.state.queries.length;
    await sm.review(id);
    expect(fake.state.queries.length).toBe(n0 + 0 || n0);
    expect(s.review!.at).toBe(at);
    q().end();
    await until(() => s.review!.state !== 'running');
    s.worktreeGone = true;
    await expect(sm.review(id)).rejects.toThrow(/worktree is gone/);
  });

  it('uses the configured executable and tolerates a close that throws', async () => {
    store.data.settings.claudePath = '/my/claude';
    hooks.claudePath = () => '';
    const id = await sm.create(input());
    await sm.stop(id);
    const rev = await run(id, (rq) => { rq.close = vi.fn(() => { throw new Error('closed'); }); rq.emit(reviewResult()); rq.end(); });
    expect(q().options.pathToClaudeCodeExecutable).toBe('/my/claude');
    expect(rev.state).toBe('done');
  });

  it('marks changes as reviewed and unreviewed', async () => {
    const id = await sm.create(input());
    const s = sm.get(id)!;
    sm.setReviewed(id, ['a', 'b'], true);
    sm.setReviewed(id, ['a'], false);
    sm.setReviewed('nope', ['a'], true);
    expect(s.reviewed).toEqual(['b']);
  });
});
