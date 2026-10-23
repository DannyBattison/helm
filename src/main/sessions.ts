import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ActivityEvent, ModelAlias, NewSessionInput, PendingAsk, PermMode, Session, Status, TranscriptEvent } from '../shared/types';
import * as G from './git';
import type { Store } from './store';
import { commandPattern, expandHome, globMatch, uid } from './util';

export interface Hooks {
  emitState(): void;
  emitTranscript(sessionId: string, index: number, event: TranscriptEvent): void;
  toast(t: { tone: 'ready' | 'attention' | 'error' | 'neutral'; title: string; description?: string; sessionId?: string; tab?: string }): void;
  notify(kind: 'attention' | 'ready' | 'failed', title: string, body: string, sessionId: string): void;
  claudePath(): string | undefined;
}

/** Input stream for a streaming-mode query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;
  push(text: string) {
    const m: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    const w = this.waiters.shift();
    if (w) w({ value: m, done: false });
    else this.items.push(m);
  }
  close() {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as any, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const v = this.items.shift();
        if (v) return Promise.resolve({ value: v, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as any, done: true });
        return new Promise((r) => this.waiters.push(r));
      }
    };
  }
}

interface AskWaiter {
  ask: PendingAsk;
  scope: 'session' | 'repo' | 'tool';
  resolve(r: any): void;
  input?: Record<string, unknown>;
  tool?: string;
}

interface Runtime {
  q: Query;
  queue: InputQueue;
  abort: AbortController;
  asks: Map<string, AskWaiter>;
  turnCost: number;
  baseCost: number;
  interrupted: boolean;
  budgetPaused: boolean;
  toolStart: Map<string, { t: number; idx: number; kind: string; input: any }>;
  statsTimer?: NodeJS.Timeout;
  lastTools?: number;
}

// Rough list prices, USD per million tokens. Only used between result messages; the SDK's total replaces it.
const PRICE: Record<string, [number, number]> = { opus: [15, 75], sonnet: [3, 15], haiku: [1, 5] };

const SAFE_CMD = /^(ls|dir|pwd|cat|head|tail|wc|echo|which|where|type|tree|file|stat|date|whoami|git (status|diff|log|show|branch|rev-parse|ls-files|blame|remote -v|config --get)|rg|grep|find(?!.*(-delete|-exec)))(\s|$)/;
const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const rel = (wt: string, p: string) => {
  if (!p) return p;
  const r = isAbsolute(p) ? relative(wt, p) : p;
  return (r.startsWith('..') ? p : r).split(sep).join('/');
};
const inside = (wt: string, p: string) => {
  const r = relative(wt, resolve(wt, p));
  return !r.startsWith('..') && !isAbsolute(r);
};
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 4).join('-') || 'session';

export const MODEL_ALIAS: Record<ModelAlias, string> = { sonnet: 'sonnet', opus: 'opus', haiku: 'haiku' };

export class SessionManager {
  private rt = new Map<string, Runtime>();
  constructor(private store: Store, private hooks: Hooks) {}

  get sessions() { return this.store.data.sessions; }
  get = (id: string) => this.sessions.find((s) => s.id === id);
  repoOf = (s: Session) => this.store.data.repos.find((r) => r.id === s.repoId)!;
  private touch() { this.store.save(); this.hooks.emitState(); }

  /** Called once at startup: nothing is running, so nothing should claim to be. */
  recover() {
    for (const s of this.sessions) {
      if (s.status === 'working' || s.status === 'attention') {
        s.status = 'idle';
        s.step = 'Stopped when helm closed';
        s.ask = undefined;
        s.timeline.push({ t: Date.now(), status: 'idle' });
      }
    }
  }

  // ---------------------------------------------------------------- transcript
  private async push(id: string, ev: TranscriptEvent): Promise<number> {
    const t = await this.store.transcript(id);
    t.push(ev);
    this.store.saveTranscript(id);
    this.hooks.emitTranscript(id, t.length - 1, ev);
    return t.length - 1;
  }
  private async patch(id: string, index: number, ev: TranscriptEvent) {
    const t = await this.store.transcript(id);
    t[index] = ev;
    this.store.saveTranscript(id);
    this.hooks.emitTranscript(id, index, ev);
  }

  private activity(s: Session, kind: ActivityEvent['kind'], what: string) {
    const a = this.store.data.activity;
    a.unshift({ id: uid(), t: Date.now(), kind, who: s.id, what, repo: this.repoOf(s)?.name || '', sessionId: s.id });
    if (a.length > 300) a.length = 300;
  }

  private setStatus(s: Session, status: Status, step?: string) {
    if (s.status !== status) {
      s.status = status;
      s.timeline.push({ t: Date.now(), status });
      if (status === 'ready' || status === 'idle' || status === 'error') s.endedAt = Date.now();
      else s.endedAt = undefined;
    }
    if (step != null) s.step = step;
    this.touch();
  }

  // ---------------------------------------------------------------- create
  async create(input: NewSessionInput): Promise<string> {
    const repo = this.store.data.repos.find((r) => r.id === input.repoId);
    if (!repo) throw new Error('Repository not found');
    const st = this.store.data.settings;
    let id = slug(input.task);
    for (let n = 2; this.sessions.some((s) => s.repoId === repo.id && s.id === id); n++) id = slug(input.task) + '-' + n;
    const branch = st.branchPrefix + id;
    const wt = join(expandHome(st.worktreeRoot), repo.name, id);

    await G.git(repo.localPath, 'fetch', 'origin', '--prune').catch(() => undefined);
    const remoteBase = (await G.gitOk(repo.localPath, 'rev-parse', '--verify', 'origin/' + input.base)) ? 'origin/' + input.base : input.base;
    await G.addWorktree(repo.localPath, wt, branch, remoteBase);
    for (const f of st.copyFiles.split(',').map((x) => x.trim()).filter(Boolean)) {
      const from = join(repo.localPath, f);
      if (await G.fileExists(from)) {
        await mkdir(dirname(join(wt, f)), { recursive: true });
        await copyFile(from, join(wt, f)).catch(() => undefined);
      }
    }

    const now = Date.now();
    const s: Session = {
      id, repoId: repo.id, status: 'working', task: input.task, step: 'Starting', branch, base: remoteBase, worktree: wt,
      model: input.model, permMode: input.permMode, startedAt: now, tokens: { input: 0, output: 0, cacheRead: 0 }, cost: 0, budget: input.budget,
      ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [{ t: now, status: 'working' }], commits: [], removeAfterMerge: st.removeAfterMerge
    };
    this.sessions.push(s);
    this.activity(s, 'start', `started on ${branch}`);
    this.touch();
    await this.push(id, { k: 'user', t: now, text: input.task });
    await this.start(s, input.task);
    return id;
  }

  // ---------------------------------------------------------------- run
  private systemAppend(s: Session): string {
    const st = this.store.data.settings;
    return [
      `You are running inside helm, working in an isolated git worktree on branch ${s.branch} (based on ${s.base}). Stay inside this directory.`,
      `Commit your work in small commits with clear messages. End every commit message with a blank line and this trailer: "Co-authored-by: helm session ${s.id} <noreply@helm.app>".`,
      'Do not push and do not open pull requests; the user does that from helm after reviewing your changes.',
      'If you need a decision from the user, ask with the AskUserQuestion tool instead of guessing.',
      st.runTests ? 'Before you finish, run the project\'s tests (from package.json, go.mod, Makefile or equivalent) when they exist, and state the result.' : ''
    ].filter(Boolean).join('\n');
  }

  private async start(s: Session, first?: string) {
    const abort = new AbortController();
    const queue = new InputQueue();
    const settings = this.store.data.settings;
    const rt: Runtime = { q: null as any, queue, abort, asks: new Map(), turnCost: 0, baseCost: s.cost, interrupted: false, budgetPaused: false, toolStart: new Map() };
    const options: any = {
      cwd: s.worktree,
      model: MODEL_ALIAS[s.model],
      permissionMode: s.permMode === 'plan' ? 'plan' : s.permMode === 'edits' ? 'acceptEdits' : 'default',
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: this.systemAppend(s) },
      canUseTool: (tool: string, input: Record<string, unknown>, o: any) => this.canUse(s, rt, tool, input, o),
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'helm' }
    };
    const exe = this.hooks.claudePath() || settings.claudePath;
    if (exe) options.pathToClaudeCodeExecutable = exe;
    if (s.claudeSessionId) options.resume = s.claudeSessionId;
    rt.q = query({ prompt: queue, options });
    this.rt.set(s.id, rt);
    if (first) queue.push(first);
    void this.consume(s, rt);
  }

  private async consume(s: Session, rt: Runtime) {
    try {
      for await (const m of rt.q) await this.onMessage(s, rt, m as any);
    } catch (e: any) {
      if (!rt.abort.signal.aborted) {
        s.error = String(e?.message || e);
        await this.push(s.id, { k: 'note', tone: 'error', text: s.error! });
        this.setStatus(s, 'error', trunc(s.error!, 120));
        this.activity(s, 'error', 'failed: ' + trunc(s.error!, 80));
        this.hooks.notify('failed', `${s.id} failed`, trunc(s.error!, 120), s.id);
      }
    } finally {
      if (this.rt.get(s.id) === rt) this.rt.delete(s.id);
      for (const w of rt.asks.values()) w.resolve({ behavior: 'deny', message: 'Session ended' });
      if (s.status === 'working' || s.status === 'attention') this.setStatus(s, 'idle', 'Stopped');
      s.ask = undefined;
      await this.refreshStats(s);
    }
  }

  private async onMessage(s: Session, rt: Runtime, m: any) {
    if (m.type === 'system' && m.subtype === 'init') {
      s.claudeSessionId = m.session_id;
      s.modelName = m.model;
      this.touch();
      return;
    }
    if (m.type === 'assistant') return this.onAssistant(s, rt, m);
    if (m.type === 'user') return this.onToolResults(s, rt, m);
    if (m.type === 'result') return this.onResult(s, rt, m);
  }

  private async onAssistant(s: Session, rt: Runtime, m: any) {
    if (m.parent_tool_use_id) return; // sub-agent chatter stays out of the main transcript
    const u = m.message?.usage;
    if (u) {
      const inp = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      s.tokens.input += inp;
      s.tokens.output += u.output_tokens || 0;
      s.tokens.cacheRead += u.cache_read_input_tokens || 0;
      s.ctx = inp + (u.cache_read_input_tokens || 0);
      const [pi, po] = PRICE[s.model] || PRICE.sonnet;
      const est = ((u.input_tokens || 0) * pi + (u.cache_creation_input_tokens || 0) * pi * 1.25 + (u.cache_read_input_tokens || 0) * pi * 0.1 + (u.output_tokens || 0) * po) / 1e6;
      rt.turnCost += est;
      this.store.addUsage(s.repoId, est, inp + (u.output_tokens || 0));
      s.cost = rt.baseCost + rt.turnCost;
    }
    for (const b of m.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) {
        await this.push(s.id, { k: 'agent', text: b.text.trim() });
      } else if (b.type === 'tool_use') {
        await this.onToolUse(s, rt, b);
      }
    }
    this.touch();
    await this.checkBudget(s, rt);
  }

  private async onToolUse(s: Session, rt: Runtime, b: any) {
    const input = b.input || {};
    const wt = s.worktree;
    const name: string = b.name;
    if (name === 'AskUserQuestion' || name === 'ExitPlanMode' || name === 'TodoWrite') return;
    if (COMMAND_TOOLS.has(name)) {
      const cmd = String(input.command || '');
      const idx = await this.push(s.id, { k: 'bash', id: b.id, cmd, out: '', ok: true, meta: '', done: false });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'bash', input });
      s.step = 'Running ' + trunc(cmd, 80);
      return;
    }
    if (EDIT_TOOLS.has(name)) {
      const file = rel(wt, String(input.file_path || input.notebook_path || ''));
      const lines: [string, string][] = [];
      let add = 0, del = 0;
      const edits = name === 'MultiEdit' ? input.edits || [] : name === 'Edit' ? [input] : [];
      if (name === 'Write') {
        const content = String(input.content || '');
        const all = content.split('\n');
        add = content ? all.length - (content.endsWith('\n') ? 1 : 0) : 0;
        for (const l of all.slice(0, 24)) lines.push(['+', l]);
        if (all.length > 24) lines.push([' ', `… ${all.length - 24} more lines`]);
      } else {
        for (const e of edits) {
          const o = String(e.old_string || '').split('\n');
          const n = String(e.new_string || '').split('\n');
          if (e.old_string) { del += o.length; for (const l of o.slice(0, 12)) lines.push(['-', l]); }
          if (e.new_string) { add += n.length; for (const l of n.slice(0, 12)) lines.push(['+', l]); }
        }
      }
      const idx = await this.push(s.id, { k: 'edit', file, add, del, lines: lines.slice(0, 40) });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'edit', input });
      s.step = 'Editing ' + file;
      s.editing = { file, line: 1 };
      return;
    }
    const t = await this.store.transcript(s.id);
    const target = trunc(String(input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt ?? ''), 140);
    const item: [string, string, string] = [name, rel(wt, target), ''];
    const last = t[t.length - 1];
    let idx: number;
    if (last && last.k === 'tools' && rt.lastTools === t.length - 1) {
      last.items.push(item);
      idx = t.length - 1;
      await this.patch(s.id, idx, last);
    } else {
      idx = await this.push(s.id, { k: 'tools', items: [item] });
      rt.lastTools = idx;
    }
    rt.toolStart.set(b.id, { t: Date.now(), idx: idx * 1000 + ((t[idx] as any).items.length - 1), kind: 'tool', input });
    s.step = ({ Read: 'Reading ', Grep: 'Searching ', Glob: 'Listing ', WebFetch: 'Fetching ', WebSearch: 'Searching the web for ' } as any)[name] ? ({ Read: 'Reading ', Grep: 'Searching ', Glob: 'Listing ', WebFetch: 'Fetching ', WebSearch: 'Searching the web for ' } as any)[name] + item[1] : 'Using ' + name;
  }

  private async onToolResults(s: Session, rt: Runtime, m: any) {
    const content = m.message?.content;
    if (!Array.isArray(content)) return;
    for (const b of content) {
      if (b.type !== 'tool_result') continue;
      const start = rt.toolStart.get(b.tool_use_id);
      if (!start) continue;
      rt.toolStart.delete(b.tool_use_id);
      const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c: any) => c.text || '').join('\n');
      const secs = (Date.now() - start.t) / 1000;
      const meta = secs < 1 ? Math.round(secs * 1000) + 'ms' : secs < 60 ? secs.toFixed(1) + 's' : Math.floor(secs / 60) + 'm ' + Math.round(secs % 60) + 's';
      if (start.kind === 'bash') {
        const t = await this.store.transcript(s.id);
        const cur = t[start.idx] as Extract<TranscriptEvent, { k: 'bash' }>;
        const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
        const out = b.is_error ? trunc(lines[lines.length - 1] || 'failed', 70) : lines.length ? trunc(lines[lines.length - 1], 70) : '✓';
        await this.patch(s.id, start.idx, { ...cur, out, ok: !b.is_error, meta, done: true });
        if (/git\s+commit/.test(cur.cmd)) await this.detectCommit(s, text);
      } else if (start.kind === 'edit') {
        if (!b.is_error) {
          await this.locateEdit(s, start.input);
          this.scheduleStats(s, rt);
        }
      } else if (start.kind === 'tool') {
        const ti = Math.floor(start.idx / 1000), ii = start.idx % 1000;
        const t = await this.store.transcript(s.id);
        const cur = t[ti] as Extract<TranscriptEvent, { k: 'tools' }>;
        if (cur && cur.items[ii]) {
          const n = text.split('\n').filter(Boolean).length;
          cur.items[ii][2] = b.is_error ? 'failed' : cur.items[ii][0] === 'Read' ? `${text.split('\n').length} lines` : cur.items[ii][0] === 'Grep' || cur.items[ii][0] === 'Glob' ? `${n} ${n === 1 ? 'match' : 'matches'}` : meta;
          await this.patch(s.id, ti, cur);
        }
      }
    }
  }

  private async detectCommit(s: Session, out: string) {
    const m = out.match(/^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m);
    if (!m) return;
    const now = Date.now();
    s.commits.push({ hash: m[1], at: now });
    await this.push(s.id, { k: 'commit', hash: m[1], msg: m[2], t: now });
    this.activity(s, 'commit', `committed ${m[1]} “${trunc(m[2], 70)}”`);
    this.touch();
  }

  private async locateEdit(s: Session, input: any) {
    try {
      const file = rel(s.worktree, String(input.file_path || ''));
      const text = await readFile(join(s.worktree, file), 'utf8');
      const needle = String(input.new_string || input.content || '').split('\n')[0];
      const at = needle ? text.indexOf(needle) : -1;
      s.editing = { file, line: at < 0 ? 1 : text.slice(0, at).split('\n').length };
      this.touch();
    } catch { /* file may be gone */ }
  }

  private scheduleStats(s: Session, rt: Runtime) {
    if (rt.statsTimer) return;
    rt.statsTimer = setTimeout(() => { rt.statsTimer = undefined; void this.refreshStats(s); }, 1500);
  }

  async refreshStats(s: Session) {
    try {
      const c = await G.changes(s.worktree, s.base);
      s.add = c.files.reduce((a, f) => a + f.add, 0);
      s.del = c.files.reduce((a, f) => a + f.del, 0);
      s.files = c.files.length;
      s.filesTouched = Object.fromEntries(c.files.map((f) => [f.path, { add: f.add, del: f.del }]));
      this.touch();
    } catch { /* worktree removed */ }
  }

  private async onResult(s: Session, rt: Runtime, m: any) {
    if (typeof m.total_cost_usd === 'number') {
      const delta = Math.max(0, m.total_cost_usd - rt.baseCost - rt.turnCost);
      if (delta > 0) this.store.addUsage(s.repoId, delta, 0);
      rt.baseCost = Math.max(rt.baseCost, m.total_cost_usd);
      rt.turnCost = 0;
      s.cost = rt.baseCost;
    }
    rt.toolStart.clear();
    rt.lastTools = undefined;
    await this.refreshStats(s);
    if (rt.budgetPaused) {
      rt.interrupted = false;
      this.touch();
      return;
    }
    if (rt.interrupted) {
      rt.interrupted = false;
      this.setStatus(s, 'idle', 'Paused. Reply to continue');
      return;
    }
    if (m.is_error) {
      const msg = String(m.result || m.subtype || 'The run failed');
      s.error = msg;
      await this.push(s.id, { k: 'note', tone: 'error', text: msg });
      this.setStatus(s, 'error', trunc(msg, 120));
      this.activity(s, 'error', 'failed: ' + trunc(msg, 80));
      this.hooks.notify('failed', `${s.id} failed`, trunc(msg, 120), s.id);
      return;
    }
    s.error = undefined;
    s.editing = undefined;
    if (s.files > 0 || s.commits.length > 0) {
      this.setStatus(s, 'ready', `${s.files} ${s.files === 1 ? 'file' : 'files'} changed · ready for review`);
      this.activity(s, 'ready', `finished · ${s.files} files ready for review`);
      this.hooks.notify('ready', `${s.id} is ready for review`, `${this.repoOf(s).id} · ${s.files} files`, s.id);
      this.hooks.toast({ tone: 'ready', title: `${s.id} is ready for review`, description: `${this.repoOf(s).id} · ${s.files} files`, sessionId: s.id, tab: 'changes' });
    } else {
      this.setStatus(s, 'idle', 'Finished');
      this.activity(s, 'done', 'finished');
    }
  }

  // ---------------------------------------------------------------- budget
  private async checkBudget(s: Session, rt: Runtime) {
    if (rt.budgetPaused || s.ask) return;
    const repo = this.repoOf(s);
    const spent = this.store.weekSpend()[s.repoId] || 0;
    let scope: 'session' | 'repo' | null = null;
    if (s.budget > 0 && s.cost >= s.budget) scope = 'session';
    else if (repo && repo.cap > 0 && spent >= repo.cap) scope = 'repo';
    if (!scope) return;
    rt.budgetPaused = true;
    const ask: PendingAsk = scope === 'session'
      ? { id: uid(), type: 'budget', at: Date.now(), head: `Paused at its $${s.budget.toFixed(2)} session budget`, note: 'Raising the limit resumes where it stopped.' }
      : { id: uid(), type: 'budget', at: Date.now(), head: `${repo.id} reached its $${repo.cap} weekly budget`, note: 'Raising the repository limit resumes this session where it stopped.' };
    rt.asks.set(ask.id, { ask, scope, resolve: () => undefined });
    s.ask = ask;
    this.activity(s, 'budget', ask.head.toLowerCase().replace(/^paused/, 'paused'));
    this.setStatus(s, 'attention', ask.head);
    this.hooks.notify('attention', `${s.id} is paused`, ask.head, s.id);
    rt.interrupted = true;
    await rt.q.interrupt().catch(() => undefined);
  }

  // ---------------------------------------------------------------- permissions
  private async canUse(s: Session, rt: Runtime, tool: string, input: Record<string, unknown>, o: any): Promise<any> {
    const st = this.store.data.settings;
    if (tool === 'AskUserQuestion') {
      const questions = (input.questions as any[]) || [];
      const ask: PendingAsk = { id: uid(), type: 'question', at: Date.now(), head: questions[0]?.question || 'The agent has a question', note: questions[0]?.options?.[0]?.description || '', questions };
      await this.push(s.id, { k: 'question', askId: ask.id, questions });
      const r = await this.waitAsk(s, rt, ask, 'tool', input, tool);
      return r;
    }
    if (COMMAND_TOOLS.has(tool)) {
      const cmd = String(input.command || '');
      if (SAFE_CMD.test(cmd.trim()) && !/[;&|`$><]/.test(cmd)) return { behavior: 'allow', updatedInput: input };
      if ([...st.alwaysAllow].some((p) => globMatch(p, cmd))) return { behavior: 'allow', updatedInput: input };
      const pattern = commandPattern(cmd);
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: cmd, pattern, head: 'Wants to run a command', note: o?.decisionReason || o?.description || `Runs inside ${s.worktree}. Your checkout is untouched.` };
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd, tool, why: ask.note, pattern });
      return this.waitAsk(s, rt, ask, 'tool', input, tool);
    }
    if (EDIT_TOOLS.has(tool)) {
      const p = String(input.file_path || input.notebook_path || '');
      if (!p || inside(s.worktree, p)) return { behavior: 'allow', updatedInput: input };
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: p, head: 'Wants to edit a file outside its worktree', note: 'This path is outside the session worktree.' };
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd: p, tool, why: ask.note });
      return this.waitAsk(s, rt, ask, 'tool', input, tool);
    }
    if (tool === 'ExitPlanMode') {
      const plan = String(input.plan || '');
      const ask: PendingAsk = { id: uid(), type: 'approve', at: Date.now(), tool, command: undefined, head: 'Plan ready for approval', note: trunc(plan, 400) };
      await this.push(s.id, { k: 'agent', text: plan });
      await this.push(s.id, { k: 'permission', askId: ask.id, cmd: 'Approve the plan and start work', tool, why: 'Approving switches this session to "Allow edits".' });
      const r = await this.waitAsk(s, rt, ask, 'tool', input, tool);
      if (r.behavior === 'allow') {
        s.permMode = 'edits';
        await rt.q.setPermissionMode('acceptEdits').catch(() => undefined);
      }
      return r;
    }
    return { behavior: 'allow', updatedInput: input };
  }

  private waitAsk(s: Session, rt: Runtime, ask: PendingAsk, scope: 'tool', input: Record<string, unknown>, tool: string): Promise<any> {
    return new Promise((resolveP) => {
      rt.asks.set(ask.id, { ask, scope, input, tool, resolve: resolveP });
      s.ask = ask;
      this.setStatus(s, 'attention', ask.type === 'question' ? 'Asked: ' + trunc(ask.head, 90) : ask.command ? `Wants to run ${trunc(ask.command, 80)}` : ask.head);
      this.activity(s, 'attention', ask.type === 'question' ? 'asked a question' : `asked to run ${trunc(ask.command || '', 70)}`);
      this.hooks.notify('attention', `${s.id} needs you`, ask.head, s.id);
    });
  }

  async resolveAsk(sessionId: string, askId: string, answer: any) {
    const s = this.get(sessionId);
    const rt = this.rt.get(sessionId);
    if (!s) return;
    const w = rt?.asks.get(askId);
    if (!w || !rt) { s.ask = undefined; this.touch(); return; }
    rt.asks.delete(askId);
    s.ask = undefined;
    const t = await this.store.transcript(sessionId);
    const markIdx = t.findIndex((e) => (e.k === 'permission' || e.k === 'question') && e.askId === askId);

    if (w.ask.type === 'budget') {
      const add = Number(answer.addBudget) || 5;
      if (w.scope === 'repo') { const r = this.repoOf(s); r.cap += add; } else s.budget += add;
      rt.budgetPaused = false;
      this.setStatus(s, 'working', 'Resuming');
      rt.queue.push('You hit a spending limit and it has been raised. Continue where you left off.');
      return;
    }

    if (w.ask.type === 'question') {
      const answers: Record<string, string> = answer.answers || {};
      if (markIdx >= 0) await this.patch(sessionId, markIdx, { ...(t[markIdx] as any), answered: Object.values(answers).join(', ') });
      this.setStatus(s, 'working', 'Continuing');
      w.resolve({ behavior: 'allow', updatedInput: { ...(w.input || {}), answers } });
      return;
    }

    const decision = answer.decision as 'approve' | 'always' | 'deny';
    if (markIdx >= 0) await this.patch(sessionId, markIdx, { ...(t[markIdx] as any), resolved: decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved' });
    if (decision === 'always' && w.ask.pattern) {
      const st = this.store.data.settings;
      if (!st.alwaysAllow.includes(w.ask.pattern)) st.alwaysAllow.push(w.ask.pattern);
    }
    this.setStatus(s, 'working', decision === 'deny' ? 'Continuing without it' : 'Running');
    if (decision === 'deny') w.resolve({ behavior: 'deny', message: answer.text ? `The user denied this: ${answer.text}` : 'The user denied this request. Ask what they would prefer.' });
    else w.resolve({ behavior: 'allow', updatedInput: w.input });
  }

  // ---------------------------------------------------------------- controls
  async send(id: string, text: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    let rt = this.rt.get(id);
    await this.push(id, { k: 'user', t: Date.now(), text });
    if (s.ask && rt) {
      // Replying while it waits counts as answering a question, or as a denial with an explanation.
      const w = [...rt.asks.values()][0];
      if (w?.ask.type === 'question') return this.resolveAsk(id, w.ask.id, { answers: { [w.ask.questions?.[0]?.question || 'answer']: text } });
      if (w?.ask.type === 'approve') return this.resolveAsk(id, w.ask.id, { decision: 'deny', text });
    }
    s.endedAt = undefined;
    if (!rt) {
      this.setStatus(s, 'working', 'Starting');
      await this.start(s, text);
      return;
    }
    this.setStatus(s, 'working', 'Reading your message');
    rt.queue.push(text);
  }

  async interrupt(id: string) {
    const rt = this.rt.get(id);
    const s = this.get(id);
    if (!rt || !s) return;
    rt.interrupted = true;
    await rt.q.interrupt().catch(() => undefined);
  }

  async stop(id: string) {
    const rt = this.rt.get(id);
    const s = this.get(id);
    if (!s) return;
    if (rt) {
      for (const w of rt.asks.values()) w.resolve({ behavior: 'deny', message: 'Session stopped', interrupt: true });
      rt.asks.clear();
      rt.queue.close();
      rt.abort.abort();
      this.rt.delete(id);
    }
    s.ask = undefined;
    this.setStatus(s, 'idle', 'Stopped');
  }

  async setModel(id: string, model: ModelAlias) {
    const s = this.get(id);
    if (!s) return;
    s.model = model;
    await this.rt.get(id)?.q.setModel(MODEL_ALIAS[model]).catch(() => undefined);
    this.touch();
  }

  async setPermMode(id: string, mode: PermMode) {
    const s = this.get(id);
    if (!s) return;
    s.permMode = mode;
    await this.rt.get(id)?.q.setPermissionMode(mode === 'plan' ? 'plan' : mode === 'edits' ? 'acceptEdits' : 'default').catch(() => undefined);
    this.touch();
  }

  async remove(id: string, removeWt: boolean) {
    const s = this.get(id);
    if (!s) return;
    await this.stop(id);
    if (removeWt) await G.removeWorktree(this.repoOf(s).localPath, s.worktree, s.branch);
    this.store.data.sessions = this.store.data.sessions.filter((x) => x.id !== id);
    this.touch();
  }

  /** Tell a running agent that the user changed a file under it. */
  async userEdited(id: string, file: string) {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt || s.status !== 'working') return;
    await this.push(id, { k: 'note', tone: 'neutral', text: `You edited ${file}. The agent was told.` });
    rt.queue.push(`Note from the user: they edited ${file} directly in the worktree. Re-read it before changing it again.`);
  }

  async stopAll() {
    for (const id of [...this.rt.keys()]) await this.stop(id);
  }

  isRunning = (id: string) => this.rt.has(id);
}
