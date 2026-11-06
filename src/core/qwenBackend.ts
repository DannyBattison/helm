import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { join } from 'node:path';
import type { AgentBackend, AgentBlock, AgentCapabilities, AgentEvent, AgentHandle, AgentStartOptions, ReviewOutcome, ReviewRequest, ToolDecision } from './backend';
import type { LocalModel, LocalRuntime, MessageImage, ModelInfo, PermMode, RecommendedModel } from '../shared/types';
import { run } from './util';

/**
 * Qwen Code (`qwen`) run against a model on this computer, through the Agent Client Protocol: JSON-RPC 2.0 as one JSON object per
 * line on stdio. The model is served by Ollama (or anything with an OpenAI-compatible API); nothing leaves the machine and nothing
 * is metered, so there is no sign-in, no plan and no cost. One `qwen` process per session.
 * Written from the protocol's documentation and tested against a stand-in; see spike/qwen/README.md for what a real run has to confirm.
 */

type Json = any;

export interface QwenPaths {
  /** The `qwen` executable. */
  cli(): string | undefined;
  /** Where the OpenAI-compatible server is; empty for Ollama's default. */
  url(): string | undefined;
  /** Context window to give models, in tokens. */
  context(): number;
  /** Where helm keeps its files, for a settings file of its own for Qwen Code. */
  dataDir?(): string | undefined;
}

/**
 * Qwen Code keeps some tools "on demand": the model has to find one with `tool_search` and call it through a `tool_call` wrapper,
 * and small models call the wrapper with nothing. Taking those two away makes it offer its tools directly. It then offers all thirty
 * or so, most of them for things helm does itself (helpers, worktrees, scheduling) or that a small model only gets lost in, so those
 * are taken away too and what is left is files, search, the shell and web fetch. This goes in a settings file of helm's own, handed
 * over with an environment variable, so the user's own Qwen settings are left alone.
 */
export const QWEN_SETTINGS = {
  tools: {
    exclude: ['tool_call', 'tool_search', 'agent', 'skill', 'enter_plan_mode', 'exit_plan_mode', 'enter_worktree', 'exit_worktree', 'get_goal', 'update_goal', 'list_agents', 'send_message', 'task_stop', 'record_artifact', 'report_findings', 'notebook_edit', 'cron_create', 'cron_delete', 'cron_list', 'loop_wakeup', 'monitor', 'autofix_pr', 'read_mcp_resource', 'lsp', 'memory']
  }
};
async function settingsFile(dir: string | undefined): Promise<string | undefined> {
  if (!dir) return undefined;
  const f = join(dir, 'qwen-settings.json');
  try { await mkdir(dir, { recursive: true }); await writeFile(f, JSON.stringify(QWEN_SETTINGS, null, 2)); return f; } catch { return undefined; }
}

export const DEFAULT_OLLAMA = 'http://localhost:11434';
const base = (u?: string) => (u || DEFAULT_OLLAMA).replace(/\/+$/, '').replace(/\/v1$/, '');

/** Models worth offering, by the memory they need. Ollama's names; sizes are approximate downloads. */
export const RECOMMENDED: RecommendedModel[] = [
  { name: 'qwen3-coder:30b', label: 'Qwen3 Coder 30B', sizeGb: 19, minRamGb: 32, note: 'Built for agent work. The best choice if it fits.' },
  { name: 'qwen2.5-coder:14b', label: 'Qwen2.5 Coder 14B', sizeGb: 9, minRamGb: 16, note: 'Good for small edits; tool use is less dependable.' },
  { name: 'qwen3:8b', label: 'Qwen3 8B', sizeGb: 5.2, minRamGb: 8, note: 'For small machines. Expect it to struggle with long tasks.' }
];

/**
 * Where an executable is: an app started from a desktop icon does not see the PATH a terminal has, and a program installed since helm
 * started is not on the PATH helm started with, so look where the usual installers put things as well.
 */
export function findExe(name: string, configured?: string): string {
  if (configured) return configured;
  const win = process.platform === 'win32';
  const names = win ? [name + '.exe', name + '.cmd'] : [name];
  const dirs = [...(process.env.PATH || '').split(win ? ';' : ':'), '/opt/homebrew/bin', '/usr/local/bin', '/Applications/Ollama.app/Contents/Resources', join(homedir(), '.local/bin'), join(homedir(), '.npm-global/bin'), join(homedir(), '.volta/bin'), join(homedir(), '.bun/bin'), win ? join(process.env.APPDATA || '', 'npm') : '', win ? join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama') : ''].filter(Boolean);
  for (const d of dirs) for (const n of names) { const f = join(d, n); if (existsSync(f)) return f; }
  return names[names.length - 1];
}
const isScript = (exe: string) => /\.[cm]?js$/i.test(exe);
const launch = (exe: string, args: string[], env: NodeJS.ProcessEnv, opts: { detached?: boolean; cwd?: string } = {}): ChildProcess =>
  isScript(exe)
    ? spawn(process.execPath, [exe, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, ...opts })
    : spawn(exe, args, { stdio: ['pipe', 'pipe', 'pipe'], env, shell: process.platform === 'win32', windowsHide: true, ...opts });

// ---------------------------------------------------------------- the local model server

const get = async (url: string, ms = 3000): Promise<Json> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
};

/** Derived copies helm makes to give a model a larger context window. They are not offered as models of their own. */
const DERIVED = /-helm\d+k$/;
const derivedName = (model: string, context: number) => `${model}-helm${Math.round(context / 1024)}k`;

export async function localModels(url?: string): Promise<LocalModel[]> {
  const r = await get(base(url) + '/api/tags');
  return (r.models || []).map((m: Json) => ({ name: String(m.name), sizeGb: Math.round(((m.size || 0) / 1e9) * 10) / 10 })).filter((m: LocalModel) => !DERIVED.test(m.name));
}

/** Downloads a model, reporting what percentage is done. Rejects with Ollama's reason if it fails. */
export async function pullModel(url: string | undefined, name: string, progress: (status: string, percent: number) => void): Promise<void> {
  const r = await fetch(base(url) + '/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name, stream: true }) });
  if (!r.ok || !r.body) throw new Error(`Ollama refused to pull ${name} (${r.status}).`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body as any as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m: Json;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.error) throw new Error(String(m.error));
      progress(String(m.status || ''), m.total ? Math.round(((m.completed || 0) / m.total) * 100) : 0);
    }
  }
}

export async function removeModel(url: string | undefined, name: string): Promise<void> {
  const r = await fetch(base(url) + '/api/delete', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name }) });
  if (!r.ok) throw new Error(`Ollama could not remove ${name} (${r.status}).`);
}

/**
 * The name to run a model under so it has `context` tokens to work with. Ollama's default window is small, and an agent's prompt
 * overflows it without any error, so helm makes a copy of the model with a larger one. Falls back to the model itself.
 */
export async function withContext(url: string | undefined, model: string, context: number): Promise<string> {
  if (!context || DERIVED.test(model)) return model;
  const name = derivedName(model, context);
  try {
    const have = await get(base(url) + '/api/tags');
    if ((have.models || []).some((m: Json) => m.name === name)) return name;
    const r = await fetch(base(url) + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: name, from: model, parameters: { num_ctx: context }, stream: false }), signal: AbortSignal.timeout(120_000) });
    return r.ok ? name : model;
  } catch { return model; }
}

/** Whether Ollama answers, and whether it is installed at all. */
export async function runtimeState(url?: string): Promise<'missing' | 'stopped' | 'running'> {
  try { await get(base(url) + '/api/version', 1500); return 'running'; } catch { /* not answering */ }
  try { await run(findExe('ollama'), ['--version'], { timeout: 5000 }); return 'stopped'; } catch { return 'missing'; }
}

/** Starts `ollama serve` and leaves it running when helm closes. */
export async function startRuntime(url: string | undefined, context: number): Promise<void> {
  if ((await runtimeState(url)) === 'running') return;
  const p = launch(findExe('ollama'), ['serve'], { ...process.env, OLLAMA_CONTEXT_LENGTH: String(context) }, { detached: true });
  p.on('error', () => undefined);
  p.stdout?.on('data', () => undefined);
  p.stderr?.on('data', () => undefined);
  p.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if ((await runtimeState(url)) === 'running') return;
  }
  throw new Error('Ollama did not start. Try running `ollama serve` in a terminal.');
}

export const ramGb = () => Math.round(totalmem() / 2 ** 30);

// ---------------------------------------------------------------- mapping ACP onto helm's vocabulary

/** helm's permission modes as Qwen Code names them. */
export const modeFor = (m: PermMode) => (m === 'all' ? 'yolo' : m === 'edits' ? 'auto-edit' : m === 'plan' ? 'plan' : 'default');

/** helm's stored MCP servers as ACP session parameters. */
export function acpMcp(servers: Record<string, Json>): Json[] {
  const pairs = (o?: Record<string, string>, k = 'name') => Object.entries(o || {}).map(([name, value]) => ({ [k]: name, value }));
  return Object.entries(servers).map(([name, s]) => (s.type === 'http' || s.type === 'sse' || s.url
    ? { type: s.type === 'sse' ? 'sse' : 'http', name, url: s.url, headers: pairs(s.headers) }
    : { name, command: s.command, args: s.args || [], env: pairs(s.env) }));
}

const textOf = (content: Json[] | undefined): string => (content || []).map((c) => (c?.type === 'content' && c.content?.type === 'text' ? c.content.text : c?.type === 'diff' ? `${c.path}` : '')).filter(Boolean).join('\n');

/** Qwen Code's tools by name, where the kind ACP gives is too coarse. */
const BY_NAME: Record<string, string> = { web_fetch: 'WebFetch', web_search: 'WebSearch', todo_write: 'TodoWrite', glob: 'Glob', grep_search: 'Grep' };

/** A tool call as Claude Code's vocabulary names it, which is what the rest of helm understands. */
export function toolUseOf(call: Json): { name: string; input: Record<string, any> } {
  const raw: Json = call.rawInput || {};
  const own: string | undefined = call._meta?.toolName;
  // The wrapper for on-demand tools names the real one in its arguments.
  if (own === 'tool_call' && typeof raw.name === 'string') return toolUseOf({ ...call, _meta: { ...call._meta, toolName: raw.name }, rawInput: raw.arguments ?? raw.params ?? {}, kind: undefined, title: raw.name });
  const loc: string | undefined = call.locations?.[0]?.path ?? raw.file_path ?? raw.path ?? raw.absolute_path;
  const diff = (call.content || []).find((c: Json) => c?.type === 'diff');
  if (own && BY_NAME[own]) {
    if (own === 'web_fetch') return { name: 'WebFetch', input: { url: raw.url ?? '', prompt: raw.prompt ?? '' } };
    if (own === 'web_search') return { name: 'WebSearch', input: { query: raw.query ?? '' } };
    if (own === 'todo_write') return { name: 'TodoWrite', input: { todos: raw.todos ?? [] } };
    return { name: BY_NAME[own], input: { pattern: raw.pattern ?? raw.query ?? '', ...(loc ? { path: loc } : {}) } };
  }
  switch (call.kind) {
    case 'execute': return { name: 'Bash', input: { command: raw.command ?? '' } };
    case 'edit':
      if (diff) return diff.oldText == null || diff.oldText === '' ? { name: 'Write', input: { file_path: diff.path, content: diff.newText ?? '' } } : { name: 'Edit', input: { file_path: diff.path, old_string: diff.oldText, new_string: diff.newText ?? '' } };
      return { name: raw.content != null ? 'Write' : 'Edit', input: { file_path: loc ?? '', ...(raw.content != null ? { content: raw.content } : { old_string: raw.old_string ?? '', new_string: raw.new_string ?? '' }) } };
    case 'delete': return { name: 'Bash', input: { command: `rm ${loc ?? ''}` } };
    case 'move': return { name: 'Bash', input: { command: `mv ${raw.source ?? loc ?? ''} ${raw.destination ?? ''}`.trim() } };
    case 'read': return { name: 'Read', input: { file_path: loc ?? '' } };
    case 'search': return { name: raw.glob || /glob/i.test(call.title || '') ? 'Glob' : 'Grep', input: { pattern: raw.pattern ?? raw.query ?? raw.glob ?? '', ...(loc ? { path: loc } : {}) } };
    case 'fetch': return { name: 'WebFetch', input: { url: raw.url ?? '', prompt: raw.prompt ?? '' } };
    default: return { name: String(call.title || own || 'Tool'), input: raw };
  }
}

/** Qwen Code's stop reasons: only a refusal or a step limit count as a failed turn. */
const failedStop = (r: string) => r === 'refusal' || r === 'max_turn_requests' || r === 'max_tokens';

// ---------------------------------------------------------------- the connection to one qwen process

class AcpConnection {
  private proc: ChildProcess;
  private id = 0;
  private pending = new Map<number, { resolve(v: Json): void; reject(e: Error): void }>();
  private buf = '';
  private dead = false;
  stderr = '';
  onNotification: (method: string, params: Json) => void = () => undefined;
  onRequest: (method: string, params: Json) => Promise<Json> = async () => { throw new Error('not handled'); };
  onExit: (why: string) => void = () => undefined;

  constructor(exe: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
    const p = launch(exe, args, env, { cwd });
    this.proc = p;
    p.stdout!.on('data', (d) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (line.trim()) { try { this.handle(JSON.parse(line)); } catch { /* not a message: a banner, say */ } }
      }
    });
    p.stderr!.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    p.stdin!.on('error', () => undefined);
    const gone = (why: string) => {
      if (this.dead) return;
      this.dead = true;
      for (const w of this.pending.values()) w.reject(new Error(why));
      this.pending.clear();
      this.onExit(why);
    };
    p.on('error', (e) => gone(`Qwen Code could not be started: ${e.message}. Is it installed?`));
    p.on('exit', (code) => gone(`Qwen Code stopped (exit ${code})${this.stderr.trim() ? ': ' + this.stderr.trim().split('\n').pop() : ''}`));
  }

  private write(m: Json) { if (!this.dead) this.proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n'); }
  notify(method: string, params?: Json) { this.write({ method, params }); }
  call(method: string, params?: Json): Promise<Json> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('Qwen Code is not running'));
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }
  kill() { this.dead = true; for (const w of this.pending.values()) w.reject(new Error('closed')); this.pending.clear(); this.proc.kill(); }

  private handle(m: Json) {
    if (m.id != null && m.method == null) {
      const w = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (m.error) w?.reject(Object.assign(new Error(m.error.message || 'Qwen Code request failed'), { code: m.error.code }));
      else w?.resolve(m.result);
    } else if (m.id != null && m.method) {
      this.onRequest(m.method, m.params).then(
        (result) => this.write({ id: m.id, result }),
        (e) => this.write({ id: m.id, error: { code: e?.code ?? -32601, message: String(e?.message || e) } })
      );
    } else if (m.method) this.onNotification(m.method, m.params);
  }
}

// ---------------------------------------------------------------- the backend

export class QwenBackend implements AgentBackend {
  readonly id = 'qwen';
  readonly label = 'Qwen Code (local)';
  readonly shortName = 'Qwen';
  readonly identity = { name: 'Qwen', email: 'noreply@qwen.ai' };
  models: ModelInfo[] = [];
  readonly capabilities: AgentCapabilities = { subagents: false, planMode: true, effort: false, fork: false, cost: false, planUsage: false };
  private installed: string | null = null;
  private state: LocalRuntime['state'] = 'missing';
  private pulls = new Map<string, { status: string; percent: number; error?: string }>();
  private installedModels: LocalModel[] = [];

  constructor(private paths: QwenPaths) {}

  async refresh() {
    this.state = await runtimeState(this.paths.url());
    if (this.state !== 'running') { this.installedModels = []; this.models = []; return; }
    try {
      this.installedModels = await localModels(this.paths.url());
      this.models = this.installedModels.map((m) => ({ id: m.name, label: m.name, price: [0, 0] as [number, number] }));
    } catch { /* keep what we had */ }
  }

  async version(path?: string): Promise<string | null> {
    try {
      const exe = findExe('qwen', path || this.paths.cli());
      const out = isScript(exe) ? await run(process.execPath, [exe, '--version'], { timeout: 8000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }) : await run(exe, ['--version'], { timeout: 8000 });
      this.installed = out.trim().split(/\s+/).pop() || null;
    } catch { this.installed = null; }
    return this.installed;
  }

  /** Why it cannot be used yet, or null when it can. */
  setupNeeded(): string | null {
    if (this.installed === null) return 'Qwen Code is not installed. Install it with `npm install -g @qwen-code/qwen-code`.';
    if (this.state === 'missing') return 'No local model server was found. Install Ollama from ollama.com.';
    if (this.state === 'stopped') return 'The local model server is not running. Start it under Accounts → Qwen Code.';
    if (!this.models.length) return 'No model has been downloaded yet. Download one under Accounts → Qwen Code.';
    return null;
  }

  // ------------------------------------------------------------ the local runtime, for Settings
  async runtime(): Promise<LocalRuntime> {
    await this.refresh();
    const ram = ramGb();
    return {
      state: this.state, url: base(this.paths.url()), ramGb: ram, context: this.paths.context(),
      models: this.installedModels,
      recommended: RECOMMENDED.map((r) => ({ ...r, fits: ram >= r.minRamGb })),
      pulls: [...this.pulls].map(([name, p]) => ({ name, ...p }))
    };
  }
  async startRuntime() { await startRuntime(this.paths.url(), this.paths.context()); await this.refresh(); }
  pull(name: string) {
    if (this.pulls.get(name) && !this.pulls.get(name)!.error && this.pulls.get(name)!.percent < 100) return;
    this.pulls.set(name, { status: 'starting', percent: 0 });
    void pullModel(this.paths.url(), name, (status, percent) => this.pulls.set(name, { status, percent }))
      .then(() => { this.pulls.delete(name); return this.refresh(); })
      .catch((e) => this.pulls.set(name, { status: 'failed', percent: 0, error: String(e?.message || e) }));
  }
  dismissPull(name: string) { this.pulls.delete(name); }
  async removeModel(name: string) { await removeModel(this.paths.url(), name); await this.refresh(); }

  // ------------------------------------------------------------ sessions
  start(o: AgentStartOptions): AgentHandle {
    return new QwenHandle(this.paths, o, (m) => withContext(this.paths.url(), m, this.paths.context())).api;
  }

  async review(req: ReviewRequest): Promise<ReviewOutcome> {
    const h = new QwenHandle(this.paths, { cwd: req.cwd, model: req.model, permMode: 'plan', systemAppend: '', canUseTool: async () => ({ behavior: 'deny', message: 'This is a read-only review.' }), admitSubagent: async () => 'no helpers in a review' }, (m) => withContext(this.paths.url(), m, this.paths.context())).api;
    let text = '', failure = '';
    h.send(`${req.prompt}\n\nReply with only JSON that matches this schema:\n${JSON.stringify(req.schema)}`);
    for await (const e of h.events) {
      if (e.t === 'assistant') for (const b of e.blocks) if (b.type === 'text') text += b.text;
      if (e.t === 'result') { if (e.isError) failure = e.text; break; }
    }
    h.close();
    let structured: unknown;
    try { structured = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* parseReview copes with prose */ }
    return { structured, text, cost: 0, failure };
  }
}

// ---------------------------------------------------------------- one session

class QwenHandle {
  readonly api: AgentHandle;
  private queue: AgentEvent[] = [];
  private waiters: ((r: IteratorResult<AgentEvent>) => void)[] = [];
  private ended = false;
  private isClosed = false;
  private conn: AcpConnection | null = null;
  private sessionId: string | null;
  private fresh: boolean;
  private model: string;
  private mode: PermMode;
  private respawn = false;
  private inbox: { text: string; images: MessageImage[] }[] = [];
  private pumping = false;
  private turn = false;
  private text = '';
  private loadSession = false;

  constructor(private paths: QwenPaths, private o: AgentStartOptions, private prepare: (model: string) => Promise<string>) {
    this.model = o.model;
    this.mode = o.permMode;
    this.sessionId = o.resume ?? null;
    this.fresh = !o.resume;
    const self = this;
    this.api = {
      get closed() { return self.isClosed; },
      events: { [Symbol.asyncIterator]: () => ({ next: () => self.next() }) },
      send: (text, images) => { self.inbox.push({ text, images: images || [] }); void self.pump(); },
      interrupt: async () => { if (self.conn && self.sessionId && self.turn) self.conn.notify('session/cancel', { sessionId: self.sessionId }); },
      // The model is fixed when the process starts, so a change takes effect by starting it again before the next message.
      setModel: async (m) => { if (m !== self.model) { self.model = m; self.respawn = true; } },
      setEffort: async () => undefined,
      setPermMode: async (m) => { self.mode = m; if (self.conn && self.sessionId) await self.conn.call('session/set_mode', { sessionId: self.sessionId, modeId: modeFor(m) }).catch(() => undefined); },
      close: () => self.close()
    };
  }

  private next(): Promise<IteratorResult<AgentEvent>> {
    const v = this.queue.shift();
    if (v) return Promise.resolve({ value: v, done: false });
    if (this.ended) return Promise.resolve({ value: undefined as any, done: true });
    return new Promise((r) => this.waiters.push(r));
  }
  private push(e: AgentEvent) { const w = this.waiters.shift(); if (w) w({ value: e, done: false }); else this.queue.push(e); }
  private end() { this.ended = true; for (const w of this.waiters.splice(0)) w({ value: undefined as any, done: true }); }
  private fail(e: any) { this.turn = false; this.push({ t: 'result', isError: true, text: String(e?.message || e) }); }

  private close() {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.conn && this.sessionId && this.turn) this.conn.notify('session/cancel', { sessionId: this.sessionId });
    this.conn?.kill();
    this.conn = null;
    this.end();
  }

  /** Starts qwen, and opens or reloads the conversation. */
  private async connect() {
    if (this.conn && !this.respawn) return;
    if (this.conn) { this.conn.kill(); this.conn = null; }
    this.respawn = false;
    const model = await this.prepare(this.model);
    const exe = findExe('qwen', this.paths.cli());
    const url = base(this.paths.url()) + '/v1';
    const args = ['--acp', ...(this.o.extraDirs || []).flatMap((d) => ['--include-directories', d])];
    const settings = await settingsFile(this.paths.dataDir?.());
    const conn = new AcpConnection(exe, args, { ...process.env, ...this.o.env, ...(settings ? { QWEN_CODE_SYSTEM_SETTINGS_PATH: settings } : {}), OPENAI_BASE_URL: url, OPENAI_API_KEY: process.env.OPENAI_API_KEY || 'ollama', OPENAI_MODEL: model }, this.o.cwd);
    this.conn = conn;
    conn.onNotification = (m, p) => this.update(m, p);
    conn.onRequest = (m, p) => this.agentRequest(m, p);
    conn.onExit = (why) => { if (this.conn === conn) { this.conn = null; if (!this.isClosed && this.turn) this.fail(why); } };
    const init = await conn.call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'helm', title: 'helm', version: '0' } });
    this.loadSession = !!init?.agentCapabilities?.loadSession;
    // Qwen Code asks to be told how it is authenticated; a local server needs no account, so pick the OpenAI-compatible method.
    const methods: Json[] = init?.authMethods || [];
    if (methods.length) {
      const m = methods.find((x) => /openai/i.test(String(x.id))) ?? methods[0];
      await conn.call('authenticate', { methodId: m.id });
    }
    const mcpServers = acpMcp(this.o.mcpServers || {});
    if (this.sessionId && this.loadSession) await conn.call('session/load', { sessionId: this.sessionId, cwd: this.o.cwd, mcpServers });
    else {
      const r = await conn.call('session/new', { cwd: this.o.cwd, mcpServers });
      this.sessionId = r.sessionId;
      this.fresh = true;
    }
    await conn.call('session/set_mode', { sessionId: this.sessionId, modeId: modeFor(this.mode) }).catch(() => undefined);
    this.push({ t: 'init', sessionId: this.sessionId!, model: this.model, billing: 'api' });
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.inbox.length && !this.isClosed) {
        const m = this.inbox.shift()!;
        await this.connect();
        if (this.isClosed) return;
        // ACP has no field for instructions, so a new conversation starts with them in its first message.
        const lead = this.fresh && this.o.systemAppend ? `${this.o.systemAppend}\n\n---\n\n` : '';
        this.fresh = false;
        const prompt: Json[] = [...m.images.map((i) => ({ type: 'image', mimeType: i.mediaType, data: i.data })), { type: 'text', text: lead + (m.text || 'See the attached image.') }];
        this.turn = true;
        this.text = '';
        const r = await this.conn!.call('session/prompt', { sessionId: this.sessionId, prompt });
        this.flush();
        this.turn = false;
        const stop = String(r?.stopReason || 'end_turn');
        this.push({ t: 'result', isError: failedStop(stop), text: failedStop(stop) ? `Qwen Code stopped: ${stop.replace(/_/g, ' ')}.` : '' });
      }
    } catch (e) { if (!this.isClosed) this.fail(e); } finally { this.pumping = false; }
  }

  /** What the model has said so far becomes one text block, so it stays in order with the tool calls around it. */
  private flush() {
    const t = this.text.trim();
    this.text = '';
    if (t) this.push({ t: 'assistant', parentId: null, blocks: [{ type: 'text', text: t }] });
  }

  /** Tool calls as Qwen has described them so far. It announces a call before it knows the arguments, so the card waits for them. */
  private calls = new Map<string, Json>();
  private shownCalls = new Set<string>();
  private done = new Set<string>();
  private window = 0;

  private merge(u: Json) {
    const had = this.calls.get(u.toolCallId) || {};
    const next = { ...had };
    for (const k of ['title', 'kind', 'content', 'locations', 'rawInput', '_meta', 'status']) if (u[k] !== undefined && !(k === 'content' && !u[k]?.length)) next[k] = k === '_meta' ? { ...(had._meta || {}), ...u._meta } : u[k];
    this.calls.set(u.toolCallId, next);
    return next;
  }

  private showCall(id: string) {
    if (this.shownCalls.has(id)) return;
    this.shownCalls.add(id);
    this.flush();
    const t = toolUseOf(this.calls.get(id) || {});
    this.push({ t: 'assistant', parentId: null, blocks: [{ type: 'tool_use', id, name: t.name, input: t.input }] });
  }

  private update(method: string, p: Json) {
    if (method !== 'session/update' || p?.sessionId !== this.sessionId) return;
    const u = p.update || {};
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        if (u.content?.type === 'text') this.text += u.content.text;
        // Each model call reports its own tokens as it ends.
        const t = u._meta?.usage;
        if (t) this.push({ t: 'assistant', parentId: null, blocks: [], usage: { input: Math.max(0, (t.inputTokens ?? 0) - (t.cachedReadTokens ?? 0)), output: (t.outputTokens ?? 0) + (t.thoughtTokens ?? 0), cacheWrite: 0, cacheRead: t.cachedReadTokens ?? 0, contextWindow: this.window || undefined } });
        break;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const c = this.merge(u);
        if (u.status === 'completed' || u.status === 'failed') { this.showCall(u.toolCallId); this.finished(u, c); }
        else if (c.rawInput && Object.keys(c.rawInput).length) this.showCall(u.toolCallId);
        break;
      }
      case 'usage_update': if (Number(u.size)) this.window = Number(u.size); break;
    }
  }

  private finished(u: Json, c: Json) {
    if (this.done.has(u.toolCallId)) return;
    this.done.add(u.toolCallId);
    const text = textOf(u.content) || (u.rawOutput != null ? (typeof u.rawOutput === 'string' ? u.rawOutput : u.rawOutput.text ?? JSON.stringify(u.rawOutput)) : '');
    this.push({ t: 'tool_results', results: [{ id: u.toolCallId, text, isError: (u.status ?? c.status) === 'failed' }] });
  }

  private async agentRequest(method: string, p: Json): Promise<Json> {
    if (method !== 'session/request_permission') throw Object.assign(new Error('helm does not handle ' + method), { code: -32601 });
    const call: Json = this.merge(p.toolCall || {});
    if (p.toolCall?.toolCallId) this.showCall(p.toolCall.toolCallId);
    const t = toolUseOf(call);
    const d: ToolDecision = await this.o.canUseTool(t.name, t.input, { description: call.title });
    const options: Json[] = p.options || [];
    const pick = (...kinds: string[]) => kinds.map((k) => options.find((o) => o.kind === k)).find(Boolean);
    if (d.behavior === 'allow') {
      const o = pick('allow_once', 'allow_always');
      return o ? { outcome: { outcome: 'selected', optionId: o.optionId } } : { outcome: { outcome: 'cancelled' } };
    }
    if (d.interrupt) return { outcome: { outcome: 'cancelled' } };
    const o = pick('reject_once', 'reject_always');
    return o ? { outcome: { outcome: 'selected', optionId: o.optionId } } : { outcome: { outcome: 'cancelled' } };
  }
}
