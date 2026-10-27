import type { AgentCapabilities, AgentLogin, BackendInfo, Effort, MessageImage, ModelAlias, ModelInfo, PermMode, TranscriptEvent } from '../shared/types';

export type { AgentCapabilities, ModelInfo };

/**
 * What helm needs from an agent, whichever one it is. SessionManager talks only to this file's types; everything specific
 * to the Claude Agent SDK (message shapes, option names, hooks) stays inside ClaudeBackend.
 */

/** Token counts for one model call. `cacheWrite` is input that was written to the prompt cache, billed like input. */
export interface AgentUsage { input: number; output: number; cacheWrite: number; cacheRead: number; /** Size of the model's context window, when the agent says. */ contextWindow?: number }

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
  /** MCP servers to give the agent, by name, in the form helm stores them (`type` stdio, http or sse). */
  mcpServers?: Record<string, any>;
  /** Folders outside the working directory the agent may read, such as files the user uploaded. */
  extraDirs?: string[];
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

/** A saved conversation, as its backend describes it. */
export interface ConversationInfo {
  id: string;
  /** A name the user gave it. */
  title?: string;
  /** A name the agent gave it. */
  summary?: string;
  firstPrompt?: string;
  cwd?: string;
  branch?: string;
  size: number;
  lastModified: number;
  createdAt?: number;
}

/** The backend's own record of conversations: what lets a session be renamed, forked, resumed in another worktree, or read back. */
export interface ConversationStore {
  info(id: string, dir?: string): Promise<ConversationInfo | null>;
  rename(id: string, dir: string, title: string): Promise<void>;
  /** Copies a conversation (optionally only up to a message) so it can be resumed from `destDir`. Resolves to the copy's id. */
  fork(o: { sourceId: string; sourceDir: string; destDir: string; upToMessageId?: string; title: string }): Promise<string>;
  /** The id of the message just before the user's n-th identical message. null if it is the first message, undefined if it is not found. */
  messageBefore(id: string, dir: string, text: string, occurrence: number): Promise<string | null | undefined>;
  /** What a subagent did, read from the backend's saved files. */
  subagentTranscript(id: string, agentId: string, dir: string): Promise<TranscriptEvent[]>;
  /** Conversations from outside helm for a repository. */
  list(dir: string): Promise<ConversationInfo[]>;
  /** A whole conversation as transcript events, with the user's messages. */
  transcript(id: string, dir: string): Promise<TranscriptEvent[]>;
  /** Changes whenever the conversation does, so a cached transcript can tell it is stale. */
  signature(id: string): Promise<string>;
  /** Ids of conversations with a process running right now, or null when it can't be asked. */
  live(): Promise<Set<string> | null>;
}

/** Signing the user in to the agent, where the app has to do that itself. */
export interface BackendAuth {
  status(): Promise<AgentLogin>;
  /** `code` is shown to the user to enter at `url`; `needsCode` means they must instead paste a code back with `submitCode`. Either way, `status` turns to signed in when done. */
  startLogin(): Promise<{ url: string; code?: string; needsCode: boolean }>;
  submitCode?(code: string): Promise<AgentLogin>;
  cancel(): void;
  logout(): Promise<AgentLogin>;
}

/** Where a subscription plan stands, read without starting a conversation. */
export interface PlanProbe { billing: 'subscription' | 'api'; fiveHour?: PlanWindow; weekly?: PlanWindow }

export interface AgentBackend {
  readonly id: string;
  readonly label: string;
  /** What the agent is called in a conversation and in a commit's author. */
  readonly shortName: string;
  /** Who commits are attributed to when the user chooses "agent only". */
  readonly identity: { name: string; email: string };
  /** Ships with helm, so a missing command-line tool does not make it unavailable. */
  readonly bundled?: boolean;
  /** The models it offers. May change after `refresh`. */
  readonly models: ModelInfo[];
  /** Re-reads what changes while helm runs (the model list, say). */
  refresh?(): Promise<void>;
  readonly capabilities: AgentCapabilities;
  /** The version of the agent's command-line tool, from `path` when given. Null when it is not there. */
  version(path?: string): Promise<string | null>;
  start(opts: AgentStartOptions): AgentHandle;
  /** One read-only pass over a worktree that answers in the given JSON schema. */
  review(req: ReviewRequest): Promise<ReviewOutcome>;
  /** Absent when the backend keeps no conversations helm can read. */
  readonly conversations?: ConversationStore;
  readonly auth?: BackendAuth;
  planUsage?(cwd: string): Promise<PlanProbe | null>;
}

/** The backends helm can run. The first is the default when a setting names one that is gone. */
export class BackendRegistry {
  constructor(private list: AgentBackend[]) {}
  all() { return this.list; }
  has(id: string | undefined) { return !!id && this.list.some((b) => b.id === id); }
  /** The named backend, or the first one when the name is empty or unknown (an older session has none). */
  get(id?: string): AgentBackend { return this.list.find((b) => b.id === id) ?? this.list[0]; }
  /** The named model of a backend; the backend's first when the name is not one of its models; a free stand-in when it lists none yet. */
  model(backend: string | undefined, model: string): ModelInfo { const b = this.get(backend); return b.models.find((m) => m.id === model) ?? b.models[0] ?? { id: model, label: model, price: [0, 0] }; }
  /** Each backend as the interface sees it. `logins` is what was last read from `auth.status`. */
  async info(logins: Record<string, AgentLogin | undefined> = {}): Promise<BackendInfo[]> {
    return Promise.all(this.list.map(async (b) => {
      const login = logins[b.id];
      const version = await b.version().catch(() => null);
      return { id: b.id, label: b.label, shortName: b.shortName, models: b.models, capabilities: b.capabilities, version, installed: !!b.bundled || version !== null, canSignIn: !!b.auth, login, ready: (!b.auth || !!login?.loggedIn) && (!!b.bundled || version !== null) };
    }));
  }
}
