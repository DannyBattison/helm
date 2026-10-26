import { posix, win32 } from 'node:path';
import { commandSummary } from '../shared/commandSummary';
import type { TranscriptEvent } from '../shared/types';

/** Tool names and shapes follow Claude Code's. A backend for another agent maps its own tools onto them. */
export const COMMAND_TOOLS = new Set(['Bash', 'PowerShell']);
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export const isWin = (p: string) => /^[A-Za-z]:[\\/]/.test(p);
/** A path relative to the worktree, with forward slashes. Windows-style paths are understood on any platform, as session files can come from another machine. */
export const rel = (wt: string, p: string) => {
  if (!p) return p;
  const api = isWin(wt) || isWin(p) ? win32 : posix;
  const r = api.isAbsolute(p) ? api.relative(wt, p) : p;
  return (r.startsWith('..') ? p : r).split(api.sep).join('/');
};
export const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Turns an agent's saved messages (user and assistant turns with tool calls and results) into transcript events. */
export function convertMessages(msgs: any[], wt: string, withUser = false): TranscriptEvent[] {
  const ev: TranscriptEvent[] = [];
  const pending = new Map<string, { kind: 'bash' | 'tool'; idx: number; item?: number }>();
  let group = -1;
  for (const m of msgs) {
    const raw = m.message?.content;
    const content: any[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [{ type: 'text', text: raw }] : [];
    if (m.type === 'assistant') {
      const at = Date.parse(m.timestamp) || undefined;
      for (const b of content) {
        if (b.type === 'text' && b.text?.trim()) { ev.push({ k: 'agent', text: b.text.trim(), at }); continue; }
        if (b.type !== 'tool_use') continue;
        const input = b.input || {};
        if (COMMAND_TOOLS.has(b.name)) {
          pending.set(b.id, { kind: 'bash', idx: ev.push({ k: 'bash', id: b.id, cmd: String(input.command || ''), summary: commandSummary(String(input.command || ''), input.description), out: '', ok: true, meta: '', done: false }) - 1 });
        } else if (EDIT_TOOLS.has(b.name)) {
          const file = rel(wt, String(input.file_path || input.notebook_path || ''));
          const lines: [string, string][] = [];
          let add = 0, del = 0;
          const edits = b.name === 'MultiEdit' ? input.edits || [] : b.name === 'Edit' ? [input] : [];
          if (b.name === 'Write') {
            const all = String(input.content || '').split('\n');
            add = all.length;
            for (const l of all.slice(0, 24)) lines.push(['+', l]);
          } else for (const e of edits) {
            const o = String(e.old_string || '').split('\n'), n = String(e.new_string || '').split('\n');
            if (e.old_string) { del += o.length; for (const l of o.slice(0, 12)) lines.push(['-', l]); }
            if (e.new_string) { add += n.length; for (const l of n.slice(0, 12)) lines.push(['+', l]); }
          }
          ev.push({ k: 'edit', file, add, del, lines: lines.slice(0, 40) });
          group = -1;
        } else {
          const target = trunc(String(input.file_path ?? input.pattern ?? input.path ?? input.url ?? input.query ?? input.description ?? input.prompt ?? ''), 140);
          const item: [string, string, string] = [b.name, rel(wt, target), ''];
          const last = ev[ev.length - 1];
          if (last && last.k === 'tools' && group === ev.length - 1) last.items.push(item);
          else group = ev.push({ k: 'tools', items: [item] }) - 1;
          pending.set(b.id, { kind: 'tool', idx: group, item: (ev[group] as any).items.length - 1 });
        }
      }
    } else if (m.type === 'user') {
      if (withUser) {
        const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        if (text && !/^<(local-command|command-|system-reminder|ide_)/.test(text)) ev.push({ k: 'user', t: 0, text });
      }
      for (const b of content) {
        if (b.type !== 'tool_result') continue;
        const p = pending.get(b.tool_use_id);
        if (!p) continue;
        const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c: any) => c.text || '').join('\n');
        if (p.kind === 'bash') {
          const cur = ev[p.idx] as Extract<TranscriptEvent, { k: 'bash' }>;
          const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
          ev[p.idx] = { ...cur, out: b.is_error ? trunc(lines[lines.length - 1] || 'failed', 70) : lines.length ? trunc(lines[lines.length - 1], 70) : '✓', ok: !b.is_error, done: true };
        } else {
          const cur = ev[p.idx] as Extract<TranscriptEvent, { k: 'tools' }>;
          const it = cur.items[p.item!];
          const n = text.split('\n').filter(Boolean).length;
          it[2] = b.is_error ? 'failed' : it[0] === 'Read' ? `${text.split('\n').length} lines` : it[0] === 'Grep' || it[0] === 'Glob' ? `${n} ${n === 1 ? 'match' : 'matches'}` : '';
        }
      }
    }
  }
  return ev;
}
