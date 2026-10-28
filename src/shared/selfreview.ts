import type { SelfReview } from './types';
import { messageTemplate, renderTemplate } from './templates';

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

export const reviewPrompt = (task: string, base: string, template = messageTemplate('selfReview')!.body): string => renderTemplate(template, { task, base });

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
