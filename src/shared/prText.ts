import { renderTemplate } from './templates';

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

/** What a pull request's text is made from. `commits` are newest first, as git lists them. */
export interface PrContext { task: string; commits: { msg: string }[]; branch?: string; base?: string; issue?: number; files?: number; add?: number; del?: number }

/** The pull request text settings: a template for each part, or the agent writes both. Empty templates use the defaults below. */
export interface PrTextSettings { prAi?: boolean; prTitleTemplate?: string; prBodyTemplate?: string }

export const PR_TITLE_TEMPLATE = '{{commit}}';
export const PR_BODY_TEMPLATE = '{{commits}}\n\n{{stats}}\n\n{{issue}}';

/** The variables a pull request template may use. */
export const PR_VARS: { name: string; desc: string }[] = [
  { name: 'commit', desc: 'Subject of the first commit, or the task when there are none' },
  { name: 'commits', desc: 'Every commit subject as a list, oldest first' },
  { name: 'count', desc: 'Number of commits' },
  { name: 'task', desc: 'The task the session was given' },
  { name: 'branch', desc: 'The session branch' },
  { name: 'base', desc: 'The branch it merges into' },
  { name: 'files', desc: 'Number of files changed' },
  { name: 'stats', desc: 'Files changed with lines added and removed' },
  { name: 'issue', desc: '“Closes #n” when the task came from an issue' }
];

export function prVars(o: PrContext): Record<string, string> {
  const oldest = o.commits.slice().reverse();
  const stats = o.files ? `${o.files} ${o.files === 1 ? 'file' : 'files'} changed, +${o.add ?? 0} −${o.del ?? 0}` : '';
  return {
    commit: oldest[0]?.msg.split('\n')[0].trim() || prTitle(o.task),
    commits: oldest.map((c) => `- ${c.msg}`).join('\n'),
    count: String(o.commits.length),
    task: o.task.trim(),
    branch: o.branch || '',
    base: o.base || '',
    files: String(o.files || 0),
    stats,
    issue: o.issue ? `Closes #${o.issue}` : ''
  };
}

/** A title from the title template, never empty: it falls back to the task. */
export function prTitleFrom(s: PrTextSettings | undefined, o: PrContext): string {
  return prTitle(renderTemplate(s?.prTitleTemplate?.trim() || PR_TITLE_TEMPLATE, prVars(o))) || prTitle(o.task);
}

/** The part of a pull request description that helm writes and keeps current, from the body template. */
export function prSummary(o: PrContext, s?: PrTextSettings): string {
  return [OPEN, renderTemplate(s?.prBodyTemplate?.trim() || PR_BODY_TEMPLATE, prVars(o)).trim(), CLOSE].filter(Boolean).join('\n\n');
}

export const prBody = (summary: string, sessionId: string) => `${summary}\n\nCreated with helm · session ${sessionId}`;

/** Swaps the helm-written block in an existing description for a fresh one. Null when the description has no such block (the user rewrote it), so it is left alone. */
export function replaceSummary(body: string, summary: string): string | null {
  const a = body.indexOf(OPEN), b = body.indexOf(CLOSE);
  if (a < 0 || b < a) return null;
  return body.slice(0, a) + summary + body.slice(b + CLOSE.length);
}

export const PR_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A succinct, specific title a person can scan in a list: under 72 characters, no trailing period.' },
    body: { type: 'string', description: 'A short markdown summary of what changed and why, in plain language. Not the task text, and not a list of every commit.' }
  },
  required: ['title', 'body']
};

export const prPrompt = (o: PrContext): string =>
  `Write the title and description for a pull request into ${o.base || 'the base branch'} from the changes on this branch. Look at the commits and the diff (git log and git diff against ${o.base || 'the base'}).\n\nTask the branch was started from, for context only; do not repeat it:\n${o.task.trim()}\n\nThe title is specific and brief. The description summarises the changes for a reviewer: what changed and why it matters. Do not copy the task. Do not change any files.`;

/** Reads the title and description out of structured output, or failing that out of JSON in the reply text. */
export function parsePr(structured: unknown, text: string): { title: string; body: string } | null {
  let v: any = structured;
  if (!v || typeof v !== 'object') { try { v = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || ''); } catch { v = null; } }
  const title = prTitle(String(v?.title ?? ''));
  return title ? { title, body: String(v?.body ?? '').trim() } : null;
}
