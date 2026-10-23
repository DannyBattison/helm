export interface Issue {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  author: string;
  comments: number;
  updated: string;
}

export interface Comment {
  author: string;
  body: string;
  /** File and line, for a comment on a diff. */
  path?: string;
  line?: number;
  at: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const cleanBody = (s: string) => s.replace(/\r\n/g, '\n').replace(/<!--[\s\S]*?-->/g, '').trim();

/** The task for a session that works on an issue: the issue, then the discussion, then what is expected. */
export function issueTask(issue: Issue, comments: Comment[]): string {
  const parts = [`Work on GitHub issue #${issue.number}: ${issue.title}`, issue.url, ''];
  if (issue.labels.length) parts.push(`Labels: ${issue.labels.join(', ')}`, '');
  parts.push(clip(cleanBody(issue.body) || '(no description)', 6000));
  const talk = comments.filter((c) => c.body.trim()).slice(-12);
  if (talk.length) parts.push('', '--- Discussion ---', ...talk.map((c) => `@${c.author}: ${clip(cleanBody(c.body), 1500)}`));
  parts.push('', `Fix it as the issue describes, add or update tests where the project has them, and commit with a message that refers to #${issue.number}. If something in the issue is unclear or contradicts the code, ask before guessing.`);
  return parts.join('\n');
}

/** Review feedback on a pull request, as a task for an agent to address. */
export function feedbackTask(pr: { number: number; title: string; url: string }, comments: Comment[]): string {
  const parts = [`Address the review feedback on pull request #${pr.number}: ${pr.title}`, pr.url, ''];
  const inline = comments.filter((c) => c.path);
  const general = comments.filter((c) => !c.path);
  if (inline.length) parts.push('Comments on the code:', ...inline.map((c) => `- ${c.path}${c.line ? ':' + c.line : ''} (@${c.author}): ${clip(cleanBody(c.body), 1500)}`), '');
  if (general.length) parts.push('General comments:', ...general.map((c) => `- @${c.author}: ${clip(cleanBody(c.body), 1500)}`), '');
  parts.push('Make the changes the reviewers ask for. Where you disagree with a comment, do not change the code; say why in your reply so the user can answer on the pull request.');
  return parts.join('\n');
}

/** The pull request number in a GitHub URL, or null. */
export const pullNumber = (url?: string) => { const m = url?.match(/\/pull\/(\d+)/); return m ? +m[1] : null; };
