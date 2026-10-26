/** GitHub rejects very long titles; a short one also reads better in lists. */
export const PR_TITLE_MAX = 72;

/** A brief title from a task or commit message: its first line, cut at a word boundary with an ellipsis when too long. */
export function prTitle(text: string, max = PR_TITLE_MAX): string {
  const line = (text.split('\n').find((l) => l.trim()) || '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.\-–]+$/, '') + '…';
}

const OPEN = '<!-- helm:summary -->';
const CLOSE = '<!-- /helm:summary -->';

/** The part of a pull request description that helm writes and keeps current: the task, every commit, the issue it closes. */
export function prSummary(o: { task: string; commits: { msg: string }[]; issue?: number; files?: number; add?: number; del?: number }): string {
  const items = o.commits.slice().reverse().map((c) => `- ${c.msg}`).join('\n');
  const stats = o.files ? `${o.files} ${o.files === 1 ? 'file' : 'files'} changed, +${o.add ?? 0} −${o.del ?? 0}` : '';
  return [OPEN, o.task.trim(), items && `### Changes\n${items}`, stats, o.issue ? `Closes #${o.issue}` : '', CLOSE].filter(Boolean).join('\n\n');
}

export const prBody = (summary: string, sessionId: string) => `${summary}\n\nCreated with helm · session ${sessionId}`;

/** Swaps the helm-written block in an existing description for a fresh one. Null when the description has no such block (the user rewrote it), so it is left alone. */
export function replaceSummary(body: string, summary: string): string | null {
  const a = body.indexOf(OPEN), b = body.indexOf(CLOSE);
  if (a < 0 || b < a) return null;
  return body.slice(0, a) + summary + body.slice(b + CLOSE.length);
}
