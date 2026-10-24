import type { TranscriptEvent } from './types';

export interface TextHit {
  index: number;
  kind: 'you' | 'claude' | 'command' | 'edit' | 'note';
  snippet: string;
}

export interface TranscriptHit extends TextHit {
  sessionId: string;
  repoId: string;
  title: string;
}

export interface CommitHit { repoId: string; hash: string; msg: string; who: string; at: number }
export interface CodeHit { ws: string; path: string; line: number; text: string }

export interface SearchResults {
  query: string;
  transcripts: TranscriptHit[];
  commits: CommitHit[];
  code: CodeHit[];
}

/** A line of text around the first match, with ellipses where it was cut. Empty when there is no match. */
export function snippet(text: string, q: string, radius = 56): string {
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return '';
  const from = Math.max(0, at - radius), to = Math.min(flat.length, at + q.length + radius);
  return (from > 0 ? '…' : '') + flat.slice(from, to).trim() + (to < flat.length ? '…' : '');
}

/** Events of a conversation that mention the query: what you and Claude said, commands that ran, files that were edited. */
export function searchEvents(events: TranscriptEvent[], q: string, max = 3): TextHit[] {
  const out: TextHit[] = [];
  const needle = q.trim();
  if (!needle) return out;
  const text = (e: TranscriptEvent): [TextHit['kind'], string] | null => {
    switch (e.k) {
      case 'user': return e.from ? null : ['you', e.text];
      case 'agent': return ['claude', e.text];
      case 'bash': return ['command', e.cmd];
      case 'edit': return ['edit', e.file];
      case 'note': return ['note', e.text];
      default: return null;
    }
  };
  for (let i = 0; i < events.length && out.length < max; i++) {
    const t = text(events[i]);
    if (!t) continue;
    const s = snippet(t[1], needle);
    if (s) out.push({ index: i, kind: t[0], snippet: s });
  }
  return out;
}
