import type { AgentCapabilities, AgentCommand } from './types';

/**
 * Commands typed at the start of a message with a slash. Two kinds:
 * - `helm` ones are run by helm itself and are never sent to the agent;
 * - `agent` ones belong to one agent's own command set and go to it as an ordinary message. The agent reports them itself
 *   (Claude Code and Qwen Code do, and that includes commands a user or repository defined), so they are never hard-coded here
 *   beyond `FALLBACK`, which covers the time before an agent has started.
 */
export interface SlashCommand {
  name: string;
  desc: string;
  icon: string;
  kind: 'helm' | 'agent';
  /** Hint for what follows the name, shown in the list. Commands with one wait for it instead of running on pick. */
  arg?: string;
  /** Needs this capability of the session's agent. */
  needs?: keyof AgentCapabilities;
  /** Only in a session with one agent. */
  solo?: boolean;
}

/** What an agent is known to understand before it has reported its own list. */
const FALLBACK: Record<string, AgentCommand[]> = {
  claude: [{ name: 'compact', desc: 'Summarize the conversation to free context', arg: 'what to keep (optional)' }, { name: 'init', desc: 'Write a CLAUDE.md for this repository' }]
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'agent', desc: 'Bring in another agent to discuss this', icon: 'users-three', kind: 'helm', solo: true },
  { name: 'schedule', desc: 'Send a prompt later, once or on repeat', icon: 'clock', kind: 'helm' },
  { name: 'notify', desc: 'Notifications for this repository', icon: 'bell', kind: 'helm', arg: 'all | attention | off' },
  { name: 'plan', desc: 'Plan only: no edits or commands', icon: 'list-checks', kind: 'helm', needs: 'planMode' },
  { name: 'rename', desc: 'Rename this session', icon: 'pencil-simple', kind: 'helm' },
  { name: 'checkpoints', desc: 'See and restore earlier points', icon: 'clock-counter-clockwise', kind: 'helm' },
  { name: 'interrupt', desc: 'Stop what the agent is doing', icon: 'stop', kind: 'helm' },
];

/** The commands a session's agent offers whose name starts with what was typed. Helm's own come first and win a clash of names. */
export function slashMatches(q: string, backend: string, caps: Partial<AgentCapabilities> | undefined, panel: boolean, reported?: AgentCommand[]): SlashCommand[] {
  const needle = q.toLowerCase();
  const own = SLASH_COMMANDS
    .filter((c) => !(c.solo && panel))
    .filter((c) => !c.needs || caps?.[c.needs] !== false);
  const theirs: SlashCommand[] = panel ? [] : (reported?.length ? reported : FALLBACK[backend] || [])
    .filter((c) => !SLASH_COMMANDS.some((o) => o.name === c.name))
    .map((c) => ({ name: c.name, desc: c.desc, icon: 'terminal', kind: 'agent' as const, ...(c.arg ? { arg: c.arg } : {}) }));
  return [...own, ...theirs].filter((c) => c.name.startsWith(needle));
}
/** The `/word` under the caret, when it is the start of the message. */
export function slashAt(value: string, caret: number): string | null {
  const m = /^\/([\w-]*)$/.exec(value.slice(0, caret));
  return m ? m[1] : null;
}

/** A message that is a helm command: its name and what followed. Null for anything else, including agent commands. */
export function parseHelmCommand(text: string): { cmd: SlashCommand; arg: string } | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  const cmd = m && SLASH_COMMANDS.find((c) => c.kind === 'helm' && c.name === m[1]);
  return cmd ? { cmd, arg: (m![2] || '').trim() } : null;
}
