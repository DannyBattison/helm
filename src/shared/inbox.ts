import type { Session } from './types';

export type InboxKind = 'approve' | 'question' | 'budget' | 'error' | 'stuck' | 'ready' | 'queued';

export interface InboxItem {
  session: Session;
  kind: InboxKind;
  /** When it started waiting, for sorting and showing how long. */
  since: number;
}

/** Oldest-first order within a kind; kinds that block an agent come before ones that only wait for you to look. */
const RANK: Record<InboxKind, number> = { approve: 0, question: 0, budget: 1, error: 2, stuck: 3, ready: 4, queued: 5 };

/**
 * Everything waiting on a person: agents blocked on an approval, question or limit first, then failures, sessions that look stuck,
 * and finally work finished and not yet reviewed (no pull request or merge). Archived and merged sessions never appear.
 */
export function inbox(sessions: Session[]): InboxItem[] {
  const out: InboxItem[] = [];
  for (const s of sessions) {
    if (s.archivedAt || s.mergedAt) continue;
    if (s.ask) out.push({ session: s, kind: s.ask.type, since: s.ask.at });
    else if (s.status === 'error') out.push({ session: s, kind: 'error', since: s.endedAt ?? s.lastAccess });
    else if (s.stuck && s.status === 'working') out.push({ session: s, kind: 'stuck', since: s.lastAccess });
    else if (s.status === 'ready' && !s.prUrl) out.push({ session: s, kind: 'ready', since: s.endedAt ?? s.lastAccess });
    else if (s.queued) out.push({ session: s, kind: 'queued', since: s.startedAt });
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.since - b.since);
}

/** What a key does on an item, or null when it does nothing there. Letters are lowercase except `A`, which is shift-a. */
export type InboxAction = { do: 'approve' } | { do: 'always' } | { do: 'deny' } | { do: 'answer'; option: number } | { do: 'continue' } | { do: 'open' } | { do: 'resume' } | { do: 'start' };

export function keyAction(item: InboxItem, key: string): InboxAction | null {
  const k = item.kind;
  if (key === 'Enter' || key === 'o') return { do: 'open' };
  if (k === 'approve') {
    if (key === 'a') return { do: 'approve' };
    if (key === 'A' && item.session.ask?.pattern) return { do: 'always' };
    if (key === 'd') return { do: 'deny' };
  }
  if (k === 'question' && /^[1-9]$/.test(key)) {
    const qs = item.session.ask?.questions ?? [];
    // With several questions there is no single option to pick: answer them in the session.
    return qs.length === 1 && +key <= qs[0].options.length ? { do: 'answer', option: +key - 1 } : null;
  }
  if (k === 'budget' && (key === 'a' || key === 'c')) return { do: 'continue' };
  if (k === 'error' && key === 'r') return { do: 'resume' };
  if (k === 'queued' && key === 's') return { do: 'start' };
  return null;
}
