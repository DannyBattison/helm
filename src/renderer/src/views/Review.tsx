import React from 'react';
import type { Checkpoint, Conflict, Effort, ModelAlias, Session } from '@shared/types';
import { sessionTitle } from '@shared/types';
import { api } from '../api';
import { ago, fmtTokens, relTime } from '../lib';
import { go, setUI, toast, useApp, useMoney } from '../store';
import { Badge, Button, Dialog, Select, StatusDot } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const fail = (title: string) => (e: any) => toast({ tone: 'error', title, description: errText(e) });
const clean = (label: string) => label.replace(/^Start: |^Before: /, '');

export const EFFORT_OPTIONS = [
  { value: 'default', label: 'Default effort' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }, { value: 'xhigh', label: 'Extra high' }, { value: 'max', label: 'Max' }
];

// ------------------------------------------------------------------ checkpoints
export function CheckpointsDialog({ id, onClose }: { id: string; onClose(): void }) {
  const [list, setList] = React.useState<Checkpoint[] | null>(null);
  React.useEffect(() => { api.checkpoints(id).then(setList).catch(() => setList([])); }, [id]);
  return (
    <Dialog width={560} title="Checkpoints" description="helm saves the worktree before each message you send, uncommitted and new files included. Restoring one puts everything back as it was." onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Close</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 360, overflow: 'auto' }}>
        {list == null ? <span style={{ font: '400 12.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>Reading…</span> : null}
        {list?.length === 0 ? <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No checkpoints yet. One is taken each time you send a message.</span> : null}
        {list?.slice().reverse().map((c) => (
          <div key={c.n} className="helm-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 8px', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ font: '500 11px/1 var(--font-mono)', color: 'var(--text-3)', width: 22 }}>#{c.n}</span>
            <span style={{ flex: 1, minWidth: 0, font: '400 12.5px/1.3 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.label}>{c.label.startsWith('Before restoring') ? c.label : clean(c.label)}</span>
            <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{relTime(c.at)}</span>
            <Button size="sm" variant="secondary" icon="clock-counter-clockwise" onClick={() => { onClose(); setUI({ restoring: { sessionId: id, n: c.n, label: c.label } }); }}>Restore</Button>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function RestoreDialog({ target, onClose }: { target: { sessionId: string; n: number; label: string }; onClose(): void }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const go_ = async () => {
    setBusy(true); setErr('');
    try { await api.restoreCheckpoint(target.sessionId, target.n); toast({ tone: 'ready', title: 'Restored', description: `Back to before “${clean(target.label)}”` }); onClose(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog width={500} title={`Restore checkpoint ${target.n}?`} onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="clock-counter-clockwise" loading={busy} onClick={go_}>Restore</Button>
      </>}>
      <div style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span>The worktree goes back to how it was just before <b style={{ color: 'var(--text-1)' }}>{clean(target.label)}</b>. Files the agent changed since, commits included, are undone, and the agent is told so with your next message.</span>
        <span>A checkpoint of the current state is taken first, so you can undo the restore from the Checkpoints list. The conversation itself is kept.</span>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ fork
export function ForkDialog({ target, onClose }: { target: { sessionId: string; index: number | null; text: string }; onClose(): void }) {
  const [task, setTask] = React.useState(target.text);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const start = async () => {
    setBusy(true); setErr('');
    try { const id = await api.forkSession(target.sessionId, target.index, task); onClose(); go({ screen: 'session', id, tab: 'conversation' }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog width={560} title="Fork into a new session" description={target.index == null ? 'A new session continues from this one as it is now.' : 'The new session has the conversation up to just before this message, and the worktree as it was then. This session is left as it is.'} onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="git-fork" loading={busy} disabled={!task.trim()} onClick={start}>Start fork</Button>
      </>}>
      <textarea autoFocus rows={5} value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should the fork do?"
        style={{ width: '100%', resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.55 var(--font-sans)', padding: '10px 12px' }} />
    </Dialog>
  );
}

export function ContinueDialog({ target, onClose }: { target: { repoId: string; externalId: string; title: string }; onClose(): void }) {
  const [task, setTask] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const start = async () => {
    setBusy(true); setErr('');
    try { const id = await api.continueExternal(target.repoId, target.externalId, task); onClose(); go({ screen: 'session', id, tab: 'conversation' }); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog width={560} title="Continue in helm" description={`“${target.title}” keeps running nowhere: helm copies its conversation into a new session with its own worktree, and carries on from there. The original is left untouched.`} onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="play" loading={busy} disabled={!task.trim()} onClick={start}>Continue</Button>
      </>}>
      <textarea autoFocus rows={4} value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should it do next?"
        style={{ width: '100%', resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.55 var(--font-sans)', padding: '10px 12px' }} />
    </Dialog>
  );
}

// ------------------------------------------------------------------ conflict forecast
export const useForecast = () => useApp().forecast || [];

const label = (c: Conflict, me?: string) => (me && c.a !== me ? c.a : c.b);

/** Sessions that would conflict, for the Overview. Each line opens one of the sessions. */
export function ForecastNotice({ conflicts }: { conflicts: Conflict[] }) {
  const app = useApp();
  if (!conflicts.length) return null;
  const name = (id: string) => { const s = app.sessions.find((x) => x.id === id); return s ? sessionTitle(s) : id; };
  return (
    <div style={{ borderRadius: 'var(--radius-lg)', background: 'var(--status-attention-bg)', boxShadow: 'inset 0 0 0 1px var(--status-attention)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '600 12.5px/1.2 var(--font-sans)', color: 'var(--status-attention-text)', display: 'flex', alignItems: 'center', gap: 6 }}><i className="ph ph-git-merge" />Merge conflicts ahead</span>
      {conflicts.slice(0, 6).map((c, i) => (
        <div key={i} style={{ font: '400 12.5px/1.45 var(--font-sans)', color: 'var(--text-1)' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: 'session', id: c.a, tab: 'changes' }); }}>{name(c.a)}</a>
          {' '}{c.kind === 'conflict' ? 'would conflict with' : 'edits the same files as'}{' '}
          {c.b.startsWith('origin/') ? <b>{c.b}</b> : <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: 'session', id: c.b, tab: 'changes' }); }}>{name(c.b)}</a>}
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)', marginLeft: 8 }}>{c.files.slice(0, 3).join(', ')}{c.files.length > 3 ? ` +${c.files.length - 3}` : ''}</span>
        </div>
      ))}
      {conflicts.length > 6 ? <span style={{ font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>and {conflicts.length - 6} more</span> : null}
    </div>
  );
}

export function SessionConflicts({ s }: { s: Session }) {
  const mine = useForecast().filter((c) => c.a === s.id || c.b === s.id);
  if (!mine.length) return null;
  const hard = mine.some((c) => c.kind === 'conflict');
  const text = mine.map((c) => `${c.kind === 'conflict' ? 'Conflicts with' : 'Same files as'} ${label(c, s.id)}: ${c.files.slice(0, 4).join(', ')}${c.files.length > 4 ? '…' : ''}`).join('\n');
  return <Badge tone={hard ? 'error' : 'attention'} icon="git-merge"><span title={text}>{hard ? 'Would conflict' : 'Overlaps'} · {mine.length}</span></Badge>;
}

// ------------------------------------------------------------------ compare
/** The sessions started from one prompt, side by side. */
export function Compare({ group }: { group: string }) {
  const app = useApp();
  const { fmt } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const members = app.sessions.filter((s) => s.group === group);
  const [busy, setBusy] = React.useState('');
  const keep = async (id: string) => {
    setBusy(id);
    try { await api.keepFromGroup(group, id); toast({ tone: 'ready', title: 'Kept ' + id, description: 'The others were stopped and archived.' }); go({ screen: 'session', id, tab: 'changes' }); }
    catch (e) { fail('Could not keep it')(e); } finally { setBusy(''); }
  };
  if (!members.length) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This group has no sessions any more.</div>;
  const live = members.filter((s) => !s.archivedAt);
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h1 style={{ margin: 0, font: '600 20px/1.2 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>Compare runs</h1>
        <span style={{ font: '400 12.5px/1.45 var(--font-sans)', color: 'var(--text-3)', maxWidth: 780 }}>{members[0].task}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(members.length, 4)}, minmax(240px, 1fr))`, gap: 12 }}>
        {members.map((s) => {
          const tokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead;
          return (
            <div key={s.id} style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: `inset 0 0 0 1px ${s.archivedAt ? 'var(--border-subtle)' : 'var(--border)'}`, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, opacity: s.archivedAt ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <StatusDot status={s.status} />
                <span style={{ font: '600 13px/1.2 var(--font-mono)' }}>{s.model}{s.effort ? ` · ${s.effort}` : ''}</span>
                {s.archivedAt ? <Badge>Archived</Badge> : null}
              </div>
              <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-2)', minHeight: 34 }}>{s.step}</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, font: '400 12px/1.2 var(--font-mono)' }}>
                <span style={{ color: 'var(--text-3)' }}>Files</span><span>{s.files}</span>
                <span style={{ color: 'var(--text-3)' }}>Lines</span><span><span style={{ color: 'var(--diff-add-fg)' }}>+{s.add}</span> <span style={{ color: 'var(--diff-del-fg)' }}>−{s.del}</span></span>
                <span style={{ color: 'var(--text-3)' }}>Commits</span><span>{s.commits.length}</span>
                <span style={{ color: 'var(--text-3)' }}>Tokens</span><span>{fmtTokens(tokens)}</span>
                {sub ? null : <><span style={{ color: 'var(--text-3)' }}>Cost</span><span>{fmt(s.cost)}</span></>}
                <span style={{ color: 'var(--text-3)' }}>Started</span><span>{ago(s.startedAt)} ago</span>
                {s.review?.state === 'done' ? <><span style={{ color: 'var(--text-3)' }}>Review</span><span>{s.review.findings.filter((f) => f.severity === 'blocker').length} blockers</span></> : null}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                <Button size="sm" variant="secondary" icon="arrow-square-out" onClick={() => go({ screen: 'session', id: s.id, tab: s.files ? 'changes' : 'conversation' })}>Open</Button>
                {!s.archivedAt && live.length > 1 ? <Button size="sm" variant="primary" icon="check" loading={busy === s.id} onClick={() => void keep(s.id)}>Keep this one</Button> : null}
              </div>
            </div>
          );
        })}
      </div>
      <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>“Keep this one” stops and archives the others. Their branches and worktrees stay until you delete them from the Archive.</span>
    </div>
  );
}

// ------------------------------------------------------------------ variants for a compare run
export interface Variant { model: ModelAlias; effort: Effort | 'default' }

export function VariantEditor({ variants, onChange }: { variants: Variant[]; onChange(v: Variant[]): void }) {
  const set = (i: number, patch: Partial<Variant>) => onChange(variants.map((v, k) => (k === i ? { ...v, ...patch } : v)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {variants.map((v, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ font: '500 11px/1 var(--font-mono)', color: 'var(--text-3)', width: 14 }}>{i + 1}</span>
          <Select value={v.model} onChange={(e: any) => set(i, { model: e.target.value })} options={[{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }]} style={{ flex: 1 }} />
          <Select value={v.effort} onChange={(e: any) => set(i, { effort: e.target.value })} options={EFFORT_OPTIONS} style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="x" disabled={variants.length <= 2} onClick={() => onChange(variants.filter((_, k) => k !== i))} />
        </div>
      ))}
      {variants.length < 4 ? <Button size="sm" variant="ghost" icon="plus" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...variants, { model: 'sonnet', effort: 'default' }])}>Add a run</Button> : null}
    </div>
  );
}

// ------------------------------------------------------------------ remember
const TARGETS = [
  { value: 'repo', label: 'This repository: CLAUDE.md (shared with the team)' },
  { value: 'local', label: 'This repository: CLAUDE.local.md (just you)' },
  { value: 'user', label: 'Everywhere: ~/.claude/CLAUDE.md' }
];

/** Turns something you told an agent into a standing instruction in a CLAUDE.md, so later sessions start knowing it. */
export function RememberDialog({ target, onClose }: { target: { repoId: string; text: string }; onClose(): void }) {
  const [text, setText] = React.useState(target.text.split('\n')[0].slice(0, 300));
  const [where, setWhere] = React.useState('repo');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { const f = await api.rememberInstruction(target.repoId, where as 'repo' | 'local' | 'user', text); toast({ tone: 'ready', title: 'Added to your instructions', description: f }); onClose(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog width={560} title="Remember this" description="Write it the way you would tell a new colleague. It is added under “Learned in helm” and read at the start of every session in the repository." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="bookmark-simple" loading={busy} disabled={text.trim().length < 3} onClick={save}>Add</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: run npm test before committing"
          style={{ width: '100%', resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.55 var(--font-sans)', padding: '10px 12px' }} />
        <Select value={where} onChange={(e: any) => setWhere(e.target.value)} options={TARGETS} />
      </div>
    </Dialog>
  );
}
