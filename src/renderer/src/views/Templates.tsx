import React from 'react';
import { CONTEXT_VARS, MESSAGE_TEMPLATES, cleanMessageTemplates, templateVars, type PromptTemplate } from '@shared/templates';
import { api } from '../api';
import { useApp } from '../store';
import { Badge, Button, Input } from '../ui';
import { H, SettingRow } from './Settings';

const area: React.CSSProperties = { width: '100%', resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' };
const block: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: '14px 0', borderTop: '1px solid var(--border-subtle)' };
const sub: React.CSSProperties = { font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' };

/** A text that is saved when the box loses focus, so a half-typed variable is not sent on every key. */
function Draft({ value, onCommit, rows = 6, placeholder }: { value: string; onCommit(v: string): void; rows?: number; placeholder?: string }) {
  const [d, setD] = React.useState(value);
  React.useEffect(() => setD(value), [value]);
  return <textarea className="selectable" value={d} rows={rows} spellCheck={false} placeholder={placeholder} style={area} onChange={(e) => setD(e.target.value)} onBlur={() => { if (d !== value) onCommit(d); }} />;
}

const Vars = ({ names }: { names: { name: string; desc: string }[] }) => names.length
  ? <span style={{ ...sub, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>Variables: {names.map((v) => <span key={v.name} title={v.desc}><Badge>{`{{${v.name}}}`}</Badge></span>)}</span>
  : <span style={sub}>This message has no variables.</span>;

/** The messages helm sends to the agent on the user's behalf. In a repository, a text of its own overrides the default for that repository only. */
export function MessageTemplatesSection({ repoId }: { repoId: string | null }) {
  const app = useApp();
  const repo = repoId ? app.repos.find((r) => r.id === repoId) : undefined;
  const base = app.settings.messageTemplates || {};
  const own = repo?.settings?.messageTemplates || {};
  const save = (next: Record<string, string>) => {
    const clean = cleanMessageTemplates(next);
    if (repo) void api.setRepoSettings(repo.id, { ...repo.settings, ...(Object.keys(clean).length ? { messageTemplates: clean } : { messageTemplates: undefined }) });
    else void api.updateSettings({ messageTemplates: clean });
  };
  const mine = repo ? own : base;
  return <>
    <H sub={repo ? 'Wording of the messages helm sends to the agent in this repository. Anything you leave alone follows the defaults.' : 'The messages helm sends to the agent for you, such as Resolve on a conflict. Edit the wording; {{variables}} are filled in when the message is sent. Clearing a text restores the built-in one.'}>Messages to the agent</H>
    {MESSAGE_TEMPLATES.map((t) => {
      const overridden = t.id in mine;
      const inherited = base[t.id] ?? t.body;
      return <div key={t.id} style={block}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: '500 13px/1.5 var(--font-sans)', flex: 1 }}>{t.title}{overridden ? <> <Badge tone="attention">{repo ? 'overridden' : 'edited'}</Badge></> : null}</span>
          <Button size="sm" variant="ghost" icon="arrow-counter-clockwise" disabled={!overridden} onClick={() => { const next = { ...mine }; delete next[t.id]; save(next); }}>{repo ? 'Use default' : 'Restore built-in'}</Button>
        </div>
        <span style={sub}>{t.desc}</span>
        <Draft value={mine[t.id] ?? inherited} rows={Math.min(14, Math.max(3, (mine[t.id] ?? inherited).split('\n').length + 1))}
          onCommit={(v) => { const next = { ...mine }; if (!v.trim() || v === inherited) delete next[t.id]; else next[t.id] = v; save(next); }} />
        <Vars names={t.vars} />
      </div>;
    })}
  </>;
}

const newId = () => 'p' + Math.random().toString(36).slice(2, 10);

/** Prompts the user writes, to insert into a session from its message box. Global ones show in every repository; a repository can add its own. */
export function PromptTemplatesSection({ repoId }: { repoId: string | null }) {
  const app = useApp();
  const repo = repoId ? app.repos.find((r) => r.id === repoId) : undefined;
  const list: PromptTemplate[] = (repo ? repo.settings?.promptTemplates : app.settings.promptTemplates) || [];
  const inherited = repo ? app.settings.promptTemplates || [] : [];
  const save = (next: PromptTemplate[]) => { if (repo) void api.setRepoSettings(repo.id, { ...repo.settings, promptTemplates: next.length ? next : undefined }); else void api.updateSettings({ promptTemplates: next }); };
  const edit = (id: string, patch: Partial<PromptTemplate>) => save(list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return <>
    <H sub={`Reusable prompts for the message box of a session (the note icon beside the paperclip). Write {{name}} where a value goes and helm asks for it when you use the prompt. helm fills in ${CONTEXT_VARS.map((v) => `{{${v.name}}}`).join(', ')} itself.${repo ? ' A prompt here replaces a global one with the same name in this repository.' : ' A repository can add its own from its Settings tab.'}`}>Prompt templates</H>
    {inherited.length ? <SettingRow title="From the defaults" desc={inherited.map((p) => p.name || 'Untitled').join(', ')} /> : null}
    {list.map((p) => {
      const vars = templateVars(p.body).filter((v) => !CONTEXT_VARS.some((c) => c.name === v));
      return <div key={p.id} style={block}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input value={p.name} placeholder="Name, for example “Add tests”" onChange={(e: any) => edit(p.id, { name: e.target.value })} style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="trash" onClick={() => save(list.filter((x) => x.id !== p.id))}>Delete</Button>
        </div>
        <Draft value={p.body} rows={5} placeholder={'Write tests for {{area}}, following the style of the existing ones.'} onCommit={(v) => edit(p.id, { body: v })} />
        <span style={sub}>{vars.length ? <>Asks for: {vars.map((v) => <Badge key={v}>{v}</Badge>)}</> : 'No variables to ask for.'}</span>
      </div>;
    })}
    <div style={{ ...block, flexDirection: 'row' }}><Button size="sm" icon="plus" onClick={() => save([...list, { id: newId(), name: '', body: '' }])}>Add a prompt</Button></div>
  </>;
}
