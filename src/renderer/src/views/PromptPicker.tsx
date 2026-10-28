import React from 'react';
import type { Session as S } from '@shared/types';
import { CONTEXT_VARS, renderTemplate, templateVars, type PromptTemplate } from '@shared/templates';
import { repoSettings } from '../lib';
import { go, useApp } from '../store';
import { Button, ContextMenu, Dialog, IconButton, Input } from '../ui';

/** The button beside the paperclip: lists the user's prompt templates, asks for the values a chosen one needs, and hands back the filled text. */
export function PromptPicker({ s, onInsert }: { s: S; onInsert(text: string): void }) {
  const app = useApp();
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
  const [asking, setAsking] = React.useState<PromptTemplate | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const prompts = repoSettings(app, s.repoId).promptTemplates.filter((p) => p.body.trim());
  const known: Record<string, string> = { repo: s.repoId === '@free' ? '' : s.repoId, branch: s.branch, base: s.base, task: s.task };
  const needed = (p: PromptTemplate) => templateVars(p.body).filter((v) => !CONTEXT_VARS.some((c) => c.name === v));
  const use = (p: PromptTemplate) => {
    if (needed(p).length) { setValues({}); setAsking(p); } else onInsert(renderTemplate(p.body, known));
  };
  const fill = () => { if (asking) onInsert(renderTemplate(asking.body, { ...known, ...values })); setAsking(null); };
  return <>
    <IconButton icon="note-pencil" label={prompts.length ? 'Insert a prompt template' : 'Prompt templates: add some in Settings'} size="sm"
      onClick={(e: React.MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); if (prompts.length) setMenu({ x: r.left, y: Math.max(8, r.top - 8 - 32 * Math.min(prompts.length + 1, 8)) }); else go({ screen: 'settings', section: 'defaults' }); }} />
    {menu ? <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[...prompts.map((p) => ({ label: p.name || 'Untitled', icon: 'note-pencil', onClick: () => use(p) })), { label: 'Edit templates…', icon: 'gear', separator: true, onClick: () => go({ screen: 'settings', section: 'defaults' }) }]} /> : null}
    {asking ? <Dialog open width={460} title={asking.name || 'Prompt'} description="Fill in the values this prompt asks for." onClose={() => setAsking(null)}
      footer={<><Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button><Button variant="primary" onClick={fill}>Insert</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {needed(asking).map((v, i) => <label key={v} style={{ display: 'flex', flexDirection: 'column', gap: 4, font: '500 12px/1.5 var(--font-sans)' }}>{v}
          <Input autoFocus={i === 0} value={values[v] ?? ''} onChange={(e: any) => setValues({ ...values, [v]: e.target.value })} onKeyDown={(e: any) => { if (e.key === 'Enter') fill(); }} />
        </label>)}
      </div>
    </Dialog> : null}
  </>;
}
