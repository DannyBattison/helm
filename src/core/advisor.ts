import type { MessageImage } from '../shared/types';
import type { AgentBackend, AgentHandle, AgentStartOptions, AgentUsage, ToolDecision } from './backend';
import { COMMAND_TOOLS, EDIT_TOOLS } from './transcript';
import { hasShellControl } from './util';

/** Commands that only look. Anything else is refused to an agent that may not change things. */
const SAFE_CMD = /^(ls|dir|pwd|cat|head|tail|wc|echo|which|where|type|tree|file|stat|date|whoami|git (status|diff|log|show|rev-parse|ls-files|blame|remote -v|config --get)|rg|grep|find(?!.*(-delete|-exec)))(\s|$)/;
const SAFE_BRANCH = /^git branch(\s+(-a|-r|-v|-vv|-l|--list|--all|--remotes|--show-current))*\s*$/;

/** What a read-only participant may do: look at anything, change nothing, and not interrupt the user with a question of its own. */
export function readOnlyDecision(tool: string, input: Record<string, unknown>): ToolDecision {
  const no = (message: string): ToolDecision => ({ behavior: 'deny', message });
  if (EDIT_TOOLS.has(tool)) return no('You are read-only in this session. Say what should change and leave the edit to the owner.');
  if (COMMAND_TOOLS.has(tool)) {
    const cmd = String(input.command || '').trim();
    if (!hasShellControl(cmd) && (SAFE_CMD.test(cmd) || SAFE_BRANCH.test(cmd))) return { behavior: 'allow', updatedInput: input };
    return no('You are read-only in this session, so you may only run commands that look at things (ls, cat, grep, git log, …). Ask the owner to run anything else.');
  }
  if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return no('Put your question in your reply, or @mention whoever should answer.');
  return { behavior: 'allow', updatedInput: input };
}

export interface AdvisorHooks {
  /** The agent's own id for the conversation, to resume it later. */
  onSession(id: string): void;
  onUsage(u: AgentUsage): void;
}

/** A participant that may only read: a running agent that answers one message at a time. */
export class Advisor {
  readonly agent: AgentHandle;
  private turn?: { text: string[]; resolve(t: string): void; reject(e: Error): void };
  private ended = false;

  constructor(backend: AgentBackend, opts: Omit<AgentStartOptions, 'canUseTool' | 'admitSubagent' | 'permMode'>, private hooks: AdvisorHooks) {
    this.agent = backend.start({
      ...opts,
      permMode: 'plan',
      canUseTool: async (tool, input) => readOnlyDecision(tool, input),
      admitSubagent: async () => 'Read-only participants do not start subagents.'
    });
    void this.pump();
  }

  get busy() { return !!this.turn; }
  get dead() { return this.ended; }

  /** Puts a message to the agent and resolves to its reply when it has finished. */
  ask(prompt: string, images?: MessageImage[]): Promise<string> {
    if (this.ended) return Promise.reject(new Error('This agent has stopped.'));
    if (this.turn) return Promise.reject(new Error('This agent is already replying.'));
    return new Promise<string>((resolve, reject) => {
      this.turn = { text: [], resolve, reject };
      this.agent.send(prompt, images);
    });
  }

  /** Cuts the reply short; whatever it had said so far is still returned. */
  interrupt() { return this.agent.interrupt().catch(() => undefined); }
  close() { this.agent.close(); }

  private finish(error?: Error) {
    const t = this.turn;
    this.turn = undefined;
    if (!t) return;
    if (error) t.reject(error); else t.resolve(t.text.join('\n\n').trim());
  }

  private async pump() {
    try {
      for await (const ev of this.agent.events) {
        if (ev.t === 'init') this.hooks.onSession(ev.sessionId);
        else if (ev.t === 'assistant' && !ev.parentId) {
          if (ev.usage) this.hooks.onUsage(ev.usage);
          for (const b of ev.blocks) if (b.type === 'text' && this.turn) this.turn.text.push(b.text);
        } else if (ev.t === 'result') {
          if (ev.isError && !this.turn?.text.length) this.finish(new Error(ev.text || 'The agent failed.'));
          else { if (this.turn && !this.turn.text.length && ev.text) this.turn.text.push(ev.text); this.finish(); }
        }
      }
    } catch (e: any) {
      this.ended = true;
      this.finish(this.agent.closed ? undefined : new Error(String(e?.message || e)));
    } finally {
      this.ended = true;
      this.finish(this.agent.closed ? undefined : new Error('The agent stopped.'));
    }
  }
}
