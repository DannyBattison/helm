import { query, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Effort, MessageImage, ModelAlias, PermMode } from '../shared/types';

/**
 * What helm needs from an agent, whichever one it is. SessionManager talks only to this file's types; everything specific
 * to the Claude Agent SDK (message shapes, option names, hooks) stays inside ClaudeBackend.
 */

/** Token counts for one model call. `cacheWrite` is input that was written to the prompt cache, billed like input. */
export interface AgentUsage { input: number; output: number; cacheWrite: number; cacheRead: number }

export type AgentBlock =
  | { type: 'text'; text: string }
  /** `name` and `input` follow Claude Code's tool vocabulary (Bash, Edit, Write, Read, Agent …); another backend maps its own tools onto it. */
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> };

export interface AgentToolResult { id: string; text: string; isError: boolean }

/** A usage window on a subscription plan. `util` is 0..1 and `resetsAt` is in epoch seconds. */
export interface PlanWindow { util: number; resetsAt: number }

/** What an agent reports as it works. */
export type AgentEvent =
  | { t: 'init'; sessionId: string; model: string; billing?: 'subscription' | 'api' }
  /** `parentId` is the tool call of the subagent that produced this, when it was not the session's own agent. */
  | { t: 'assistant'; parentId: string | null; usage?: AgentUsage; blocks: AgentBlock[] }
  | { t: 'tool_results'; results: AgentToolResult[] }
  | { t: 'subagent_started'; id: string; agentId: string }
  | { t: 'subagent_progress'; id: string; tools?: number; tokens?: number; lastTool?: string }
  | { t: 'subagent_done'; id: string; status: 'completed' | 'failed' | 'stopped'; summary?: string }
  | { t: 'plan_usage'; fiveHour?: PlanWindow; weekly?: PlanWindow }
  /** The end of a turn. `costUsd` is the running total for the whole session when the agent reports one. */
  | { t: 'result'; isError: boolean; text: string; costUsd?: number };

export type ToolDecision =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

export interface AgentStartOptions {
  cwd: string;
  model: ModelAlias;
  effort?: Effort;
  permMode: PermMode;
  /** Appended to the agent's own system prompt. */
  systemAppend: string;
  /** The agent's conversation to continue, from an earlier `init` event. */
  resume?: string;
  /** Extra environment for anything the agent runs, such as the git author. */
  env?: Record<string, string>;
  remoteControl?: boolean;
  /** Asked before a tool runs, to let the user decide. */
  canUseTool(tool: string, input: Record<string, unknown>, detail: { decisionReason?: string; description?: string }): Promise<ToolDecision>;
  /** Asked before a subagent starts. Returns why it may not, or nothing to let it start. */
  admitSubagent(toolUseId: string): Promise<string | undefined>;
}

/** A running agent conversation. */
export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  /** True once `close` has been called, so a stream that ends with an error can tell a stop from a failure. */
  readonly closed: boolean;
  send(text: string, images?: MessageImage[]): void;
  interrupt(): Promise<void>;
  setModel(model: ModelAlias): Promise<void>;
  setEffort(effort: Effort | null): Promise<void>;
  setPermMode(mode: PermMode): Promise<void>;
  /** Ends the conversation: no more input, and whatever is running is cancelled. */
  close(): void;
}

export interface ReviewRequest { cwd: string; model: ModelAlias; prompt: string; schema: object }
export interface ReviewOutcome { structured?: unknown; text: string; cost: number; failure: string }

/** What the interface the UI shows may rely on. A backend that lacks one gets the control hidden. */
export interface AgentCapabilities {
  subagents: boolean;
  planMode: boolean;
  effort: boolean;
  fork: boolean;
  /** Reports dollar cost itself, so budgets can be enforced. */
  cost: boolean;
}

export interface AgentBackend {
  readonly id: string;
  readonly capabilities: AgentCapabilities;
  start(opts: AgentStartOptions): AgentHandle;
  /** One read-only pass over a worktree that answers in the given JSON schema. */
  review(req: ReviewRequest): Promise<ReviewOutcome>;
}

// ---------------------------------------------------------------- Claude

export const MODEL_ALIAS: Record<ModelAlias, string> = { sonnet: 'sonnet', opus: 'opus', haiku: 'haiku' };

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

export class ClaudeBackend implements AgentBackend {
  readonly id = 'claude';
  readonly capabilities: AgentCapabilities = { subagents: true, planMode: true, effort: true, fork: true, cost: true };

  /** `exe` gives the path to a Claude Code executable to use instead of the bundled one, when there is one. */
  constructor(private exe: () => string | undefined) {}

  start(o: AgentStartOptions): AgentHandle {
    const abort = new AbortController();
    const queue = new InputQueue();
    const options: any = {
      cwd: o.cwd,
      model: MODEL_ALIAS[o.model],
      ...(o.effort ? { effort: o.effort } : {}),
      permissionMode: sdkMode(o.permMode),
      // Only permission to switch to Allow everything later in the conversation; the mode itself is what is chosen above.
      allowDangerouslySkipPermissions: true,
      abortController: abort,
      settingSources: ['user', 'project', 'local'],
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
    // Only set when on, so a user's own Claude Code setting is never switched off by helm.
    if (o.remoteControl) options.settings = { remoteControlAtStartup: true };
    const exe = this.exe();
    if (exe) options.pathToClaudeCodeExecutable = exe;
    if (o.resume) options.resume = o.resume;
    const q: Query = query({ prompt: queue, options });
    let closed = false;
    return {
      get closed() { return closed; },
      events: (async function* () { for await (const m of q as AsyncIterable<any>) yield* claudeEvents(m); })(),
      send: (text, images) => queue.push(text, images),
      interrupt: () => q.interrupt().catch(() => undefined),
      setModel: (model) => q.setModel(MODEL_ALIAS[model]).catch(() => undefined),
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
        cwd: req.cwd, model: MODEL_ALIAS[req.model], maxTurns: 30, permissionMode: 'dontAsk', settingSources: ['user', 'project', 'local'],
        allowedTools: REVIEW_TOOLS,
        disallowedTools: ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Agent', 'Task'],
        outputFormat: { type: 'json_schema', schema: req.schema },
        env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'helm' }
      };
      const exe = this.exe();
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
