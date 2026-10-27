import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AgentBackend, AgentBlock, AgentCapabilities, AgentEvent, AgentHandle, AgentStartOptions, BackendAuth, ConversationInfo, ConversationStore, PlanProbe, PlanWindow, ReviewOutcome, ReviewRequest, ToolDecision } from './backend';
import type { AgentLogin, Effort, MessageImage, ModelInfo, PermMode, TranscriptEvent } from '../shared/types';
import { run } from './util';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { convertMessages } from './transcript';

/**
 * OpenAI Codex, through `codex app-server`: JSON-RPC (without the "jsonrpc" field) as one JSON object per line on stdio.
 * One server process is shared by every session; each session is a Codex thread. The protocol's types come from
 * `codex app-server generate-ts`. Codex's items are translated into Claude Code's tool vocabulary (Bash, Edit, Write …),
 * which is what the rest of helm understands.
 */

export interface CodexPaths {
  /** The `codex` executable. */
  cli(): string | undefined;
}

type Json = any;

/**
 * Where `codex` is. An app started from a desktop icon does not see the PATH a terminal has, so look where npm, Homebrew and
 * the usual installers put it as well. A path set in Settings wins.
 */
export function findCodex(configured?: string): string {
  if (configured) return configured;
  const win = process.platform === 'win32';
  const name = win ? 'codex.cmd' : 'codex';
  const dirs = [...(process.env.PATH || '').split(win ? ';' : ':'), '/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin'), join(homedir(), '.volta/bin'), join(homedir(), '.bun/bin'), win ? join(process.env.APPDATA || '', 'npm') : ''].filter(Boolean);
  for (const d of dirs) { const f = join(d, name); if (existsSync(f)) return f; }
  return name;
}
type Notice = { method: string; params: Json };

/** The server process and a request/response layer over it. */
export class CodexServer {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private id = 0;
  private pending = new Map<number, { resolve(v: Json): void; reject(e: Error): void }>();
  private buf = '';
  private notices = new Set<(n: Notice) => void>();
  private requestHandler: (method: string, params: Json) => Promise<Json> = async () => { throw new Error('not handled'); };

  constructor(private paths: CodexPaths) {}

  onNotice(fn: (n: Notice) => void) { this.notices.add(fn); return () => this.notices.delete(fn); }
  /** Answers the server's own requests: approvals, questions for the user. */
  onRequest(fn: (method: string, params: Json) => Promise<Json>) { this.requestHandler = fn; }

  private start(): Promise<void> {
    const exe = findCodex(this.paths.cli());
    const p = spawn(exe, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'], env: process.env, shell: process.platform === 'win32' });
    this.proc = p;
    p.stdout.on('data', (d) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (line.trim()) { try { this.handle(JSON.parse(line)); } catch { /* not a message */ } }
      }
    });
    p.stderr.on('data', () => undefined);
    // Writing to a process that never started (Codex is not installed) must not take helm down with it.
    p.stdin.on('error', () => undefined);
    const gone = (why: string) => {
      if (this.proc === p) { this.proc = null; this.ready = null; }
      for (const w of this.pending.values()) w.reject(new Error(why));
      this.pending.clear();
      for (const fn of this.notices) fn({ method: '_exit', params: { why } });
    };
    p.on('error', (e) => gone(`Codex could not be started: ${e.message}. Is it installed?`));
    p.on('exit', (code) => gone(`Codex stopped (exit ${code})`));
    return this.call('initialize', { clientInfo: { name: 'helm', title: 'helm', version: '0' }, capabilities: { experimentalApi: true } }).then(() => { this.send({ method: 'initialized' }); });
  }

  /** Starts the server if it is not running. */
  ensure(): Promise<void> {
    if (!this.ready) this.ready = this.start().catch((e) => { this.ready = null; throw e; });
    return this.ready;
  }

  private send(m: Json) { this.proc?.stdin.write(JSON.stringify(m) + '\n'); }

  private call(method: string, params?: Json): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
    });
  }

  async request(method: string, params?: Json): Promise<Json> {
    await this.ensure();
    return this.call(method, params);
  }

  private handle(m: Json) {
    if (m.id != null && m.method == null) {
      const w = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) w?.reject(Object.assign(new Error(m.error.message || 'Codex request failed'), { code: m.error.code }));
      else w?.resolve(m.result);
    } else if (m.id != null && m.method) {
      this.requestHandler(m.method, m.params).then(
        (result) => this.send({ id: m.id, result }),
        (e) => this.send({ id: m.id, error: { code: -32603, message: String(e?.message || e) } })
      );
    } else if (m.method) {
      for (const fn of this.notices) fn({ method: m.method, params: m.params });
    }
  }

  stop() { this.proc?.kill(); this.proc = null; this.ready = null; }
}

// ---------------------------------------------------------------- mapping

/**
 * OpenAI's structured output wants every property listed as required and no extras allowed, where helm's schemas leave some
 * optional. Make each one required, and let a property that was optional also be null.
 */
export function strictSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out: any = Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v as any).map(([n, p]) => [n, strictSchema(p)])) : strictSchema(v)]));
  if (out.type === 'object' && out.properties) {
    const required = new Set<string>(out.required || []);
    for (const [n, p] of Object.entries<any>(out.properties)) {
      if (!required.has(n) && typeof p.type === 'string') out.properties[n] = { ...p, type: [p.type, 'null'] };
    }
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

const approvalFor = (m: PermMode) => (m === 'all' ? 'never' : m === 'ask' ? 'untrusted' : 'on-request');
const sandboxFor = (m: PermMode, roots: string[]) =>
  m === 'all' ? { type: 'dangerFullAccess' }
  : m === 'plan' ? { type: 'readOnly', networkAccess: false }
  : { type: 'workspaceWrite', writableRoots: roots, networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
/** Codex names its effort levels itself; helm's highest is Codex's `xhigh`. */
const effortFor = (e?: Effort) => (e === 'max' ? 'xhigh' : e);

/** helm's MCP servers in Codex's config form (`mcp_servers`): a command to run, or an address to call. */
export function codexMcp(servers: Record<string, any> = {}): Record<string, any> {
  return Object.fromEntries(Object.entries(servers).map(([name, v]) => [name, v.type === 'stdio'
    ? { command: v.command, args: v.args || [], ...(v.env ? { env: v.env } : {}) }
    : { url: v.url, ...(v.headers ? { http_headers: v.headers } : {}) }]));
}

/** Turns the unified diff Codex gives for one file into the old and new text helm's diff cards are built from. */
function sidesOf(diff: string): { old: string; new: string } {
  const o: string[] = [], n: string[] = [];
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++') || l.startsWith('---') || l.startsWith('@@') || l.startsWith('diff ') || l.startsWith('index ')) continue;
    if (l.startsWith('+')) n.push(l.slice(1));
    else if (l.startsWith('-')) o.push(l.slice(1));
  }
  return { old: o.join('\n'), new: n.join('\n') };
}

/** The tool calls a Codex item stands for, in Claude Code's vocabulary. */
export function toolUsesOf(item: Json): Extract<AgentBlock, { type: 'tool_use' }>[] {
  switch (item.type) {
    case 'commandExecution':
      return [{ type: 'tool_use', id: item.id, name: 'Bash', input: { command: item.command } }];
    case 'fileChange':
      return (item.changes || []).map((c: Json, i: number): Extract<AgentBlock, { type: 'tool_use' }> => {
        const id = `${item.id}:${i}`;
        const { old, new: nu } = sidesOf(String(c.diff || ''));
        if (c.kind?.type === 'add') return { type: 'tool_use', id, name: 'Write', input: { file_path: c.path, content: nu } };
        if (c.kind?.type === 'delete') return { type: 'tool_use', id, name: 'Edit', input: { file_path: c.path, old_string: old, new_string: '' } };
        return { type: 'tool_use', id, name: 'Edit', input: { file_path: c.kind?.move_path || c.path, old_string: old, new_string: nu } };
      });
    case 'mcpToolCall':
      return [{ type: 'tool_use', id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments || {} }];
    case 'dynamicToolCall':
      return [{ type: 'tool_use', id: item.id, name: item.tool, input: item.arguments || {} }];
    case 'webSearch':
      return [{ type: 'tool_use', id: item.id, name: 'WebSearch', input: { query: item.query ?? item.action?.query ?? '' } }];
    case 'imageView':
      return [{ type: 'tool_use', id: item.id, name: 'Read', input: { file_path: item.path } }];
    case 'collabAgentToolCall':
      return item.tool === 'spawnAgent'
        ? [{ type: 'tool_use', id: item.id, name: 'Agent', input: { description: String(item.prompt || 'Subagent').split('\n')[0].slice(0, 80), prompt: item.prompt || '', subagent_type: item.model || 'codex', run_in_background: true } }]
        : [];
    default:
      return [];
  }
}

/** What a finished item reports back, one result per tool call it made. */
export function resultsOf(item: Json): { id: string; text: string; isError: boolean }[] {
  switch (item.type) {
    case 'commandExecution': {
      const failed = item.status === 'failed' || item.status === 'declined' || (item.exitCode != null && item.exitCode !== 0);
      return [{ id: item.id, text: String(item.aggregatedOutput ?? (item.status === 'declined' ? 'The user declined this command.' : '')), isError: failed }];
    }
    case 'fileChange':
      return (item.changes || []).map((_: Json, i: number) => ({ id: `${item.id}:${i}`, text: item.status === 'completed' ? 'Applied.' : String(item.status), isError: item.status === 'failed' || item.status === 'declined' }));
    case 'mcpToolCall':
      return [{ id: item.id, text: item.error ? String(item.error.message || 'failed') : JSON.stringify(item.result?.content ?? item.result ?? ''), isError: !!item.error || item.status === 'failed' }];
    case 'dynamicToolCall':
      return [{ id: item.id, text: (item.contentItems || []).map((c: Json) => c.text || '').join('\n'), isError: item.success === false }];
    case 'webSearch': case 'imageView':
      return [{ id: item.id, text: '', isError: false }];
    case 'collabAgentToolCall':
      return item.tool === 'spawnAgent'
        ? [{ id: item.id, text: Object.values(item.agentsStates || {}).map((s: Json) => s?.message || '').filter(Boolean).join('\n'), isError: item.status === 'failed' }]
        : [];
    default:
      return [];
  }
}

/** A saved thread as Claude-style messages, so the transcript converter can read it. */
export function threadMessages(turns: Json[]): Json[] {
  const out: Json[] = [];
  for (const t of turns) {
    for (const item of t.items || []) {
      if (item.type === 'userMessage') {
        out.push({ type: 'user', message: { content: (item.content || []).filter((c: Json) => c.type === 'text').map((c: Json) => ({ type: 'text', text: c.text })) } });
      } else if (item.type === 'agentMessage' || item.type === 'plan') {
        if (item.text?.trim()) out.push({ type: 'assistant', message: { content: [{ type: 'text', text: item.text }] } });
      } else {
        const uses = toolUsesOf(item);
        if (uses.length) {
          out.push({ type: 'assistant', message: { content: uses } });
          out.push({ type: 'user', message: { content: resultsOf(item).map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.text, is_error: r.isError })) } });
        }
      }
    }
  }
  return out;
}

/** Plan windows from a Codex rate-limit snapshot: the five-hour one and the weekly one, told apart by length. */
export function windowsOf(snap: Json): { fiveHour?: PlanWindow; weekly?: PlanWindow } {
  const out: { fiveHour?: PlanWindow; weekly?: PlanWindow } = {};
  for (const w of [snap?.primary, snap?.secondary]) {
    if (!w || w.usedPercent == null || !w.resetsAt) continue;
    const win = { util: w.usedPercent / 100, resetsAt: w.resetsAt };
    if ((w.windowDurationMins ?? 0) >= 24 * 60 * 3) out.weekly = win; else out.fiveHour = win;
  }
  return out;
}


// ---------------------------------------------------------------- backend

export class CodexBackend implements AgentBackend {
  readonly id = 'codex';
  readonly label = 'Codex';
  readonly shortName = 'Codex';
  readonly identity = { name: 'Codex', email: 'noreply@openai.com' };
  models: ModelInfo[] = [];
  readonly capabilities: AgentCapabilities = { subagents: true, planMode: true, effort: true, fork: true, cost: false, planUsage: true };
  private server: CodexServer;
  private handles = new Map<string, CodexHandle>();
  private rate: Json = null;
  private account: Json = null;

  constructor(private paths: CodexPaths) {
    this.server = new CodexServer(paths);
    // Don't leave the app server running after helm closes.
    process.once('exit', () => this.server.stop());
    this.server.onNotice((n) => this.notice(n));
    this.server.onRequest((method, params) => this.serverRequest(method, params));
  }

  private notice(n: Notice) {
    if (n.method === 'account/rateLimits/updated') {
      // Sparse: fold what arrived into what we had.
      const r = n.params?.rateLimits || {};
      this.rate = { ...(this.rate || {}), ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)) };
      const w = windowsOf(this.rate);
      for (const h of this.handles.values()) h.push({ t: 'plan_usage', ...w });
      return;
    }
    if (n.method === '_exit') { for (const h of [...this.handles.values()]) h.serverGone(String(n.params?.why || 'Codex stopped')); return; }
    const tid = n.params?.threadId ?? n.params?.thread?.id;
    if (tid) this.handles.get(tid)?.notice(n);
  }

  private async serverRequest(method: string, params: Json): Promise<Json> {
    const h = this.handles.get(params?.threadId);
    if (!h) {
      if (method.endsWith('requestApproval')) return { decision: 'decline' };
      throw new Error('No session is waiting for this: ' + method);
    }
    return h.serverRequest(method, params);
  }

  async refresh() {
    try {
      const r = await this.server.request('model/list', { includeHidden: false });
      const list: Json[] = (r?.data || []).filter((m: Json) => !m.hidden);
      list.sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));
      this.models = list.map((m) => ({ id: m.model, label: m.displayName || m.model, price: [0, 0] as [number, number] }));
    } catch { /* not installed, or not reachable: keep what we had */ }
  }

  async version(path?: string): Promise<string | null> {
    try {
      const out = await run(findCodex(path || this.paths.cli()), ['--version'], { timeout: 8000 });
      return out.trim().split(/\s+/).pop() || null;
    } catch { return null; }
  }

  // ------------------------------------------------------------ sign-in
  private loginId: string | null = null;
  private asLogin(r: Json): AgentLogin {
    const a = r?.account;
    this.account = a ?? null;
    if (!a) return { loggedIn: false, method: 'none' };
    if (a.type === 'chatgpt') return { loggedIn: true, method: 'chatgpt', email: a.email ?? undefined, plan: a.planType ?? undefined, billing: 'subscription' };
    if (a.type === 'apiKey') return { loggedIn: true, method: 'api key', billing: 'api' };
    return { loggedIn: true, method: String(a.type), billing: 'api' };
  }

  readonly auth: BackendAuth = {
    status: async () => {
      try {
        let r = await this.server.request('account/read', { refreshToken: false });
        // A key in the environment is what the agent would use, as it is for Claude: sign in with it.
        const key = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
        if (!r?.account && key) {
          await this.server.request('account/login/start', { type: 'apiKey', apiKey: key }).catch(() => undefined);
          r = await this.server.request('account/read', { refreshToken: false });
        }
        return this.asLogin(r);
      } catch (e: any) { return { loggedIn: false, method: 'none', error: String(e?.message || e) }; }
    },
    startLogin: async () => {
      const r = await this.server.request('account/login/start', { type: 'chatgptDeviceCode' });
      if (r?.type !== 'chatgptDeviceCode') throw new Error('Codex did not offer a sign-in code.');
      this.loginId = r.loginId;
      return { url: r.verificationUrl, code: r.userCode, needsCode: false };
    },
    cancel: () => { const id = this.loginId; this.loginId = null; if (id) void this.server.request('account/login/cancel', { loginId: id }).catch(() => undefined); },
    logout: async () => {
      await this.server.request('account/logout', undefined).catch(() => undefined);
      this.rate = null;
      return this.asLogin(await this.server.request('account/read', { refreshToken: false }).catch(() => null));
    }
  };

  async planUsage(): Promise<PlanProbe | null> {
    try {
      const r = await this.server.request('account/rateLimits/read', undefined);
      this.rate = r?.rateLimits ?? null;
      const billing = this.account?.type === 'apiKey' ? 'api' : 'subscription';
      return { billing, ...windowsOf(this.rate) };
    } catch { return null; }
  }

  // ------------------------------------------------------------ sessions
  start(o: AgentStartOptions): AgentHandle {
    const h = new CodexHandle(this.server, o, (id, hd) => { if (hd) this.handles.set(id, hd); else this.handles.delete(id); }, () => this.account?.type === 'apiKey' ? 'api' : 'subscription');
    return h.api;
  }

  async review(req: ReviewRequest): Promise<ReviewOutcome> {
    let failure = '', text = '', structured: unknown;
    try {
      const r = await this.server.request('thread/start', { model: req.model, cwd: req.cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true });
      const threadId: string = r.thread.id;
      const done = new Promise<Json>((resolve) => {
        const off = this.server.onNotice((n) => { if (n.method === 'turn/completed' && n.params?.threadId === threadId) { off(); resolve(n.params.turn); } if (n.method === '_exit') { off(); resolve({ status: 'failed', error: { message: 'Codex stopped' } }); } });
      });
      await this.server.request('turn/start', { threadId, input: [{ type: 'text', text: req.prompt, text_elements: [] }], outputSchema: strictSchema(req.schema) });
      const turn = await done;
      if (turn.status === 'failed') failure = String(turn.error?.message || 'The reviewer failed');
      const msg = [...(turn.items || [])].reverse().find((i: Json) => i.type === 'agentMessage');
      text = String(msg?.text || '');
      try { structured = JSON.parse(text); } catch { /* parseReview copes with prose */ }
    } catch (e: any) { failure = String(e?.message || e); }
    return { structured, text, cost: 0, failure };
  }

  // ------------------------------------------------------------ conversations
  private info = (t: Json): ConversationInfo => ({
    id: t.id, title: t.name || undefined, summary: t.name || undefined, firstPrompt: t.preview || undefined, cwd: t.cwd, branch: t.gitInfo?.branch ?? undefined,
    size: 0, lastModified: (t.updatedAt ?? 0) * 1000, createdAt: t.createdAt ? t.createdAt * 1000 : undefined
  });

  readonly conversations: ConversationStore = {
    info: async (id) => {
      const r = await this.server.request('thread/read', { threadId: id, includeTurns: false }).catch(() => null);
      return r?.thread ? this.info(r.thread) : null;
    },
    rename: async (id, _dir, title) => { await this.server.request('thread/name/set', { threadId: id, name: title }); },
    fork: async ({ sourceId, destDir, upToMessageId, title }) => {
      const r = await this.server.request('thread/fork', { threadId: sourceId, lastTurnId: upToMessageId ?? null, cwd: destDir });
      await this.server.request('thread/name/set', { threadId: r.thread.id, name: title }).catch(() => undefined);
      return r.thread.id;
    },
    // Codex forks at a turn: the one before the turn that held the user's message.
    messageBefore: async (id, _dir, text, occurrence) => {
      const r = await this.server.request('thread/read', { threadId: id, includeTurns: true });
      let seen = 0;
      const turns: Json[] = r.thread.turns || [];
      for (let i = 0; i < turns.length; i++) {
        const hit = (turns[i].items || []).some((it: Json) => it.type === 'userMessage' && (it.content || []).filter((c: Json) => c.type === 'text').map((c: Json) => c.text).join('\n').trim() === text.trim());
        if (hit && ++seen === occurrence) return i === 0 ? null : turns[i - 1].id;
      }
      return undefined;
    },
    subagentTranscript: async (_id, agentId, dir) => {
      const r = await this.server.request('thread/read', { threadId: agentId, includeTurns: true });
      return convertMessages(threadMessages(r.thread.turns || []), dir);
    },
    list: async (dir) => {
      const r = await this.server.request('thread/list', { cwd: dir, limit: 100 }).catch(() => null);
      return (r?.data || []).map(this.info);
    },
    transcript: async (id, dir) => {
      const r = await this.server.request('thread/read', { threadId: id, includeTurns: true });
      return convertMessages(threadMessages(r.thread.turns || []), dir, true);
    },
    signature: async (id) => {
      const r = await this.server.request('thread/read', { threadId: id, includeTurns: false }).catch(() => null);
      return r?.thread ? `${r.thread.updatedAt}:${r.thread.status?.type}` : '';
    },
    live: async () => null
  };

  stop() { this.server.stop(); }
}

// ---------------------------------------------------------------- one session

class CodexHandle {
  readonly api: AgentHandle;
  private queue: AgentEvent[] = [];
  private waiters: ((r: IteratorResult<AgentEvent>) => void)[] = [];
  private ended = false;
  private isClosed = false;
  private threadId: string | null = null;
  private starting: Promise<void> | null = null;
  private turnId: string | null = null;
  private model: string;
  private effort?: Effort;
  private mode: PermMode;
  private inbox: { text: string; images: MessageImage[] }[] = [];
  /** File changes seen as an item started, so an approval request (which carries only the item id) can say which files. */
  private changes = new Map<string, Json[]>();
  private lastUsage: Json = null;
  /** Codex starts a helper by a tool call and the helper runs on in a thread of its own: which call started which thread, and which have ended. */
  private helpers = new Map<string, string>();
  private helpersDone = new Set<string>();

  constructor(private server: CodexServer, private o: AgentStartOptions, private register: (id: string, h: CodexHandle | null) => void, private billing: () => 'subscription' | 'api') {
    this.model = o.model;
    this.effort = o.effort;
    this.mode = o.permMode;
    const self = this;
    this.api = {
      get closed() { return self.isClosed; },
      events: { [Symbol.asyncIterator]: () => ({ next: () => self.next() }) },
      send: (text, images) => self.send(text, images),
      interrupt: () => self.interrupt(),
      setModel: async (m) => { self.model = m; },
      setEffort: async (e) => { self.effort = e ?? undefined; },
      setPermMode: async (m) => { self.mode = m; },
      close: () => self.close()
    };
  }

  private next(): Promise<IteratorResult<AgentEvent>> {
    const v = this.queue.shift();
    if (v) return Promise.resolve({ value: v, done: false });
    if (this.ended) return Promise.resolve({ value: undefined as any, done: true });
    return new Promise((r) => this.waiters.push(r));
  }

  push(e: AgentEvent) {
    const w = this.waiters.shift();
    if (w) w({ value: e, done: false }); else this.queue.push(e);
  }

  private end() {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined as any, done: true });
  }

  serverGone(why: string) {
    if (this.isClosed) return;
    this.push({ t: 'result', isError: true, text: why });
    this.turnId = null;
  }

  private fail(e: any) { this.push({ t: 'result', isError: true, text: String(e?.message || e) }); this.turnId = null; }

  private roots() { return [this.o.cwd, ...(this.o.extraDirs || [])]; }

  private async ensureThread() {
    if (this.threadId) return;
    this.starting ??= (async () => {
      const base: Json = {
        model: this.model, cwd: this.o.cwd, approvalPolicy: approvalFor(this.mode), sandbox: this.mode === 'all' ? 'danger-full-access' : this.mode === 'plan' ? 'read-only' : 'workspace-write',
        developerInstructions: this.o.systemAppend,
        config: {
          ...(this.o.env && Object.keys(this.o.env).length ? { shell_environment_policy: { inherit: 'all', set: this.o.env } } : {}),
          ...(this.o.mcpServers && Object.keys(this.o.mcpServers).length ? { mcp_servers: codexMcp(this.o.mcpServers) } : {}),
          // Codex counts threads, the session's own included, so N helpers is N + 1 (0 leaves only the session itself).
          ...(this.o.subagentLimit != null ? { agents: { max_concurrent_threads_per_session: this.o.subagentLimit + 1 } } : {})
        }
      };
      const r = this.o.resume ? await this.server.request('thread/resume', { threadId: this.o.resume, ...base }) : await this.server.request('thread/start', base);
      this.threadId = r.thread.id;
      this.register(this.threadId!, this);
      this.push({ t: 'init', sessionId: this.threadId!, model: r.model ?? this.model, billing: this.billing() });
    })();
    await this.starting;
  }

  send(text: string, images: MessageImage[] = []) {
    this.inbox.push({ text, images });
    void this.pump();
  }

  private pumping = false;
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.inbox.length && !this.isClosed) {
        const m = this.inbox.shift()!;
        await this.ensureThread();
        const input: Json[] = [
          ...m.images.map((i) => ({ type: 'image', url: `data:${i.mediaType};base64,${i.data}` })),
          { type: 'text', text: m.text || 'See the attached image.', text_elements: [] }
        ];
        if (this.turnId) {
          // A message while the agent is working goes into the turn that is running.
          await this.server.request('turn/steer', { threadId: this.threadId, input, expectedTurnId: this.turnId }).catch((e) => this.fail(e));
        } else {
          const r = await this.server.request('turn/start', {
            threadId: this.threadId, input, model: this.model, effort: effortFor(this.effort),
            approvalPolicy: approvalFor(this.mode), sandboxPolicy: sandboxFor(this.mode, this.roots())
          });
          this.turnId = r.turn?.id ?? null;
        }
      }
    } catch (e) { this.fail(e); } finally { this.pumping = false; }
  }

  private async interrupt() {
    if (this.threadId && this.turnId) await this.server.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => undefined);
  }

  private close() {
    if (this.isClosed) return;
    this.isClosed = true;
    void this.interrupt();
    if (this.threadId) this.register(this.threadId, null);
    this.end();
  }

  // ------------------------------------------------------------ what the server tells us
  notice(n: Notice) {
    const p = n.params;
    switch (n.method) {
      case 'turn/started': this.turnId = p.turn?.id ?? this.turnId; break;
      case 'thread/tokenUsage/updated': this.lastUsage = p.tokenUsage; break;
      case 'item/started': this.itemStarted(p.item); break;
      case 'item/completed': this.itemCompleted(p.item); break;
      case 'turn/completed': this.turnDone(p.turn); break;
    }
  }

  private itemStarted(item: Json) {
    if (item.type === 'fileChange') this.changes.set(item.id, item.changes || []);
    const uses = toolUsesOf(item);
    if (uses.length) this.push({ t: 'assistant', parentId: null, blocks: uses });
  }

  /** Tells helm about helpers Codex started, and when each one has finished. */
  private helperEvents(item: Json) {
    if (item.type === 'collabAgentToolCall') {
      if (item.tool === 'spawnAgent') {
        for (const child of item.receiverThreadIds || []) { this.helpers.set(child, item.id); this.push({ t: 'subagent_started', id: item.id, agentId: child }); }
      }
      for (const [child, st] of Object.entries<Json>(item.agentsStates || {})) this.helperEnded(child, st?.status, st?.message);
    } else if (item.type === 'subAgentActivity' && item.kind === 'completed') this.helperEnded(item.agentThreadId, 'completed');
  }

  private helperEnded(child: string, status?: string, message?: string | null) {
    const id = this.helpers.get(child);
    if (!id || this.helpersDone.has(child) || !status || ['pendingInit', 'running'].includes(status)) return;
    this.helpersDone.add(child);
    this.push({ t: 'subagent_done', id, status: status === 'completed' ? 'completed' : status === 'errored' || status === 'notFound' ? 'failed' : 'stopped', summary: message || undefined });
  }

  private itemCompleted(item: Json) {
    this.helperEvents(item);
    if (item.type === 'agentMessage' || item.type === 'plan') {
      const text = String(item.text || '').trim();
      if (text) this.push({ t: 'assistant', parentId: null, blocks: [{ type: 'text', text }] });
      return;
    }
    // An item that never announced itself (some arrive only when done) still shows up.
    if (!this.changes.has(item.id) && item.type === 'fileChange') this.push({ t: 'assistant', parentId: null, blocks: toolUsesOf(item) });
    const results = resultsOf(item);
    if (results.length) this.push({ t: 'tool_results', results });
  }

  private turnDone(turn: Json) {
    const u = this.lastUsage?.last;
    if (u) {
      const cached = u.cachedInputTokens ?? 0;
      this.push({ t: 'assistant', parentId: null, blocks: [], usage: { input: Math.max(0, (u.inputTokens ?? 0) - cached), output: u.outputTokens ?? 0, cacheWrite: u.cacheWriteInputTokens ?? 0, cacheRead: cached, contextWindow: this.lastUsage.modelContextWindow ?? undefined } });
    }
    this.turnId = null;
    this.changes.clear();
    this.push({ t: 'result', isError: turn?.status === 'failed', text: turn?.status === 'failed' ? String(turn.error?.message || 'The run failed') : '' });
    void this.pump();
  }

  async serverRequest(method: string, p: Json): Promise<Json> {
    const decide = async (tool: string, input: Record<string, unknown>, reason?: string | null): Promise<ToolDecision> =>
      this.o.canUseTool(tool, input, { decisionReason: reason ?? undefined });
    if (method === 'item/commandExecution/requestApproval') {
      const d = await decide('Bash', { command: p.command ?? '' }, p.reason);
      return { decision: d.behavior === 'allow' ? 'accept' : d.interrupt ? 'cancel' : 'decline' };
    }
    if (method === 'item/fileChange/requestApproval') {
      const first = (this.changes.get(p.itemId) || [])[0];
      const d = await decide(first?.kind?.type === 'add' ? 'Write' : 'Edit', { file_path: first?.path ?? p.grantRoot ?? '' }, p.reason);
      return { decision: d.behavior === 'allow' ? 'accept' : d.interrupt ? 'cancel' : 'decline' };
    }
    if (method === 'item/tool/requestUserInput') {
      const qs: Json[] = p.questions || [];
      const d = await decide('AskUserQuestion', { questions: qs.map((q) => ({ question: q.question, header: q.header, multiSelect: false, options: (q.options || []).map((o: Json) => ({ label: o.label, description: o.description })) })) });
      const answers: Record<string, { answers: string[] }> = {};
      if (d.behavior === 'allow') {
        const given = ((d as Json).updatedInput?.answers || {}) as Record<string, string>;
        for (const q of qs) answers[q.id] = { answers: [String(given[q.question] ?? '')] };
      }
      return { answers };
    }
    // Permissions beyond the sandbox, MCP prompts and the like: not offered yet, so refuse.
    if (method.endsWith('requestApproval')) return { decision: 'decline' };
    throw new Error('helm does not handle ' + method);
  }
}

