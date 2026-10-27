import React from 'react';
import type { AskQuestion } from '@shared/types';
import { Button } from '../ui';

/** Whether one click on an option answers everything: a single question that takes a single choice. */
export const isQuickQuestion = (qs: AskQuestion[] | undefined) => qs?.length === 1 && !qs[0].multiSelect;

/**
 * Every question the agent asked, each with its options. A lone single-choice question answers on click; otherwise
 * choices are collected and sent together once each question has one.
 */
export function QuestionForm({ questions, onSubmit }: { questions: AskQuestion[]; onSubmit: (answers: Record<string, string>) => void }) {
  const [picked, setPicked] = React.useState<Record<number, string[]>>({});
  const quick = isQuickQuestion(questions);
  const toggle = (qi: number, label: string) => setPicked((p) => {
    const cur = p[qi] || [];
    const multi = questions[qi].multiSelect;
    return { ...p, [qi]: multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label] };
  });
  const complete = questions.every((_, qi) => (picked[qi] || []).length > 0);
  const submit = () => onSubmit(Object.fromEntries(questions.map((q, qi) => [q.question, (picked[qi] || []).join(', ')])));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {questions.map((q, qi) => (
        <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {q.header && questions.length > 1 ? <span style={{ font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{q.header}</span> : null}
          {questions.length > 1 ? <div className="selectable" style={{ font: '500 13px/1.45 var(--font-sans)' }}>{q.question}</div> : null}
          {q.multiSelect ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Choose any that apply.</span> : null}
          {q.options.map((o) => {
            const on = (picked[qi] || []).includes(o.label);
            return (
              <button key={o.label} type="button" className="helm-tap-row" aria-pressed={quick ? undefined : on}
                onClick={() => (quick ? onSubmit({ [q.question]: o.label }) : toggle(qi, o.label))}
                style={{ textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 'var(--radius-md)', background: on ? 'var(--status-attention-bg)' : 'var(--bg-raised)', boxShadow: `inset 0 0 0 ${on ? 2 : 1}px ${on ? 'var(--status-attention)' : 'var(--border-strong)'}`, color: 'var(--text-1)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>{o.label}</span>
                {o.description ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{o.description}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      {quick ? null : <div><Button size="sm" variant="primary" disabled={!complete} onClick={submit}>Send answers</Button></div>}
    </div>
  );
}
