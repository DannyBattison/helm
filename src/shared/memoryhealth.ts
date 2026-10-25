import type { TranscriptEvent } from './types';

export interface MemoryUsage { sessions: number; last: number }
export interface HealthIssue { path: string; kind: 'stale' | 'missing' | 'similar'; text: string }

export interface MemoryFile {
  path: string;
  /** File name, e.g. feedback_testing.md. */
  file: string;
  name: string;
  description: string;
  type: string;
  modified: number;
  index: boolean;
  text: string;
}

export const STALE_DAYS = 45;
/** Sessions in the period needed before an unread memory counts as stale: with fewer, there is not enough to go on. */
export const STALE_MIN_SESSIONS = 3;
export const SIMILAR_AT = 0.6;

/** File names of memories that a conversation read, from its Read tool calls and `cat` commands. */
export function memoryReads(events: TranscriptEvent[]): string[] {
  const found = new Set<string>();
  const tail = (s: string) => /[\\/]memory[\\/]([^\\/\s'"]+\.md)\b/.exec(s)?.[1];
  for (const e of events) {
    if (e.k === 'tools') for (const [name, target] of e.items) { if (name === 'Read') { const f = tail(target); if (f) found.add(f); } }
    else if (e.k === 'bash') { const f = tail(e.cmd); if (f) found.add(f); }
  }
  return [...found];
}

/** Things in backticks that look like paths into the repository: they have a slash or a file extension, and no wildcard, URL or absolute root. */
export function mentionedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) {
    const p = m[1].trim();
    if (/[\s*?<>{}$|;=()]/.test(p) || /^(https?:|~|\/|[A-Za-z]:[\\/]|\.\.?\/?$)/.test(p) || p.includes('://')) continue;
    if (!/[\\/]/.test(p) && !/\.[A-Za-z0-9]{1,5}$/.test(p)) continue;
    if (/^v?\d+(\.\d+)+$/i.test(p)) continue; // a version number
    out.add(p.replace(/^\.[\\/]/, '').replace(/:\d+(-\d+)?$/, '').replace(/#.*$/, ''));
  }
  return [...out].filter(Boolean);
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
export function similarity(a: string, b: string): number {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export function memoryHealth(input: { memories: MemoryFile[]; usage: Record<string, MemoryUsage>; now: number; recentSessions: number; exists(path: string): boolean }): HealthIssue[] {
  const out: HealthIssue[] = [];
  const list = input.memories.filter((m) => !m.index);
  const cutoff = input.now - STALE_DAYS * 86_400_000;
  for (const m of list) {
    const u = input.usage[m.file];
    if (m.modified < cutoff && (!u || u.last < cutoff) && input.recentSessions >= STALE_MIN_SESSIONS) {
      out.push({ path: m.path, kind: 'stale', text: `Not read by any of the last ${input.recentSessions} sessions, and not changed in over ${STALE_DAYS} days` });
    }
    for (const p of mentionedPaths(m.text)) if (!input.exists(p)) out.push({ path: m.path, kind: 'missing', text: `Mentions ${p}, which is not in the repository` });
  }
  const sig = (m: MemoryFile) => `${m.name} ${m.description} ${m.text.replace(/^---[\s\S]*?---/, '').slice(0, 300)}`;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    if (list[i].type !== list[j].type) continue;
    if (similarity(sig(list[i]), sig(list[j])) >= SIMILAR_AT) {
      out.push({ path: list[i].path, kind: 'similar', text: `Reads like ${list[j].name}: they may duplicate or contradict each other` });
      out.push({ path: list[j].path, kind: 'similar', text: `Reads like ${list[i].name}: they may duplicate or contradict each other` });
    }
  }
  return out;
}
