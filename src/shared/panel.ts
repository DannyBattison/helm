import type { Panel, PanelMember, TranscriptEvent } from './types';

/** Everyone in the session, the owner first. */
export const participants = (p: Panel): string[] => [p.owner, ...p.members.map((m) => m.name)];

/** A handle people can write after an @: the agent's name in lower case, numbered when another agent has it. */
export function handleFor(shortName: string, taken: string[]): string {
  const base = shortName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'agent';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) if (!taken.includes(base + '-' + n)) return base + '-' + n;
}

/** The replies one message may bring: null for no limit. */
export const replyLimit = (cap: number | undefined): number | null => (cap == null || cap < 0 ? null : Math.max(1, Math.floor(cap)));

/** The participants an @ in `text` addresses, in the order they appear. `@all` is everyone. `self` is never included. */
export function mentionsIn(text: string, names: string[], self?: string): string[] {
  const out: string[] = [];
  const add = (n: string) => { if (n !== self && !out.includes(n)) out.push(n); };
  for (const m of text.matchAll(/(^|[^\w@./\\-])@([a-z0-9][\w-]*)/gi)) {
    const word = m[2].toLowerCase().replace(/-+$/, '');
    if (word === 'all' || word === 'everyone') { for (const n of names) add(n); continue; }
    const hit = names.find((n) => n === word);
    if (hit) add(hit);
  }
  return out;
}

const at = (n: string) => '@' + n;

/**
 * What `me` has not yet been shown: the user's messages and the other agents' replies since `from`, as text to send it. Long
 * stretches are cut from the front, since the latest messages are the ones being answered.
 */
export function panelDigest(t: TranscriptEvent[], from: number, me: string, panel: Panel, limit = 24000): string {
  const lines: string[] = [];
  for (const ev of t.slice(Math.max(0, from))) {
    if (ev.k === 'user' && !ev.from) lines.push(`[you${ev.to?.length ? ' → ' + ev.to.map(at).join(' ') : ''}]: ${ev.text}`);
    else if (ev.k === 'agent' && ev.from && ev.from !== me) lines.push(`[${at(ev.from)}${ev.re ? ' → ' + at(ev.re.who) : ''}]: ${ev.text}`);
  }
  let body = '';
  let cut = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (body.length + lines[i].length > limit && body) { cut = true; break; }
    body = lines[i] + (body ? '\n\n' : '') + body;
  }
  const who = panel.owner === me ? 'the owner' : 'read-only';
  const roster = participants(panel).map((n) => at(n) + (n === panel.owner ? ' (owner)' : '')).join(', ');
  return [`Participants: ${roster}. You are ${at(me)}, ${who}.`, cut ? '(Earlier messages left out.)' : '', body, `Reply as ${at(me)}.`].filter(Boolean).join('\n\n');
}

/** The instructions that make an agent a participant: who else is there, how to address them, and what it may and may not do. */
export function panelInstructions(panel: Panel, me: string, cap: number | undefined): string {
  const owner = panel.owner === me;
  const limit = replyLimit(cap);
  const others = participants(panel).filter((n) => n !== me).map((n) => at(n) + (n === panel.owner ? ' (owner)' : ' (read-only)')).join(', ');
  return [
    `This session has several agents working with the user. You are ${at(me)}${owner ? ', the owner' : ''}. The others: ${others}.`,
    'Messages from the user show as "[you]" and from the others as "[@name]". Answer the latest message; build on what the others said rather than repeating it, and keep replies short.',
    `To bring someone into the discussion, write @name in your reply and they will answer you. Only do that when you need their answer: every mention costs them a turn${limit ? `, and one message from the user gets at most ${limit} replies in all` : ''}. A reply that mentions no one ends the discussion.`,
    owner
      ? 'You are the owner: you alone edit files, run commands that change things and commit. The others can only read, so ask them to review or advise rather than to change anything.'
      : `You are read-only: you may read files and run commands that only look, and you cannot change anything. When something should change, say what, and leave it to ${at(panel.owner)}, who makes the changes.`
  ].join('\n');
}

export const memberOf = (p: Panel | undefined, name: string): PanelMember | undefined => p?.members.find((m) => m.name === name);
