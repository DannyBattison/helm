import type { Settings } from './types';

/** A variable a template may use, written `{{name}}` in its text. */
export interface TemplateVar { name: string; desc: string }

/** A message helm composes and sends to an agent on the user's behalf. The text is the default, which settings may replace. */
export interface MessageTemplate { id: string; title: string; desc: string; vars: TemplateVar[]; body: string }

/** A prompt the user wrote, to insert into a session's message box, optionally asking for values for its variables. */
export interface PromptTemplate { id: string; name: string; body: string }

const RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/** The distinct variable names in a text, in the order they first appear. */
export function templateVars(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * Fills `{{name}}` in a text. Names without a value are left as written, so a typo shows up in the message instead of vanishing.
 * A line holding only a variable whose value is empty is removed with one blank line next to it, so optional parts leave no gap.
 */
export function renderTemplate(body: string, values: Record<string, string>): string {
  const lines = body.split('\n');
  const lone = (l: string) => { const m = /^\s*\{\{\s*([A-Za-z_][\w-]*)\s*\}\}\s*$/.exec(l); return m && values[m[1]] === '' ? m : null; };
  const keep: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lone(lines[i])) { keep.push(lines[i]); continue; }
    if (lines[i + 1] !== undefined && !lines[i + 1].trim()) i++;
    else if (keep.length && !keep[keep.length - 1].trim()) keep.pop();
  }
  return keep.join('\n').replace(RE, (all, name: string) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : all));
}

const CONTINUE = 'Continue where you left off.';

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  { id: 'resolveConflict', title: 'Resolve a conflict', desc: 'Sent by Resolve (auto resolve) on a forecast conflict with the base branch or another session.',
    vars: [{ name: 'target', desc: 'What the branch would conflict with' }, { name: 'steps', desc: 'The git commands that start the merge' }],
    body: 'Your branch would conflict with {{target}}. Please resolve it now:\n\n1. Commit or set aside your uncommitted work first, so the merge can start.\n2. Run:\n{{steps}}\n3. Resolve every conflict, keeping the intent of both sides, then run the build and tests.\n4. Commit the merge.\n\nDo not discard either side\'s changes.' },
  { id: 'requestChanges', title: 'Review comments', desc: 'Sent when you request changes from the review screen.',
    vars: [{ name: 'comments', desc: 'One line per comment, with its file and line' }],
    body: 'Review comments from the user. Please address each one:\n\n{{comments}}' },
  { id: 'resume', title: 'Resume', desc: 'Sent when you resume a session, or resume all after pausing.', vars: [], body: CONTINUE },
  { id: 'resumeReopened', title: 'Resume after helm was closed', desc: 'Sent to sessions that were working when helm was closed.', vars: [], body: 'helm was closed while you were working and has been reopened. ' + CONTINUE },
  { id: 'planLimitContinued', title: 'Plan limit lifted', desc: 'Sent when you choose to continue a session paused at a plan usage limit you set.', vars: [], body: 'You were paused at a plan usage limit the user set, and they chose to continue. ' + CONTINUE },
  { id: 'planLimitReset', title: 'Plan limit reset', desc: 'Sent when the plan usage window that stopped a session has reset and automatic waking is on.', vars: [], body: 'Your plan usage limit has reset. ' + CONTINUE },
  { id: 'budgetRaised', title: 'Spending limit raised', desc: 'Sent when you add budget to a session or repository that stopped at its spending limit.', vars: [], body: 'You were paused at a spending limit and it has been raised. ' + CONTINUE },
  { id: 'userEdited', title: 'You edited a file', desc: 'Sent to a working agent when you change a file in its worktree from helm.', vars: [{ name: 'file', desc: 'The path of the file' }], body: 'Note from the user: they edited {{file}} directly in the worktree. Re-read it before changing it again.' },
  { id: 'selfReview', title: 'Self-review', desc: 'The prompt for the review of a session\'s changes. The reply must stay JSON with a summary and findings, or the review cannot be read.',
    vars: [{ name: 'task', desc: 'The session\'s task' }, { name: 'base', desc: 'The branch it is reviewed against' }],
    body: 'You are reviewing the work on this git branch before it is merged. The task the author was given:\n\n{{task}}\n\nReview the change against {{base}}: run `git merge-base HEAD {{base}}`, then `git diff <that commit>` and `git log`, and read the surrounding code where you need to. You may only read: do not edit files or run anything that changes the repository.\nLook for: bugs and wrong results; missing error handling at real boundaries; tests that are missing or do not test what they claim; changes outside the scope of the task; leftover debug code, secrets, or edits to lock files, CI config or generated files that nobody asked for.\nReport only what you are confident about. A blocker is something that should stop the merge. A warning is probably wrong or risky. A note is a smaller observation. If the change looks sound, say so and return no findings.\nAnswer with the JSON the schema asks for: a summary and a list of findings, each with a severity, the file and line when you know them, and what is wrong and why.' },
  { id: 'issueTask', title: 'Work on an issue', desc: 'The task of a session started from a GitHub issue.',
    vars: [{ name: 'number', desc: 'Issue number' }, { name: 'title', desc: 'Issue title' }, { name: 'url', desc: 'Issue link' }, { name: 'labels', desc: '“Labels: …”, empty when there are none' }, { name: 'body', desc: 'The issue description' }, { name: 'discussion', desc: 'The latest comments, empty when there are none' }],
    body: 'Work on GitHub issue #{{number}}: {{title}}\n{{url}}\n\n{{labels}}\n\n{{body}}\n\n{{discussion}}\n\nFix it as the issue describes, add or update tests where the project has them, and commit with a message that refers to #{{number}}. If something in the issue is unclear or contradicts the code, ask before guessing.' },
  { id: 'feedbackTask', title: 'Address pull request feedback', desc: 'The task of a session started from the review comments on a pull request, and the message sent to a session that has a pull request.',
    vars: [{ name: 'number', desc: 'Pull request number' }, { name: 'title', desc: 'Pull request title' }, { name: 'url', desc: 'Pull request link' }, { name: 'inline', desc: 'Comments on the code, empty when there are none' }, { name: 'general', desc: 'General comments, empty when there are none' }],
    body: 'Address the review feedback on pull request #{{number}}: {{title}}\n{{url}}\n\n{{inline}}\n\n{{general}}\n\nMake the changes the reviewers ask for. Where you disagree with a comment, do not change the code; say why in your reply so the user can answer on the pull request.' }
];

export const messageTemplate = (id: string) => MESSAGE_TEMPLATES.find((t) => t.id === id);

/** The text to use for a built-in message: the user's replacement when they wrote one, otherwise the default. */
export function messageBody(settings: Pick<Settings, 'messageTemplates'> | undefined, id: string): string {
  const own = settings?.messageTemplates?.[id];
  return typeof own === 'string' && own.trim() ? own : messageTemplate(id)?.body ?? '';
}

/** Fills the built-in message `id` from settings. */
export const composeMessage = (settings: Pick<Settings, 'messageTemplates'> | undefined, id: string, values: Record<string, string> = {}) => renderTemplate(messageBody(settings, id), values);

/** Keeps well formed overrides of known messages only. */
export function cleanMessageTemplates(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (input && typeof input === 'object') for (const t of MESSAGE_TEMPLATES) { const v = (input as any)[t.id]; if (typeof v === 'string' && v.trim()) out[t.id] = v; }
  return out;
}

export function cleanPromptTemplates(input: unknown): PromptTemplate[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: PromptTemplate[] = [];
  for (const p of input) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.body !== 'string' || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ id: p.id, name: p.name, body: p.body });
  }
  return out;
}

/** Variables helm fills in itself when a prompt is inserted into a session; the rest are asked for. */
export const CONTEXT_VARS: TemplateVar[] = [
  { name: 'repo', desc: 'The repository, owner/name' }, { name: 'branch', desc: 'The session\'s branch' }, { name: 'base', desc: 'The branch it started from' }, { name: 'task', desc: 'The session\'s task' }
];

/** The prompts available in a repository: its own, then the global ones it has not replaced by using the same name. */
export function promptsFor(global: PromptTemplate[] | undefined, own: PromptTemplate[] | undefined): (PromptTemplate & { scope: 'repo' | 'global' })[] {
  const mine = (own || []).map((p) => ({ ...p, scope: 'repo' as const }));
  const names = new Set(mine.map((p) => p.name.trim().toLowerCase()));
  return [...mine, ...(global || []).filter((p) => !names.has(p.name.trim().toLowerCase())).map((p) => ({ ...p, scope: 'global' as const }))];
}
