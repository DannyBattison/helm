import { getSessionInfo, getSubagentMessages, query, renameSession, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fmtMoney } from '../shared/money';
import type { ActivityEvent, ModelAlias, NewSessionInput, PendingAsk, PermMode, Session, Status, Subagent, TranscriptEvent } from '../shared/types';
import * as G from './git';
import type { Store } from './store';
import { commandPattern, expandHome, globMatch, hasShellControl, uid } from './util';

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
  scope: 'session' | 'repo' | 'plan' | 'tool';
  planKey?: 'fiveHour' | 'weekly';
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
  toolStart: Map<string, { t: number; idx: number; kind: string; input: any; tkey: string }>;
  statsTimer?: NodeJS.Timeout;
  /** Index of the open tools group in each transcript, so consecutive reads share one box. */
  lastTools: Map<string, number>;
  /** Where each subagent's card sits in its parent transcript. */
  subEvent: Map<string, { tkey: string; idx: number }>;
  /** Subagents the limit hook let start, so a parallel batch is counted one by one. */
  admitted: Set<string>;
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
  /** True while helm is quitting: ending the agents must not rewrite what the sessions were doing. */
  private quitting = false;
  /** Plan windows the user chose to continue past, keyed to the window's reset time so it lapses on reset. */
  private planOverride: Partial<Record<'fiveHour' | 'weekly', number>> = {};
  constructor(private store: Store, private hooks: Hooks) {}

  get sessions() { return this.store.data.sessions; }
  private usd = (v: number, whole = false) => fmtMoney(v, this.store.data.settings.currency, this.store.data.fx.rates, { whole });
  private get billing() { return this.store.data.settings.billing; }
  get = (id: string) => this.sessions.find((s) => s.id === id);
  repoOf = (s: Session) => this.store.data.repos.find((r) => r.id === s.repoId)!;
  private touch() { this.store.save(); this.hooks.emitState(); }

  /** Called once at startup: nothing is running, so nothing should claim to be. */
  recover() {
    for (const s of this.sessions) {
      s.subagents ||= [];
      for (const a of s.subagents) if (a.status === 'working') { a.status = 'stopped'; a.endedAt = a.endedAt ?? Date.now(); }
      if (s.status === 'attention' && s.ask) {
        // Still waiting on the user. Its process is gone, but the question stands: answering it resumes the session.
        s.ask.orphaned = true;
      } else if (s.status === 'working' || s.status === 'attention') {
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
      s.lastAccess = Date.now();
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
    // `main` means the local branch, `origin/main` the one on GitHub. A bare name that only exists on GitHub falls back to it.
    const isLocal = !input.base.startsWith('origin/') && (await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/heads/' + input.base));
    const remoteBase = input.base.startsWith('origin/') || isLocal ? input.base : (await G.gitOk(repo.localPath, 'rev-parse', '--verify', 'origin/' + input.base)) ? 'origin/' + input.base : input.base;
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
      lastAccess: now, ctx: 0, add: 0, del: 0, files: 0, filesTouched: {}, timeline: [{ t: now, status: 'working' }], commits: [], removeAfterMerge: st.removeAfterMerge, subagents: []
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
      `Subagents: at most ${this.sessionLimit(s)} may run at once in this session and ${this.repoLimit(s)} across the repository. Start independent work in parallel only within those limits.`,
      st.runTests ? 'Before you finish, run the project\'s tests (from package.json, go.mod, Makefile or equivalent) when they exist, and state the result.' : ''
    ].filter(Boolean).join('\n');
  }

  private async start(s: Session, first?: string) {
    const abort = new AbortController();
    const queue = new InputQueue();
    const settings = this.store.data.settings;
    const rt: Runtime = { q: null as any, queue, abort, asks: new Map(), turnCost: 0, baseCost: s.cost, interrupted: false, budgetPaused: false, toolStart: new Map(), lastTools: new Map(), subEvent: new Map(), admitted: new Set() };
    const options: any = {
      cwd: s.worktree,
      model: MODEL_ALIAS[s.model],
      permissionMode: s.permMode === 'plan' ? 'plan' : s.permMode === 'edits' ? 'acceptEdits' : 'default',
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: this.systemAppend(s) },
      canUseTool: (tool: string, input: Record<string, unknown>, o: any) => this.canUse(s, rt, tool, input, o),
      hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [async (input: any) => this.checkSubagentLimit(s, rt, input)] }] },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'helm' }
    };
    // Only set when on, so a user's own Claude Code setting is never switched off by helm.
    if (settings.remoteControl) options.settings = { remoteControlAtStartup: true };
    const exe = settings.claudePath || this.hooks.claudePath();
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
      if (this.quitting) return;
      this.stopSubagents(s);
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
      const st = this.store.data.settings;
      if (!st.billingDetected) {
        // A Claude login reports no API key; an API key means tokens are paid for.
        st.billing = m.apiKeySource === 'none' ? 'subscription' : 'api';
        st.billingDetected = true;
      }
      this.touch();
      return;
    }
    if (m.type === 'system' && m.subtype === 'task_started' && m.tool_use_id) {
      const a = s.subagents.find((x) => x.id === m.tool_use_id);
      if (a) { a.agentId = m.task_id; this.touch(); }
      return;
    }
    if (m.type === 'system' && m.subtype === 'task_progress' && m.tool_use_id) return this.onTaskProgress(s, rt, m);
    if (m.type === 'system' && m.subtype === 'task_notification' && m.tool_use_id) return this.onTaskDone(s, rt, m);
    if (m.type === 'rate_limit_event') return this.onRateLimit(m.rate_limit_info);
    if (m.type === 'assistant') return this.onAssistant(s, rt, m);
    if (m.type === 'user') return this.onToolResults(s, rt, m);
    if (m.type === 'result') return this.onResult(s, rt, m);
  }

  private async onAssistant(s: Session, rt: Runtime, m: any) {
    const parent: string | null = m.parent_tool_use_id || null;
    const sub = parent ? s.subagents.find((x) => x.id === parent) : undefined;
    if (parent && !sub) return;
    const tkey = sub ? `${s.id}~${sub.id}` : s.id;
    const u = m.message?.usage;
    if (u) {
      const inp = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      s.tokens.input += inp;
      s.tokens.output += u.output_tokens || 0;
      s.tokens.cacheRead += u.cache_read_input_tokens || 0;
      this.store.addLifetimeTokens(s.repoId, inp, u.output_tokens || 0, u.cache_read_input_tokens || 0);
      if (!sub) s.ctx = inp + (u.cache_read_input_tokens || 0);
      else sub.tokens += inp + (u.output_tokens || 0);
      const [pi, po] = PRICE[s.model] || PRICE.sonnet;
      const est = ((u.input_tokens || 0) * pi + (u.cache_creation_input_tokens || 0) * pi * 1.25 + (u.cache_read_input_tokens || 0) * pi * 0.1 + (u.output_tokens || 0) * po) / 1e6;
      rt.turnCost += est;
      this.store.addUsage(s.repoId, est, inp + (u.output_tokens || 0));
      s.cost = rt.baseCost + rt.turnCost;
    }
    for (const b of m.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) {
        await this.push(tkey, { k: 'agent', text: b.text.trim() });
      } else if (b.type === 'tool_use') {
        await this.onToolUse(s, rt, b, tkey, sub);
      }
    }
    this.touch();
    await this.checkBudget(s, rt);
  }

  private async startSubagent(s: Session, rt: Runtime, b: any, tkey: string, parentSub?: Subagent) {
    const input = b.input || {};
    const now = Date.now();
    const a: Subagent = {
      id: b.id, parentId: parentSub?.id ?? null, description: trunc(String(input.description || 'Subagent'), 80),
      agentType: String(input.subagent_type || 'general-purpose'), status: 'working', startedAt: now, tools: 0, tokens: 0, background: !!input.run_in_background
    };
    s.subagents.push(a);
    const idx = await this.push(tkey, { k: 'subagent', id: a.id, description: a.description, agentType: a.agentType, status: 'working' });
    rt.subEvent.set(a.id, { tkey, idx });
    rt.toolStart.set(b.id, { t: now, idx, kind: 'subagent', input, tkey });
    await this.push(`${s.id}~${a.id}`, { k: 'user', t: now, text: String(input.prompt || ''), from: parentSub ? parentSub.description : s.id });
    s.step = 'Subagent: ' + a.description;
    this.activity(s, 'start', `started subagent “${trunc(a.description, 60)}”`);
    this.touch();
  }

  private async patchSubagent(rt: Runtime, a: Subagent) {
    const loc = rt.subEvent.get(a.id);
    if (loc) await this.patch(loc.tkey, loc.idx, { k: 'subagent', id: a.id, description: a.description, agentType: a.agentType, status: a.status, summary: a.summary });
  }

  private async finishSubagent(s: Session, rt: Runtime, a: Subagent, status: Subagent['status']) {
    a.status = status;
    a.endedAt = Date.now();
    rt.admitted.delete(a.id);
    await this.syncSubagent(s, a);
    await this.patchSubagent(rt, a);
    this.scheduleStats(s, rt);
    this.touch();
  }

  private subSyncAt = new Map<string, number>();

  private async onTaskProgress(s: Session, rt: Runtime, m: any) {
    const a = s.subagents.find((x) => x.id === m.tool_use_id);
    if (!a) return;
    if (m.usage) { a.tools = m.usage.tool_uses ?? a.tools; a.tokens = m.usage.total_tokens ?? a.tokens; }
    if (m.last_tool_name && a.status === 'working') s.step = `${a.description}: ${m.last_tool_name}`;
    this.touch();
    // Claude Code does not stream a subagent's own messages, so read them from its transcript now and then.
    const last = this.subSyncAt.get(a.id) ?? 0;
    if (Date.now() - last > 4000) {
      this.subSyncAt.set(a.id, Date.now());
      void this.syncSubagent(s, a);
    }
  }

  /** Claude Code writes a subagent's file lazily, often only once the whole turn is over. */
  async refreshSubagent(id: string, subId: string) {
    const s = this.get(id);
    const a = s?.subagents.find((x) => x.id === subId);
    if (s && a) await this.syncSubagent(s, a);
  }

  private subSync = new Map<string, Promise<void>>();

  /** Rebuilds a subagent's transcript from Claude Code's saved session file. Runs one at a time per subagent so a slow, older read can't overwrite a newer one. */
  private syncSubagent(s: Session, a: Subagent): Promise<void> {
    const prev = this.subSync.get(a.id) ?? Promise.resolve();
    const next = prev.then(() => this.doSyncSubagent(s, a), () => this.doSyncSubagent(s, a));
    this.subSync.set(a.id, next);
    return next;
  }

  private async doSyncSubagent(s: Session, a: Subagent) {
    if (!s.claudeSessionId || !a.agentId) return;
    try {
      const msgs = await getSubagentMessages(s.claudeSessionId, a.agentId, { dir: s.worktree });
      const events = this.convertMessages(msgs as any[], s.worktree);
      const key = `${s.id}~${a.id}`;
      const t = await this.store.transcript(key);
      const next: TranscriptEvent[] = [...(t[0]?.k === 'user' ? [t[0]] : []), ...events];
      for (let i = 0; i < next.length; i++) {
        if (JSON.stringify(t[i]) !== JSON.stringify(next[i])) { t[i] = next[i]; this.hooks.emitTranscript(key, i, next[i]); }
      }
      t.length = next.length;
      this.store.saveTranscript(key);
    } catch { /* the session file may not be flushed yet; the next sync will catch up */ }
  }

  convertMessages(msgs: any[], wt: string, withUser = false): TranscriptEvent[] {
    const ev: TranscriptEvent[] = [];
    const pending = new Map<string, { kind: 'bash' | 'tool'; idx: number; item?: number }>();
    let group = -1;
    for (const m of msgs) {
      const raw = m.message?.content;
      const content: any[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [{ type: 'text', text: raw }] : [];
      if (m.type === 'assistant') {
        for (const b of content) {
          if (b.type === 'text' && b.text?.trim()) { ev.push({ k: 'agent', text: b.text.trim() }); continue; }
          if (b.type !== 'tool_use') continue;
          const input = b.input || {};
          if (COMMAND_TOOLS.has(b.name)) {
            pending.set(b.id, { kind: 'bash', idx: ev.push({ k: 'bash', id: b.id, cmd: String(input.command || ''), out: '', ok: true, meta: '', done: false }) - 1 });
          } else if (EDIT_TOOLS.has(b.name)) {
            const file = rel(wt, String(input.file_path || input.notebook_path || ''));
            const lines: [string, string][] = [];
            let add = 0, del = 0;
            const edits = b.name === 'MultiEdit' ? input.edits || [] : b.name === 'Edit' ? [input] : [];
            if (b.name === 'Write') {
              const all = String(input.content || '').split('\n');
              add = all.length;
              for (const l of all.slice(0, 24)) lines.push(['+', l]);
            } else for (const e of edits) {
              const o = String(e.old_string || '').split('\n'), n = String(e.new_string || '').split('\n');
              if (e.old_string) { del += o.length; for (const l of o.slice(0, 12)) lines.push(['-', l]); }
              if (e.new_string) { add += n.length; for (const l of n.slice(0, 12)) lines.push(['+', l]); }
            }
            ev.push({ k: 'edit', file, add, del, lines: lines.slice(0, 40) });
            group = -1;
          } else {
            const target = trunc(String(input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt ?? ''), 140);
            const item: [string, string, string] = [b.name, rel(wt, target), ''];
            const last = ev[ev.length - 1];
            if (last && last.k === 'tools' && group === ev.length - 1) last.items.push(item);
            else group = ev.push({ k: 'tools', items: [item] }) - 1;
            pending.set(b.id, { kind: 'tool', idx: group, item: (ev[group] as any).items.length - 1 });
          }
        }
      } else if (m.type === 'user') {
        if (withUser) {
          const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (text && !/^<(local-command|command-|system-reminder|ide_)/.test(text)) ev.push({ k: 'user', t: 0, text });
        }
        for (const b of content) {
          if (b.type !== 'tool_result') continue;
          const p = pending.get(b.tool_use_id);
          if (!p) continue;
          const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c: any) => c.text || '').join('\n');
          if (p.kind === 'bash') {
            const cur = ev[p.idx] as Extract<TranscriptEvent, { k: 'bash' }>;
            const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
            ev[p.idx] = { ...cur, out: b.is_error ? trunc(lines[lines.length - 1] || 'failed', 70) : lines.length ? trunc(lines[lines.length - 1], 70) : '✓', ok: !b.is_error, done: true };
          } else {
            const cur = ev[p.idx] as Extract<TranscriptEvent, { k: 'tools' }>;
            const it = cur.items[p.item!];
            const n = text.split('\n').filter(Boolean).length;
            it[2] = b.is_error ? 'failed' : it[0] === 'Read' ? `${text.split('\n').length} lines` : it[0] === 'Grep' || it[0] === 'Glob' ? `${n} ${n === 1 ? 'match' : 'matches'}` : '';
          }
        }
      }
    }
    return ev;
  }

  private async onTaskDone(s: Session, rt: Runtime, m: any) {
    const a = s.subagents.find((x) => x.id === m.tool_use_id);
    if (!a || a.status !== 'working') return;
    if (m.summary) a.summary = trunc(String(m.summary).trim(), 600);
    await this.finishSubagent(s, rt, a, m.status === 'completed' ? 'done' : m.status === 'stopped' ? 'stopped' : 'failed');
  }

  private async onToolUse(s: Session, rt: Runtime, b: any, tkey: string, sub?: Subagent) {
    const input = b.input || {};
    const wt = s.worktree;
    const name: string = b.name;
    if (name === 'AskUserQuestion' || name === 'ExitPlanMode' || name === 'TodoWrite') return;
    if (sub) sub.tools++;
    if (name === 'Agent' || name === 'Task') return this.startSubagent(s, rt, b, tkey, sub);
    if (COMMAND_TOOLS.has(name)) {
      const cmd = String(input.command || '');
      const idx = await this.push(tkey, { k: 'bash', id: b.id, cmd, out: '', ok: true, meta: '', done: false });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'bash', input, tkey });
      s.step = (sub ? `${sub.description}: ` : '') + 'Running ' + trunc(cmd, 80);
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
      const idx = await this.push(tkey, { k: 'edit', file, add, del, lines: lines.slice(0, 40) });
      rt.toolStart.set(b.id, { t: Date.now(), idx, kind: 'edit', input, tkey });
      s.step = (sub ? `${sub.description}: ` : '') + 'Editing ' + file;
      s.editing = { file, line: 1 };
      return;
    }
    const t = await this.store.transcript(tkey);
    const target = trunc(String(input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt ?? ''), 140);
    const item: [string, string, string] = [name, rel(wt, target), ''];
    const last = t[t.length - 1];
    let idx: number;
    if (last && last.k === 'tools' && rt.lastTools.get(tkey) === t.length - 1) {
      last.items.push(item);
      idx = t.length - 1;
      await this.patch(tkey, idx, last);
    } else {
      idx = await this.push(tkey, { k: 'tools', items: [item] });
      rt.lastTools.set(tkey, idx);
    }
    rt.toolStart.set(b.id, { t: Date.now(), idx: idx * 1000 + ((t[idx] as any).items.length - 1), kind: 'tool', input, tkey });
    const verb = ({ Read: 'Reading ', Grep: 'Searching ', Glob: 'Listing ', WebFetch: 'Fetching ', WebSearch: 'Searching the web for ' } as any)[name];
    s.step = (sub ? `${sub.description}: ` : '') + (verb ? verb + item[1] : 'Using ' + name);
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
        const t = await this.store.transcript(start.tkey);
        const cur = t[start.idx] as Extract<TranscriptEvent, { k: 'bash' }>;
        const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
        const out = b.is_error ? trunc(lines[lines.length - 1] || 'failed', 70) : lines.length ? trunc(lines[lines.length - 1], 70) : '✓';
        await this.patch(start.tkey, start.idx, { ...cur, out, ok: !b.is_error, meta, done: true });
        if (/git\s+commit/.test(cur.cmd)) await this.detectCommit(s, text, start.tkey);
      } else if (start.kind === 'edit') {
        if (!b.is_error) {
          await this.locateEdit(s, start.input);
          this.scheduleStats(s, rt);
        }
      } else if (start.kind === 'subagent') {
        const a = s.subagents.find((x) => x.id === b.tool_use_id);
        if (a) {
          a.summary = trunc(text.trim(), 600);
          // A background subagent's result is only a placeholder; it finishes with its task notification.
          if (a.background && !b.is_error) await this.patchSubagent(rt, a);
          else await this.finishSubagent(s, rt, a, b.is_error ? 'failed' : 'done');
        }
      } else if (start.kind === 'tool') {
        const ti = Math.floor(start.idx / 1000), ii = start.idx % 1000;
        const t = await this.store.transcript(start.tkey);
        const cur = t[ti] as Extract<TranscriptEvent, { k: 'tools' }>;
        if (cur && cur.items[ii]) {
          const n = text.split('\n').filter(Boolean).length;
          cur.items[ii][2] = b.is_error ? 'failed' : cur.items[ii][0] === 'Read' ? `${text.split('\n').length} lines` : cur.items[ii][0] === 'Grep' || cur.items[ii][0] === 'Glob' ? `${n} ${n === 1 ? 'match' : 'matches'}` : meta;
          await this.patch(start.tkey, ti, cur);
        }
      }
    }
  }

  private async detectCommit(s: Session, out: string, tkey: string) {
    const m = out.match(/^\[[^\]\s]+(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/m);
    if (!m) return;
    const now = Date.now();
    s.commits.push({ hash: m[1], at: now });
    await this.push(tkey, { k: 'commit', hash: m[1], msg: m[2], t: now });
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
      // The SDK total is authoritative: correct the running estimate in either direction.
      const delta = m.total_cost_usd - rt.baseCost - rt.turnCost;
      if (Math.abs(delta) > 1e-6) this.store.addUsage(s.repoId, delta, 0);
      rt.baseCost = Math.max(rt.baseCost, m.total_cost_usd);
      rt.turnCost = 0;
      s.cost = rt.baseCost;
    }
    rt.toolStart.clear();
    rt.lastTools.clear();
    for (const a of s.subagents) if (a.agentId) await this.syncSubagent(s, a);
    await this.refreshStats(s);
    void this.refreshTitle(s);
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
  private onRateLimit(info: any) {
    if (!info) return;
    const w = info.unifiedWindows || {};
    const plan = this.store.data.plan;
    const pick = (key: string, type: string) => w[key] ?? (info.rateLimitType === type ? info : undefined);
    const five = pick('five_hour', 'five_hour');
    const week = pick('seven_day', 'seven_day');
    if (five?.utilization != null && five.resetsAt) plan.fiveHour = { util: five.utilization, resetsAt: five.resetsAt };
    if (week?.utilization != null && week.resetsAt) plan.weekly = { util: week.utilization, resetsAt: week.resetsAt };
    plan.at = Date.now();
    this.touch();
    void this.enforcePlan();
  }

  /** Pauses running sessions when a subscription window passes the percentage the user set. */
  async enforcePlan() {
    const st = this.store.data.settings;
    if (st.billing !== 'subscription') return;
    const plan = this.store.data.plan;
    const checks: ['fiveHour' | 'weekly', number, string][] = [['fiveHour', st.planPause5h, '5-hour'], ['weekly', st.planPauseWeek, 'weekly']];
    for (const [key, limit, name] of checks) {
      const w = plan[key];
      if (!limit || !w || w.resetsAt * 1000 < Date.now() || w.util * 100 < limit || (this.planOverride[key] ?? 0) >= w.resetsAt) continue;
      for (const [id, rt] of this.rt) {
        const s = this.get(id);
        if (!s || s.status !== 'working' || s.ask || rt.budgetPaused) continue;
        const mins = Math.max(1, Math.round((w.resetsAt * 1000 - Date.now()) / 60000));
        const resets = mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins}m`;
        const ask: PendingAsk = { id: uid(), type: 'budget', scope: 'plan', at: Date.now(), head: `Paused at ${Math.round(w.util * 100)}% of your ${name} plan usage`, note: `You set a limit of ${limit}%. The window resets in ${resets}. Continuing may use up the rest of your plan.` };
        rt.budgetPaused = true;
        rt.asks.set(ask.id, { ask, scope: 'plan', planKey: key, resolve: () => undefined });
        s.ask = ask;
        this.activity(s, 'budget', `paused at ${Math.round(w.util * 100)}% of the ${name} plan usage`);
        this.setStatus(s, 'attention', ask.head);
        this.hooks.notify('attention', `${s.id} is paused`, ask.head, s.id);
        rt.interrupted = true;
        await rt.q.interrupt().catch(() => undefined);
      }
      return;
    }
  }

  private async checkBudget(s: Session, rt: Runtime) {
    if (this.billing !== 'api') {
      await this.enforcePlan();
      return;
    }
    if (rt.budgetPaused || s.ask) return;
    const repo = this.repoOf(s);
    const spent = this.store.weekSpend()[s.repoId] || 0;
    let scope: 'session' | 'repo' | null = null;
    if (s.budget > 0 && s.cost >= s.budget) scope = 'session';
    else if (repo && repo.cap > 0 && spent >= repo.cap) scope = 'repo';
    if (!scope) return;
    rt.budgetPaused = true;
    const ask: PendingAsk = scope === 'session'
      ? { id: uid(), type: 'budget', scope, at: Date.now(), head: `Paused at its ${this.usd(s.budget)} session budget`, note: 'Raising the limit resumes where it stopped.' }
      : { id: uid(), type: 'budget', scope, at: Date.now(), head: `${repo.id} reached its ${this.usd(repo.cap, true)} weekly budget`, note: 'Raising the repository limit resumes this session where it stopped.' };
    rt.asks.set(ask.id, { ask, scope, resolve: () => undefined });
    s.ask = ask;
    this.activity(s, 'budget', ask.head.toLowerCase());
    this.setStatus(s, 'attention', ask.head);
    this.hooks.notify('attention', `${s.id} is paused`, ask.head, s.id);
    rt.interrupted = true;
    await rt.q.interrupt().catch(() => undefined);
  }

  // ---------------------------------------------------------------- permissions
  private async canUse(s: Session, rt: Runtime, tool: string, input: Record<string, unknown>, o: any): Promise<any> {
    const st = this.store.data.settings;
    // A request the user approved while helm was closed: the agent has re-issued it, so let it through once.
    const key = COMMAND_TOOLS.has(tool) ? String(input.command || '') : EDIT_TOOLS.has(tool) ? `${tool}:${String(input.file_path || input.notebook_path || '')}` : '';
    if (key && s.preApproved?.includes(key)) {
      s.preApproved = s.preApproved.filter((k) => k !== key);
      return { behavior: 'allow', updatedInput: input };
    }
    if (tool === 'AskUserQuestion') {
      const questions = (input.questions as any[]) || [];
      const ask: PendingAsk = { id: uid(), type: 'question', at: Date.now(), head: questions[0]?.question || 'The agent has a question', note: questions[0]?.options?.[0]?.description || '', questions };
      await this.push(s.id, { k: 'question', askId: ask.id, questions });
      const r = await this.waitAsk(s, rt, ask, 'tool', input, tool);
      return r;
    }
    if (COMMAND_TOOLS.has(tool)) {
      const cmd = String(input.command || '');
      const plain = !hasShellControl(cmd);
      if (plain && SAFE_CMD.test(cmd.trim())) return { behavior: 'allow', updatedInput: input };
      if (plain && st.alwaysAllow.some((p) => globMatch(p, cmd))) return { behavior: 'allow', updatedInput: input };
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
    if (!w || !rt) return this.resolveOrphan(s, askId, answer);
    rt.asks.delete(askId);
    s.ask = undefined;
    const t = await this.store.transcript(sessionId);
    const markIdx = t.findIndex((e) => (e.k === 'permission' || e.k === 'question') && e.askId === askId);

    if (w.ask.type === 'budget') {
      if (w.scope === 'plan' && w.planKey) {
        const win = this.store.data.plan[w.planKey];
        this.planOverride[w.planKey] = win?.resetsAt ?? Math.floor(Date.now() / 1000) + 3600;
        rt.budgetPaused = false;
        this.setStatus(s, 'working', 'Resuming');
        rt.queue.push('You were paused at a plan usage limit the user set, and they chose to continue. Continue where you left off.');
        return;
      }
      const add = Number(answer.addBudget) || 5; // USD
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

  /**
   * An approval, question or limit that was pending when helm closed. The agent's process is gone, so answering starts
   * the session again from its saved conversation, with the answer as the next message.
   */
  private async resolveOrphan(s: Session, askId: string, answer: any) {
    const ask = s.ask;
    if (!ask || ask.id !== askId) { s.ask = undefined; this.touch(); return; }
    const t = await this.store.transcript(s.id);
    const markIdx = t.findIndex((e) => (e.k === 'permission' || e.k === 'question') && e.askId === askId);
    const mark = async (patch: any) => { if (markIdx >= 0) await this.patch(s.id, markIdx, { ...(t[markIdx] as any), ...patch }); };
    s.ask = undefined;
    let message: string;
    if (ask.type === 'budget') {
      if (ask.scope === 'plan') {
        const p = this.store.data.plan;
        if (p.fiveHour) this.planOverride.fiveHour = p.fiveHour.resetsAt;
        if (p.weekly) this.planOverride.weekly = p.weekly.resetsAt;
        message = 'You were paused at a plan usage limit the user set, and they chose to continue. Continue where you left off.';
      } else {
        const add = Number(answer.addBudget) || 5; // USD
        if (ask.scope === 'repo') this.repoOf(s).cap += add; else s.budget += add;
        message = 'You were paused at a spending limit and it has been raised. Continue where you left off.';
      }
    } else if (ask.type === 'question') {
      const answers: Record<string, string> = answer.answers || {};
      await mark({ answered: Object.values(answers).join(', ') });
      message = `helm was restarted while you waited. The user answered your question "${ask.questions?.[0]?.question || ''}": ${Object.values(answers).join(', ')}. Continue.`;
    } else {
      const decision = answer.decision as 'approve' | 'always' | 'deny';
      await mark({ resolved: decision === 'deny' ? 'denied' : decision === 'always' ? 'always' : 'approved' });
      const what = ask.command || ask.head;
      if (decision === 'deny') {
        message = `helm was restarted while you waited for approval to run "${what}". The user denied it${answer.text ? `: ${answer.text}` : ''}. Do not run it; ask what they would prefer.`;
      } else {
        if (decision === 'always' && ask.pattern && !this.store.data.settings.alwaysAllow.includes(ask.pattern)) this.store.data.settings.alwaysAllow.push(ask.pattern);
        if (ask.tool === 'ExitPlanMode') {
          s.permMode = 'edits';
          message = 'helm was restarted while you waited. The user approved your plan. Go ahead and start.';
        } else {
          (s.preApproved ||= []).push(ask.tool && EDIT_TOOLS.has(ask.tool) ? `${ask.tool}:${ask.command}` : String(ask.command));
          message = `helm was restarted while you waited for approval. The user approved this, so go ahead and run it now: ${what}`;
        }
      }
    }
    await this.push(s.id, { k: 'note', tone: 'neutral', text: 'helm was restarted while this waited. The session is resuming with your answer.' });
    this.setStatus(s, 'working', 'Resuming');
    await this.start(s, message);
  }

  // ---------------------------------------------------------------- controls
  async send(id: string, text: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    let rt = this.rt.get(id);
    // Talking to a session brings it back from the archive.
    s.lastAccess = Date.now();
    s.archivedAt = undefined;
    s.archivedAuto = undefined;
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

  /** Claude Code names a conversation after its first turns. Pick that up once it exists, unless it is just the first prompt echoed back. */
  private async refreshTitle(s: Session) {
    if (!s.claudeSessionId) return;
    try {
      const i = await getSessionInfo(s.claudeSessionId, { dir: s.worktree });
      const t = i?.summary?.trim();
      if (!t || t === i?.firstPrompt?.trim() || t === s.title) return;
      s.title = t;
      this.touch();
    } catch { /* no title yet */ }
  }

  async rename(id: string, title: string) {
    const s = this.get(id);
    if (!s) return;
    title = title.trim().slice(0, 120);
    s.customTitle = title || undefined;
    this.touch();
    // Keep Claude Code's own name in step, so the same session reads the same in VS Code.
    if (title && s.claudeSessionId) await renameSession(s.claudeSessionId, title, { dir: s.worktree }).catch(() => undefined);
  }

  archive(id: string, archived: boolean) {
    const s = this.get(id);
    if (!s) return;
    if (archived && (this.rt.has(id) || s.status === 'working' || s.status === 'attention')) throw new Error('Stop the session before archiving it.');
    s.archivedAt = archived ? Date.now() : undefined;
    s.archivedAuto = undefined;
    if (!archived) s.lastAccess = Date.now();
    this.touch();
  }

  touchAccess(id: string) {
    const s = this.get(id);
    if (!s) return;
    s.lastAccess = Date.now();
    this.store.save();
  }

  /**
   * Archives sessions nobody has opened for the configured number of days. Anything running, waiting on the user,
   * or finished but not yet reviewed (no pull request) is left alone, because hiding it would hide work that needs attention.
   */
  autoArchive() {
    const days = this.store.data.settings.archiveAfterDays;
    if (!days) return;
    const cutoff = Date.now() - days * 86_400_000;
    let any = false;
    for (const s of this.sessions) {
      if (s.archivedAt || this.rt.has(s.id) || s.status === 'working' || s.status === 'attention' || s.ask) continue;
      if (s.status === 'ready' && !s.prUrl) continue;
      if ((s.lastAccess || s.startedAt) > cutoff) continue;
      s.archivedAt = Date.now();
      s.archivedAuto = true;
      any = true;
    }
    if (any) this.touch();
  }

  /** What deleting would lose: uncommitted work in the worktree, and commits that exist nowhere else. */
  async deleteInfo(id: string) {
    const s = this.get(id);
    if (!s) throw new Error('Session not found');
    const repo = this.repoOf(s);
    const worktreeExists = await G.fileExists(s.worktree);
    const dirty = worktreeExists ? (await G.git(s.worktree, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length : 0;
    const pushed = await G.gitOk(repo.localPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/' + s.branch);
    const range = pushed ? `origin/${s.branch}..${s.branch}` : `${s.base}..${s.branch}`;
    const unpushed = +(await G.git(repo.localPath, 'rev-list', '--count', range).catch(() => '0')).trim() || 0;
    return { branch: s.branch, worktree: s.worktree, worktreeExists, dirty, unpushed, pushed, running: this.rt.has(id) };
  }

  /** Deletes the session. A branch can only be deleted together with its worktree, since git refuses to delete a checked-out branch. */
  async remove(id: string, opts: { worktree: boolean; branch: boolean }) {
    const s = this.get(id);
    if (!s) return;
    await this.stop(id);
    if (opts.worktree || opts.branch) await G.removeWorktree(this.repoOf(s).localPath, s.worktree, opts.branch ? s.branch : undefined);
    this.store.data.sessions = this.store.data.sessions.filter((x) => x.id !== id);
    await this.store.deleteTranscripts(id);
    this.touch();
  }

  sessionLimit(s: Session) { return s.maxSubagents ?? this.store.data.settings.maxSubagentsSession; }
  repoLimit(s: Session) { return this.repoOf(s)?.maxSubagents ?? this.store.data.settings.maxSubagentsRepo; }

  /** Subagents of a session that were let through and are still running. */
  private runningSubagents(s: Session): number {
    const rt = this.rt.get(s.id);
    return s.subagents.filter((a) => a.status === 'working' && (!rt || rt.admitted.has(a.id))).length;
  }

  /** PreToolUse hook for the Agent tool: enforces the per-session and per-repository limits on subagents running at once. */
  private async checkSubagentLimit(s: Session, rt: Runtime, input: any): Promise<any> {
    const id = String(input?.tool_use_id || '');
    const sl = this.sessionLimit(s), rl = this.repoLimit(s);
    const mine = this.runningSubagents(s);
    const inRepo = this.sessions.filter((x) => x.repoId === s.repoId).reduce((n, x) => n + this.runningSubagents(x), 0);
    let reason = '';
    if (mine >= sl) reason = sl === 0 ? 'Subagents are turned off for this session.' : `This session already has ${mine} ${mine === 1 ? 'subagent' : 'subagents'} running, which is its limit.`;
    else if (inRepo >= rl) reason = `${this.repoOf(s)?.id} already has ${inRepo} subagents running across its sessions, which is the repository limit.`;
    if (!reason) {
      rt.admitted.add(id);
      return {};
    }
    await this.push(s.id, { k: 'note', tone: 'neutral', text: 'Subagent blocked. ' + reason });
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason + ' Wait for one to finish, or do this work yourself.' } };
  }

  private stopSubagents(s: Session) {
    let any = false;
    for (const a of s.subagents) if (a.status === 'working') { a.status = 'stopped'; a.endedAt = Date.now(); any = true; }
    if (any) this.touch();
  }

  /** Tell a running agent that the user changed a file under it. */
  async userEdited(id: string, file: string) {
    const s = this.get(id);
    const rt = this.rt.get(id);
    if (!s || !rt || s.status !== 'working') return;
    await this.push(id, { k: 'note', tone: 'neutral', text: `You edited ${file}. The agent was told.` });
    rt.queue.push(`Note from the user: they edited ${file} directly in the worktree. Re-read it before changing it again.`);
  }

  /** helm is quitting: end the agent processes but leave each session as it was, so a pending approval survives to the next launch. */
  shutdown() {
    this.quitting = true;
    for (const rt of this.rt.values()) { rt.queue.close(); rt.abort.abort(); }
    this.rt.clear();
  }

  async stopAll() {
    for (const id of [...this.rt.keys()]) await this.stop(id);
  }

  isRunning = (id: string) => this.rt.has(id);
}
