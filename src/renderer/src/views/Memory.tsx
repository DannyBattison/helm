import React from 'react';
import type { HealthIssue, MemoryEntry, MemoryUsage, ProjectMemory, Repo as R } from '@shared/types';
import { api } from '../api';
import { relTime, tilde } from '../lib';
import { toast, useApp } from '../store';
import { Badge, Button, Input, SegmentedControl, Skeleton } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const TYPE_TONE: Record<string, string> = { user: 'working', feedback: 'attention', project: 'ready', reference: 'neutral' };
const muted: React.CSSProperties = { font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' };

/** The text of a memory file without its `---` header, which is shown as badges instead. */
const body = (t: string) => t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').replace(/^\s+/, '');

/** Prose with [[memory-name]] and [text](file.md) turned into links to those memories. */
function Prose({ text, open }: { text: string; open(target: string): void }) {
  const parts = text.split(/(\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\.md\))/g);
  return (
    <div className="selectable" style={{ font: '400 13px/1.6 var(--font-sans)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((p, i) => {
        const w = /^\[\[([^\]]+)\]\]$/.exec(p);
        const l = /^\[([^\]]+)\]\(([^)\s]+\.md)\)$/.exec(p);
        const target = w ? w[1] : l ? l[2] : '';
        return target ? <a key={i} href="#" onClick={(e) => { e.preventDefault(); open(target); }} style={{ color: 'var(--accent-text, var(--accent))' }}>{w ? w[1] : l![1]}</a> : <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </div>
  );
}

export function RepoMemory({ repo }: { repo: R }) {
  const app = useApp();
  const [mem, setMem] = React.useState<ProjectMemory | null>(null);
  const [err, setErr] = React.useState('');
  const [sel, setSel] = React.useState<string | null>(null);
  const [text, setText] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [type, setType] = React.useState('all');
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [bodies, setBodies] = React.useState<Record<string, string>>({});
  const [ins, setIns] = React.useState<{ usage: Record<string, MemoryUsage>; issues: HealthIssue[]; sessions: number } | null>(null);
  const [flagged, setFlagged] = React.useState(false);

  const load = React.useCallback(() => {
    api.projectMemory(repo.id).then((m) => { setMem(m); setErr(''); }).catch((e) => { setErr(errText(e)); setMem({ dir: null, memories: [], instructions: [] }); });
    // Reading every session's conversation takes a moment, so it comes after the list.
    api.memoryInsights(repo.id).then(setIns).catch(() => setIns(null));
  }, [repo.id]);
  React.useEffect(() => { setMem(null); setSel(null); setBodies({}); load(); }, [repo.id]);

  const all = mem ? [...mem.instructions, ...mem.memories] : [];
  const cur = all.find((e) => e.path === sel) || null;
  React.useEffect(() => {
    setText(null); setDraft(null); setConfirm(false);
    if (cur) api.readMemory(repo.id, cur.path).then(setText).catch((e) => setErr(errText(e)));
  }, [sel]);
  // Searching reads every file once, so a match inside the text counts and not only the name.
  React.useEffect(() => {
    if (!q.trim() || !mem) return;
    const need = mem.memories.filter((m) => !(m.path in bodies));
    if (!need.length) return;
    let dead = false;
    Promise.all(need.map((m) => api.readMemory(repo.id, m.path).then((t) => [m.path, t] as const).catch(() => [m.path, ''] as const)))
      .then((rows) => { if (!dead) setBodies((b) => ({ ...b, ...Object.fromEntries(rows) })); });
    return () => { dead = true; };
  }, [q, mem]);

  const needle = q.trim().toLowerCase();
  const issuesOf = (m: MemoryEntry) => (ins?.issues || []).filter((i) => i.path === m.path);
  const hit = (m: MemoryEntry) => (type === 'all' || m.type === type) && (!flagged || issuesOf(m).length > 0) && (!needle || [m.name, m.description, m.file, bodies[m.path] || ''].some((s) => s.toLowerCase().includes(needle)));
  const memories = (mem?.memories || []).filter((m) => !m.index).filter(hit).sort((a, b) => b.modified - a.modified);
  const index = mem?.memories.find((m) => m.index);
  const types = ['all', ...Array.from(new Set((mem?.memories || []).filter((m) => !m.index && m.type).map((m) => m.type)))];

  const openTarget = (t: string) => {
    const base = t.replace(/\.md$/, '');
    const e = mem?.memories.find((m) => m.file === t || m.file.replace(/\.md$/, '') === base || m.name === base);
    if (e) setSel(e.path); else toast({ tone: 'neutral', title: 'No memory by that name', description: t });
  };
  const save = async () => {
    if (!cur || draft == null) return;
    setBusy(true);
    try { await api.writeMemory(repo.id, cur.path, draft); setText(draft); setDraft(null); setBodies((b) => ({ ...b, [cur.path]: draft })); load(); }
    catch (e) { toast({ tone: 'error', title: 'Could not save', description: errText(e) }); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!cur) return;
    setBusy(true);
    try { await api.deleteMemory(repo.id, cur.path); setSel(null); load(); toast({ tone: 'neutral', title: 'Memory deleted', description: cur.file }); }
    catch (e) { toast({ tone: 'error', title: 'Could not delete', description: errText(e) }); } finally { setBusy(false); setConfirm(false); }
  };

  const row = (e: MemoryEntry, icon: string) => (
    <div key={e.path} className="helm-row-hover" onClick={() => setSel(e.path)} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '8px 14px', cursor: 'pointer', borderTop: '1px solid var(--border-subtle)', background: sel === e.path ? 'var(--bg-raised)' : undefined }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <i className={`ph ph-${icon}`} style={{ fontSize: 14, color: 'var(--text-3)', flex: 'none' }} />
        <span style={{ font: '600 12.5px/1.3 var(--font-sans)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.kind === 'instructions' || e.index ? e.file : e.name}</span>
        {e.kind === 'memory' && !e.index && issuesOf(e).length ? <i className="ph ph-warning" title={issuesOf(e).map((i) => i.text).join('\n')} style={{ fontSize: 13, color: 'var(--status-attention-text)' }} /> : null}
        {e.kind === 'memory' && !e.index && ins ? <span title={ins.usage[e.file] ? `Read in ${ins.usage[e.file].sessions} of ${ins.sessions} sessions` : 'No session has read this'} style={{ font: '400 10.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{ins.usage[e.file]?.sessions ?? 0}×</span> : null}
        {e.type ? <Badge tone={TYPE_TONE[e.type] as any}>{e.type}</Badge> : null}
      </div>
      {e.description || e.kind === 'instructions' ? <div style={{ ...muted, paddingLeft: 21, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.description || tilde(e.path, app.home)}</div> : null}
    </div>
  );
  const heading = (t: string) => <div style={{ padding: '10px 14px 6px', font: '600 10.5px/1 var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{t}</div>;

  if (!mem) return <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>{[60, 80, 50, 70].map((w, i) => <Skeleton key={i} w={w + '%'} h={14} />)}</div>;
  const empty = !mem.memories.length && !mem.instructions.length;
  return (
    <div className="helm-split" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="helm-list" style={{ width: 380, flex: 'none', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, flex: 'none' }}>
          <Input value={q} placeholder={`Search ${mem.memories.filter((m) => !m.index).length} memories`} onChange={(e: any) => setQ(e.target.value)} />
          {ins && ins.issues.length ? <div onClick={() => setFlagged(!flagged)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: flagged ? 'var(--status-attention-bg)' : 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px ' + (flagged ? 'var(--status-attention)' : 'var(--border)'), font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-2)' }}><i className="ph ph-warning" style={{ color: 'var(--status-attention-text)' }} />{new Set(ins.issues.map((i) => i.path)).size} {new Set(ins.issues.map((i) => i.path)).size === 1 ? 'memory needs' : 'memories need'} a look<span style={{ flex: 1 }} /><span style={{ color: 'var(--text-3)' }}>{flagged ? 'Show all' : 'Show only these'}</span></div> : null}
          {types.length > 2 ? <SegmentedControl value={type} onChange={setType} options={types.map((t) => ({ value: t, label: t === 'all' ? 'All' : t }))} /> : null}
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {err ? <div style={{ ...muted, padding: '0 14px 10px', color: 'var(--status-error-text)' }}>{err}</div> : null}
          {empty ? <div style={{ ...muted, padding: '8px 14px' }}>Claude Code has not saved any memory for this repository yet, and there is no CLAUDE.md. Memories appear here once an agent writes one.</div> : null}
          {mem.instructions.length && !needle ? <>{heading('Instructions')}{mem.instructions.map((e) => row(e, 'scroll'))}</> : null}
          {index && !needle && type === 'all' ? <>{heading('Index')}{row(index, 'list-bullets')}</> : null}
          {mem.memories.length ? <>{heading(`Memories · ${memories.length}`)}{memories.map((e) => row(e, 'brain'))}</> : null}
          {needle && !memories.length ? <div style={{ ...muted, padding: '8px 14px' }}>Nothing matches.</div> : null}
        </div>
        {mem.dir ? <div title={mem.dir} style={{ ...muted, flex: 'none', padding: '8px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', font: '400 11px/1.3 var(--font-mono)' }}>{tilde(mem.dir, app.home)}</span>
          <Button size="sm" variant="ghost" icon="folder-open" onClick={() => api.openFolder(mem.dir!)}>Open</Button>
        </div> : null}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {!cur ? <div style={{ ...muted, padding: 24, maxWidth: 520 }}>Pick a memory to read it. Claude loads the index at the start of every session in this repository, and reads individual memories when they look relevant. Edit or delete one here and the next session sees the change.</div> : <>
          <div style={{ flex: 'none', padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: '600 15px/1.25 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cur.kind === 'memory' && !cur.index ? cur.name : cur.file}</div>
              <div style={{ font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--text-3)', marginTop: 3 }} title={cur.path}>{cur.kind === 'memory' ? cur.file : tilde(cur.path, app.home)} · changed {relTime(cur.modified)}{ins && cur.kind === 'memory' && !cur.index ? ` · read in ${ins.usage[cur.file]?.sessions ?? 0} of ${ins.sessions} sessions${ins.usage[cur.file] ? ', last ' + relTime(ins.usage[cur.file].last) : ''}` : ''}</div>
              {issuesOf(cur).map((i, n) => <div key={n} style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--status-attention-text)', marginTop: 4, display: 'flex', gap: 6 }}><i className="ph ph-warning" style={{ marginTop: 2 }} />{i.text}</div>)}
            </div>
            {cur.type ? <Badge tone={TYPE_TONE[cur.type] as any}>{cur.type}</Badge> : null}
            {draft == null ? <Button size="sm" variant="secondary" icon="pencil-simple" disabled={text == null} onClick={() => setDraft(text ?? '')}>Edit</Button> : <>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={draft === text} onClick={save}>Save</Button>
            </>}
            {cur.kind === 'memory' && !cur.index && draft == null ? (confirm
              ? <><Button size="sm" variant="danger" loading={busy} onClick={remove}>Delete it</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button></>
              : <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirm(true)}>Delete</Button>) : null}
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 20px 28px' }}>
            {text == null ? <Skeleton w="60%" h={12} /> : draft != null
              ? <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} autoFocus style={{ width: '100%', height: '100%', minHeight: 300, resize: 'none', boxSizing: 'border-box', padding: 12, borderRadius: 'var(--radius-md)', border: 0, outline: 0, boxShadow: 'inset 0 0 0 1px var(--border)', background: 'var(--bg-editor)', color: 'var(--text-1)', font: 'var(--type-data)', lineHeight: 1.55 }} />
              : <div style={{ maxWidth: 760 }}>
                {cur.description ? <div style={{ ...muted, fontSize: 13, marginBottom: 14, fontStyle: 'italic' }}>{cur.description}</div> : null}
                <Prose text={cur.kind === 'memory' ? body(text) : text} open={openTarget} />
              </div>}
          </div>
        </>}
      </div>
    </div>
  );
}
