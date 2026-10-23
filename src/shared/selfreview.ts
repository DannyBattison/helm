import type { SelfReview } from './types';

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences: does this change do what the task asked, and is it safe to merge?' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['blocker', 'warning', 'note'] },
          file: { type: 'string' },
          line: { type: 'integer' },
          text: { type: 'string' }
        },
        required: ['severity', 'text']
      }
    }
  },
  required: ['summary', 'findings']
};

export function reviewPrompt(task: string, base: string): string {
  return [
    `You are reviewing the work on this git branch before it is merged. The task the author was given:`,
    '', task, '',
    `Review the change against ${base}: run \`git merge-base HEAD ${base}\`, then \`git diff <that commit>\` and \`git log\`, and read the surrounding code where you need to. You may only read: do not edit files or run anything that changes the repository.`,
    'Look for: bugs and wrong results; missing error handling at real boundaries; tests that are missing or do not test what they claim; changes outside the scope of the task; leftover debug code, secrets, or edits to lock files, CI config or generated files that nobody asked for.',
    'Report only what you are confident about. A blocker is something that should stop the merge. A warning is probably wrong or risky. A note is a smaller observation. If the change looks sound, say so and return no findings.',
    'Answer with the JSON the schema asks for: a summary and a list of findings, each with a severity, the file and line when you know them, and what is wrong and why.'
  ].join('\n');
}

type Finding = SelfReview['findings'][number];

/** Reads the review out of structured output, or failing that out of JSON in the reply text. */
export function parseReview(structured: unknown, text: string): { summary: string; findings: Finding[] } | null {
  const take = (x: any) => {
    if (!x || typeof x !== 'object' || typeof x.summary !== 'string') return null;
    const findings: Finding[] = (Array.isArray(x.findings) ? x.findings : [])
      .filter((f: any) => f && typeof f.text === 'string' && f.text.trim())
      .map((f: any) => ({ severity: ['blocker', 'warning', 'note'].includes(f.severity) ? f.severity : 'note', file: typeof f.file === 'string' && f.file ? f.file : undefined, line: Number.isInteger(f.line) && f.line > 0 ? f.line : undefined, text: String(f.text).trim() }));
    return { summary: x.summary.trim(), findings };
  };
  const direct = take(structured);
  if (direct) return direct;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate) continue;
    try { const r = take(JSON.parse(candidate)); if (r) return r; } catch { /* not JSON */ }
  }
  return null;
}

export const blockers = (r?: SelfReview) => (r?.state === 'done' ? r.findings.filter((f) => f.severity === 'blocker').length : 0);
