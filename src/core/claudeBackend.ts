import { forkSession, getSessionInfo, getSessionMessages, getSubagentMessages, listSessions, query, renameSession, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { AgentBackend, BackendAuth, AgentBlock, AgentCapabilities, AgentEvent, AgentHandle, AgentStartOptions, ConversationInfo, ConversationStore, PlanProbe, PlanWindow, ReviewOutcome, ReviewRequest } from './backend';
import { ClaudeAuth } from './claudeAuth';
import { fileExists } from './git';
import { convertMessages } from './transcript';
import { run } from './util';
import type { AgentLogin, Effort, MessageImage, ModelInfo, PermMode } from '../shared/types';


const sdkMode = (m: PermMode) => (m === 'plan' ? 'plan' : m === 'edits' ? 'acceptEdits' : m === 'all' ? 'bypassPermissions' : 'default') as 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default';

/** Input stream for a streaming-mode query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: ((r: IteratorResult<SDKUserMessage>) => void)[] = [];
  private closed = false;
  push(text: string, images: MessageImage[] = []) {
    const content: any = images.length
      ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text: text || 'See the attached image.' }]
      : text;
    const m: SDKUserMessage = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
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

const REVIEW_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git merge-base:*)', 'Bash(git status:*)', 'Bash(git blame:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(rg:*)', 'Bash(grep:*)'];

const toolText = (c: any): string => (typeof c === 'string' ? c : (c || []).map((x: any) => x.text || '').join('\n'));

/** Turns one Claude Agent SDK message into the events helm understands. */
export function claudeEvents(m: any): AgentEvent[] {
  if (m.type === 'system' && m.subtype === 'init') {
    return [{ t: 'init', sessionId: m.session_id, model: m.model, billing: m.apiKeySource === 'none' ? 'subscription' : 'api' }];
  }
  if (m.type === 'system' && m.subtype === 'task_started' && m.tool_use_id) return [{ t: 'subagent_started', id: m.tool_use_id, agentId: m.task_id }];
  if (m.type === 'system' && m.subtype === 'task_progress' && m.tool_use_id) {
    return [{ t: 'subagent_progress', id: m.tool_use_id, tools: m.usage?.tool_uses, tokens: m.usage?.total_tokens, lastTool: m.last_tool_name }];
  }
  if (m.type === 'system' && m.subtype === 'task_notification' && m.tool_use_id) {
    return [{ t: 'subagent_done', id: m.tool_use_id, status: m.status === 'completed' ? 'completed' : m.status === 'stopped' ? 'stopped' : 'failed', summary: m.summary ? String(m.summary) : undefined }];
  }
  if (m.type === 'rate_limit_event') {
    const info = m.rate_limit_info;
    if (!info) return [];
    const w = info.unifiedWindows || {};
    const pick = (key: string, type: string) => w[key] ?? (info.rateLimitType === type ? info : undefined);
    const win = (x: any): PlanWindow | undefined => (x?.utilization != null && x.resetsAt ? { util: x.utilization, resetsAt: x.resetsAt } : undefined);
    return [{ t: 'plan_usage', fiveHour: win(pick('five_hour', 'five_hour')), weekly: win(pick('seven_day', 'seven_day')) }];
  }
  if (m.type === 'assistant') {
    const u = m.message?.usage;
    const blocks: AgentBlock[] = [];
    for (const b of m.message?.content || []) {
      if (b.type === 'text' && b.text?.trim()) blocks.push({ type: 'text', text: b.text.trim() });
      else if (b.type === 'tool_use') blocks.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input || {} });
    }
    return [{
      t: 'assistant', parentId: m.parent_tool_use_id || null, blocks,
      usage: u ? { input: u.input_tokens || 0, output: u.output_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0 } : undefined
    }];
  }
  if (m.type === 'user') {
    const content = m.message?.content;
    if (!Array.isArray(content)) return [];
    const results = content.filter((b: any) => b.type === 'tool_result').map((b: any) => ({ id: b.tool_use_id, text: toolText(b.content), isError: !!b.is_error }));
    return results.length ? [{ t: 'tool_results', results }] : [];
  }
  if (m.type === 'result') {
    return [{ t: 'result', isError: !!m.is_error, text: m.is_error ? String(m.result || m.subtype || 'The run failed') : String(m.result || ''), costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined }];
  }
  return [];
}

/** Claude Code files a project's sessions under ~/.claude/projects/<path with every non-alphanumeric turned into a dash>. */
export const claudeProjectDir = (path: string) => join(homedir(), '.claude', 'projects', resolve(path).replace(/[^a-zA-Z0-9]/g, '-'));

const info = (x: any): ConversationInfo => ({
  id: x.sessionId, title: x.customTitle || undefined, summary: x.summary || undefined, firstPrompt: x.firstPrompt, cwd: x.cwd, branch: x.gitBranch,
  size: x.fileSize ?? 0, lastModified: x.lastModified ?? 0, createdAt: x.createdAt
});

const MODELS: ModelInfo[] = [
  { id: 'sonnet', label: 'Sonnet', price: [3, 15] },
  { id: 'opus', label: 'Opus', price: [15, 75] },
  { id: 'haiku', label: 'Haiku', price: [1, 5] }
];

export interface ClaudePaths {
  /** The executable the SDK should run, or nothing to use the SDK's own. */
  sdk(): string | undefined;
  /** The command-line tool to run for version checks, login and the list of live sessions, or nothing for `claude` on the PATH. */
  cli(): string | undefined;
}

export class ClaudeBackend implements AgentBackend {
  readonly id = 'claude';
  readonly label = 'Claude Code';
  readonly shortName = 'Claude';
  readonly identity = { name: 'Claude', email: 'noreply@anthropic.com' };
  readonly bundled = true;
  readonly models = MODELS;
  readonly capabilities: AgentCapabilities = { subagents: true, planMode: true, effort: true, fork: true, cost: true, planUsage: true };
  private login = new ClaudeAuth(() => this.paths.cli() || 'claude');
  /** A key in the environment, or none, is paid per token; a Claude login is a subscription. */
  private billed = (l: AgentLogin): AgentLogin => (l.loggedIn ? { ...l, billing: /api key/.test(l.method) ? 'api' : 'subscription' } : l);
  readonly auth: BackendAuth = {
    status: async () => this.billed(await this.login.status()),
    startLogin: async () => ({ ...(await this.login.startLogin()), needsCode: true }),
    submitCode: async (code) => this.billed(await this.login.submitCode(code)),
    cancel: () => this.login.cancel(),
    logout: async () => this.billed(await this.login.logout())
  };

  constructor(private paths: ClaudePaths) {}

  async version(path?: string): Promise<string | null> {
    try {
      const out = await run(path || this.paths.cli() || 'claude', ['--version'], { timeout: 8000 });
      return out.trim().split(/\s+/)[0] || null;
    } catch { return null; }
  }

  readonly conversations: ConversationStore = {
    info: async (id, dir) => {
      const i = await getSessionInfo(id, dir ? { dir } : undefined);
      return i ? info({ ...i, sessionId: id }) : null;
    },
    // Keeps Claude Code's own name in step, so the same session reads the same in VS Code.
    rename: (id, dir, title) => renameSession(id, title, { dir }),
    fork: async ({ sourceId, sourceDir, destDir, upToMessageId, title }) => {
      // The copy is written to the project folder of the source, then moved to the folder Claude Code uses for the new worktree.
      const forked = await forkSession(sourceId, { dir: sourceDir, upToMessageId, title });
      const file = forked.sessionId + '.jsonl';
      let from = join(claudeProjectDir(sourceDir), file);
      if (!(await fileExists(from))) {
        // The folder name is not always the plain encoding (long paths are shortened), so look for the file.
        const root = join(homedir(), '.claude', 'projects');
        from = '';
        for (const d of await readdir(root).catch(() => [] as string[])) if (await fileExists(join(root, d, file))) { from = join(root, d, file); break; }
      }
      if (!from) throw new Error('The copy of the conversation was made but could not be found on disk.');
      const to = join(claudeProjectDir(destDir), file);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      return forked.sessionId;
    },
    messageBefore: async (id, dir, text, occurrence) => {
      const msgs = (await getSessionMessages(id, { dir })) as any[];
      const body = (m: any) => {
        const c = m.message?.content;
        if (typeof c === 'string') return c;
        if (!Array.isArray(c) || c.some((b: any) => b.type === 'tool_result')) return null;
        return c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      };
      let seen = 0;
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].type !== 'user' || msgs[i].parent_tool_use_id) continue;
        const t = body(msgs[i]);
        if (t == null || t.trim() !== text.trim()) continue;
        if (++seen === occurrence) return i === 0 ? null : msgs[i - 1].uuid;
      }
      return undefined;
    },
    subagentTranscript: async (id, agentId, dir) => convertMessages((await getSubagentMessages(id, agentId, { dir })) as any[], dir),
    list: async (dir) => (await listSessions({ dir, includeWorktrees: true })).map(info),
    transcript: async (id, dir) => convertMessages((await getSessionMessages(id)) as any[], dir, true),
    signature: async (id) => { try { const i = await getSessionInfo(id); return i ? `${i.lastModified}:${i.fileSize}` : ''; } catch { return ''; } },
    live: async () => {
      try {
        const out = await run(this.paths.cli() || 'claude', ['agents', '--json'], { timeout: 8000 });
        return new Set((JSON.parse(out) as any[]).map((x) => x.sessionId));
      } catch { return null; }
    }
  };

  /** Asks Claude Code for the data behind its /usage command. It answers without a message being sent. */
  async planUsage(cwd: string): Promise<PlanProbe | null> {
    const idle = { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<never>>(() => undefined) }) };
    let q: any;
    try {
      const exe = this.paths.cli();
      q = query({ prompt: idle as any, options: { cwd, settingSources: [], ...(exe ? { pathToClaudeCodeExecutable: exe } : {}) } as any });
      const u: any = await Promise.race([
        q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20_000))
      ]);
      const rl = u.rate_limits;
      const win = (w: any): PlanWindow | undefined => (w && w.utilization != null && w.resets_at ? { util: w.utilization / 100, resetsAt: Date.parse(w.resets_at) / 1000 } : undefined);
      return { billing: u.subscription_type ? 'subscription' : 'api', ...(u.rate_limits_available && rl ? { fiveHour: win(rl.five_hour), weekly: win(rl.seven_day) } : {}) };
    } catch { return null; /* experimental API, or Claude Code isn't signed in: the events from sessions still update the meters */ }
    finally { try { q?.close(); } catch { /* already closed */ } }
  }

  start(o: AgentStartOptions): AgentHandle {
    const abort = new AbortController();
    const queue = new InputQueue();
    const options: any = {
      cwd: o.cwd,
      model: o.model,
      ...(o.effort ? { effort: o.effort } : {}),
      permissionMode: sdkMode(o.permMode),
      // Only permission to switch to Allow everything later in the conversation; the mode itself is what is chosen above.
      allowDangerouslySkipPermissions: true,
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
      ...(o.extraDirs?.length ? { additionalDirectories: o.extraDirs } : {}),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: o.systemAppend },
      canUseTool: (tool: string, input: Record<string, unknown>, d: any) => o.canUseTool(tool, input, d),
      hooks: {
        PreToolUse: [{
          matcher: 'Agent|Task',
          hooks: [async (input: any) => {
            const reason = await o.admitSubagent(String(input?.tool_use_id || ''));
            return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason + ' Wait for one to finish, or do this work yourself.' } } : {};
          }]
        }]
      },
      env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'helm', ...o.env }
    };
    if (o.mcpServers && Object.keys(o.mcpServers).length) options.mcpServers = o.mcpServers;
    // Only set when on, so a user's own Claude Code setting is never switched off by helm.
    if (o.remoteControl) options.settings = { remoteControlAtStartup: true };
    const exe = this.paths.sdk();
    if (exe) options.pathToClaudeCodeExecutable = exe;
    if (o.resume) options.resume = o.resume;
    const q: Query = query({ prompt: queue, options });
    let closed = false;
    return {
      get closed() { return closed; },
      events: (async function* () { for await (const m of q as AsyncIterable<any>) yield* claudeEvents(m); })(),
      send: (text, images) => queue.push(text, images),
      interrupt: () => q.interrupt().catch(() => undefined),
      setModel: (model) => q.setModel(model).catch(() => undefined),
      // Applies to the running conversation when Claude Code accepts it; the caller keeps the value for every later start either way.
      setEffort: (effort) => q.applyFlagSettings({ effortLevel: effort ?? undefined } as any).catch(() => undefined),
      setPermMode: (mode) => q.setPermissionMode(sdkMode(mode)).catch(() => undefined),
      close: () => { closed = true; queue.close(); abort.abort(); }
    };
  }

  async review(req: ReviewRequest): Promise<ReviewOutcome> {
    let structured: unknown, text = '', cost = 0, failure = '';
    let q: Query | undefined;
    try {
      const options: any = {
        cwd: req.cwd, model: req.model, maxTurns: 30, permissionMode: 'dontAsk', settingSources: ['user', 'project', 'local'],
        allowedTools: REVIEW_TOOLS,
        disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Agent', 'Task'],
        outputFormat: { type: 'json_schema', schema: req.schema },
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'helm' }
      };
      const exe = this.paths.sdk();
      if (exe) options.pathToClaudeCodeExecutable = exe;
      q = query({ prompt: req.prompt, options });
      for await (const m of q as AsyncIterable<any>) {
        if (m.type !== 'result') continue;
        structured = m.structured_output;
        text = String(m.result || '');
        cost = Number(m.total_cost_usd) || 0;
        if (m.is_error) failure = text || String(m.subtype || 'The reviewer stopped early');
      }
    } catch (e: any) { failure = String(e?.message || e); }
    finally { try { q?.close(); } catch { /* already closed */ } }
    return { structured, text, cost, failure };
  }
}
