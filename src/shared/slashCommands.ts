import type { AgentCapabilities } from './types';

/**
 * Commands typed at the start of a message with a slash. Two kinds:
 * - `helm` ones are run by helm itself and are never sent to the agent;
 * - `agent` ones belong to one agent's own command set and go to it as an ordinary message.
 */
export interface SlashCommand {
  name: string;
  desc: string;
  icon: string;
  kind: 'helm' | 'agent';
  /** Hint for what follows the name, shown in the list. Commands with one wait for it instead of running on pick. */
  arg?: string;
  /** Agents that understand it (agent commands only). */
  backends?: string[];
  /** Needs this capability of the session's agent. */
  needs?: keyof AgentCapabilities;
  /** Only in a session with one agent. */
  solo?: boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'agent', desc: 'Bring in another agent to discuss this', icon: 'users-three', kind: 'helm', solo: true },
  { name: 'schedule', desc: 'Send a prompt later, once or on repeat', icon: 'clock', kind: 'helm' },
  { name: 'notify', desc: 'Notifications for this repository', icon: 'bell', kind: 'helm', arg: 'all | attention | off' },
  { name: 'plan', desc: 'Plan only: no edits or commands', icon: 'list-checks', kind: 'helm', needs: 'planMode' },
  { name: 'rename', desc: 'Rename this session', icon: 'pencil-simple', kind: 'helm' },
  { name: 'checkpoints', desc: 'See and restore earlier points', icon: 'clock-counter-clockwise', kind: 'helm' },
  { name: 'interrupt', desc: 'Stop what the agent is doing', icon: 'stop', kind: 'helm' },
  { name: 'compact', desc: 'Summarize the conversation to free context', icon: 'arrows-in-line-vertical', kind: 'agent', backends: ['claude'], arg: 'what to keep (optional)' },
  { name: 'init', desc: 'Write a CLAUDE.md for this repository', icon: 'file-text', kind: 'agent', backends: ['claude'] },
];

/** The commands a session's agent offers whose name starts with what was typed. Helm's own come first. */
export function slashMatches(q: string, backend: string, caps: Partial<AgentCapabilities> | undefined, panel: boolean): SlashCommand[] {
  const needle = q.toLowerCase();
  return SLASH_COMMANDS
    .filter((c) => c.name.startsWith(needle))
    .filter((c) => !(c.solo && panel))
    .filter((c) => !c.needs || caps?.[c.needs] !== false)
    .filter((c) => c.kind === 'helm' || (!panel && !!c.backends?.includes(backend)))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'helm' ? -1 : 1));
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
