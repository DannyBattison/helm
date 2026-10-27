import type { Session, SessionArtifact } from './types';

export type InboxKind = 'approve' | 'question' | 'budget' | 'error' | 'stuck' | 'ready' | 'artifact' | 'queued' | 'merge';

export interface InboxItem {
  session: Session;
  kind: InboxKind;
  /** For an `artifact` item: the file. A session can have several, so an item is told apart by `inboxKey`. */
  artifact?: SessionArtifact;
  /** When it started waiting, for sorting and showing how long. */
  since: number;
}

/** Oldest-first order within a kind; kinds that block an agent come before ones that only wait for you to look. */
const RANK: Record<InboxKind, number> = { approve: 0, question: 0, budget: 1, error: 2, merge: 2, stuck: 3, ready: 4, artifact: 5, queued: 6 };

/** What tells one item from another: a session can have several artifacts waiting. */
export const inboxKey = (i: InboxItem) => i.session.id + (i.artifact ? ':' + i.artifact.name : '');

/**
 * Everything waiting on a person: agents blocked on an approval, question or limit first, then failures, sessions that look stuck,
 * and then work finished and not yet reviewed (no pull request or merge), files the agent handed over, and queued sessions. Archived and merged sessions never appear.
 */
export function inbox(sessions: Session[]): InboxItem[] {
  const out: InboxItem[] = [];
  for (const s of sessions) {
    if (s.archivedAt || s.mergedAt) continue;
    if (s.ask) out.push({ session: s, kind: s.ask.type, since: s.ask.at });
    else if (s.status === 'error') out.push({ session: s, kind: 'error', since: s.endedAt ?? s.lastAccess });
    else if (s.queuedMerge?.error) out.push({ session: s, kind: 'merge', since: s.queuedMerge.errorAt ?? s.queuedMerge.since });
    else if (s.stuck && s.status === 'working') out.push({ session: s, kind: 'stuck', since: s.lastAccess });
    else if (s.status === 'ready' && !s.prUrl) out.push({ session: s, kind: 'ready', since: s.endedAt ?? s.lastAccess });
    else if (s.queued) out.push({ session: s, kind: 'queued', since: s.startedAt });
    // Files the agent handed over wait here alongside whatever else the session needs, one item each.
    for (const a of s.artifacts || []) if (!a.dismissed) out.push({ session: s, kind: 'artifact', artifact: a, since: a.at });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.since - b.since);
}

/** What a key does on an item, or null when it does nothing there. Letters are lowercase except `A`, which is shift-a. */
export type InboxAction = { do: 'approve' } | { do: 'always' } | { do: 'deny' } | { do: 'answer'; option: number } | { do: 'answers'; answers: Record<string, string> } | { do: 'continue' } | { do: 'open' } | { do: 'resume' } | { do: 'retryMerge' } | { do: 'cancelMerge' } | { do: 'start' } | { do: 'download' } | { do: 'dismiss' };

export function keyAction(item: InboxItem, key: string): InboxAction | null {
  const k = item.kind;
  if (key === 'Enter' || key === 'o') return { do: 'open' };
  if (k === 'artifact') {
    if (key === 'd') return { do: 'download' };
    if (key === 'x') return { do: 'dismiss' };
  }
  if (k === 'approve') {
    if (key === 'a') return { do: 'approve' };
    if (key === 'A' && item.session.ask?.pattern) return { do: 'always' };
    if (key === 'd') return { do: 'deny' };
  }
  if (k === 'question' && /^[1-9]$/.test(key)) {
    const qs = item.session.ask?.questions ?? [];
    // With several questions, or a multi-select one, there is no single option to pick: answer them in the form.
    return qs.length === 1 && !qs[0].multiSelect && +key <= qs[0].options.length ? { do: 'answer', option: +key - 1 } : null;
  }
  if (k === 'budget' && (key === 'a' || key === 'c')) return { do: 'continue' };
  if (k === 'error' && key === 'r') return { do: 'resume' };
  if (k === 'merge') {
    if (key === 'r') return { do: 'retryMerge' };
    if (key === 'x') return { do: 'cancelMerge' };
  }
  if (k === 'queued' && key === 's') return { do: 'start' };
  return null;
}
