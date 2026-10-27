import { redact } from './redact';
import type { Repo, Session, Settings } from './types';

export interface DiagnosticsInput {
  now: number;
  app: { version: string; electron: string; node: string; chrome: string; platform: string; arch: string; os: string; packaged: boolean };
  agents: { label: string; version: string | null }[];
  gitVersion: string | null;
  home: string;
  settings: Settings;
  repos: Repo[];
  sessions: Session[];
  log: string[];
}

/** Replaces the home folder, and so the user's name, wherever it appears. */
export function scrub(text: string, home: string): string {
  let t = redact(text);
  if (home) for (const h of new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])) if (h.length > 3) t = t.split(h).join('~');
  return t;
}

/**
 * A support bundle in Markdown. It says what is running and what state the sessions are in, but leaves out task text,
 * conversations, file contents, repository paths, tokens and anything else private. Secrets and the home folder are masked.
 */
export function diagnostics(i: DiagnosticsInput): string {
  const s = i.settings;
  const L: string[] = ['# helm diagnostics', '', `Created ${new Date(i.now).toISOString()}`, ''];
  L.push('## Versions', `- helm ${i.app.version}${i.app.packaged ? '' : ' (development build)'}`, `- Electron ${i.app.electron}, Chrome ${i.app.chrome}, Node ${i.app.node}`, `- ${i.app.platform} ${i.app.arch}, ${i.app.os}`, ...i.agents.map((a) => `- ${a.label} ${a.version ?? 'not found'}`), `- git ${i.gitVersion ?? 'not found'}`, '');
  L.push('## Settings', `- billing ${s.billing}, model ${s.defaultModel}, permission mode ${s.permMode}`, `- deliver by ${s.deliver}, merge method ${s.mergeMethod}, after merge ${s.afterMerge}`, `- sessions at once ${s.maxRunning || 'unlimited'}, subagents ${s.maxSubagentsSession} per session and ${s.maxSubagentsRepo} per repository`, `- remote control ${s.remoteControl ? 'on' : 'off'}, tray ${s.tray ? 'on' : 'off'}, auto-update ${s.autoUpdate ? 'on' : 'off'}`, `- custom Claude path ${s.claudePath ? 'yes' : 'no'}, backend ${s.defaultBackend}`, '');
  L.push(`## Repositories (${i.repos.length})`, ...i.repos.slice(0, 40).map((r) => `- ${r.id}${r.private ? ' (private)' : ''}, default branch ${r.defaultBranch}`), '');
  const counts: Record<string, number> = {};
  for (const x of i.sessions) counts[x.status] = (counts[x.status] || 0) + 1;
  L.push(`## Sessions (${i.sessions.length})`, `- by status: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  for (const x of [...i.sessions].sort((a, b) => b.lastAccess - a.lastAccess).slice(0, 25)) {
    L.push(`- ${x.id} · ${x.repoId} · ${x.status} · ${x.model}${x.effort ? '/' + x.effort : ''} · ${x.permMode} · ${x.commits.length} commits · ${x.files} files${x.queued ? ' · queued' : ''}${x.archivedAt ? ' · archived' : ''}${x.worktreeGone ? ' · worktree gone' : ''}${x.stuck ? ' · stuck' : ''}${x.error ? ' · error: ' + scrub(x.error, i.home).slice(0, 200) : ''}`);
  }
  L.push('', `## Recent log (${i.log.length} lines)`, '```', ...i.log.map((l) => scrub(l, i.home).slice(0, 600)), '```', '');
  return L.join('\n');
}
