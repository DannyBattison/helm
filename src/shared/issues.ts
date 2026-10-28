import { messageTemplate, renderTemplate } from './templates';

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

/** The task for a session that works on an issue: the issue, then the discussion, then what is expected. `template` overrides the wording. */
export function issueTask(issue: Issue, comments: Comment[], template = messageTemplate('issueTask')!.body): string {
  const talk = comments.filter((c) => c.body.trim()).slice(-12);
  return renderTemplate(template, {
    number: String(issue.number), title: issue.title, url: issue.url,
    labels: issue.labels.length ? `Labels: ${issue.labels.join(', ')}` : '',
    body: clip(cleanBody(issue.body) || '(no description)', 6000),
    discussion: talk.length ? ['--- Discussion ---', ...talk.map((c) => `@${c.author}: ${clip(cleanBody(c.body), 1500)}`)].join('\n') : ''
  });
}

/** Review feedback on a pull request, as a task for an agent to address. `template` overrides the wording. */
export function feedbackTask(pr: { number: number; title: string; url: string }, comments: Comment[], template = messageTemplate('feedbackTask')!.body): string {
  const inline = comments.filter((c) => c.path);
  const general = comments.filter((c) => !c.path);
  return renderTemplate(template, {
    number: String(pr.number), title: pr.title, url: pr.url,
    inline: inline.length ? ['Comments on the code:', ...inline.map((c) => `- ${c.path}${c.line ? ':' + c.line : ''} (@${c.author}): ${clip(cleanBody(c.body), 1500)}`)].join('\n') : '',
    general: general.length ? ['General comments:', ...general.map((c) => `- @${c.author}: ${clip(cleanBody(c.body), 1500)}`)].join('\n') : ''
  });
}

/** The pull request number in a GitHub URL, or null. */
export const pullNumber = (url?: string) => { const m = url?.match(/\/pull\/(\d+)/); return m ? +m[1] : null; };
