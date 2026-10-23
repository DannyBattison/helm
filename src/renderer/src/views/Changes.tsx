import React from 'react';
import type { ChangesSummary, DiffHunk, ReviewComment, Session } from '@shared/types';
import { api, platform } from '../api';
import { Hl } from '../Hl';
import { langFromPath } from '../highlight';
import { CHECK_RE } from '../lib';
import { go, toast, useApp, useTranscript } from '../store';
import { Avatar, BranchTag, Button, Checkbox, DiffStat, Grip, IconButton, Input, SegmentedControl, Select, usePaneWidth } from '../ui';

const label: React.CSSProperties = { font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
const sClr: Record<string, string> = { M: 'var(--status-attention-text)', A: 'var(--diff-add-fg)', D: 'var(--diff-del-fg)', R: 'var(--accent-text)' };
const MOD = () => (platform() === 'darwin' ? '⌘' : 'Ctrl+');
const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

/** Review comments live outside the component so they survive switching tabs. */
const pending = new Map<string, ReviewComment[]>();

type Row = [string, number | null, number | null, string];

export function DiffLine({ l, onComment, lang }: { l: Row; onComment(line: number): void; lang?: string | null }) {
  const [t, o, n, text] = l;
  const bg = t === '+' ? 'var(--diff-add-bg)' : t === '-' ? 'var(--diff-del-bg)' : 'transparent';
  const gut = t === '+' ? 'var(--diff-add-gutter)' : t === '-' ? 'var(--diff-del-gutter)' : 'transparent';
  const fg = t === '+' ? 'var(--diff-add-fg)' : t === '-' ? 'var(--diff-del-fg)' : 'var(--text-3)';
  return (
    <div className="helm-diff-line" style={{ display: 'grid', gridTemplateColumns: '44px 44px 20px minmax(0,1fr)', background: bg, font: '400 12px/20px var(--font-code)' }}>
      <span style={{ textAlign: 'right', paddingRight: 8, color: 'var(--text-disabled)', background: gut }}>{o || ''}</span>
      <span title={n ? 'Comment on this line' : undefined} onClick={() => n && onComment(n)} style={{ textAlign: 'right', paddingRight: 8, color: 'var(--text-disabled)', background: gut, cursor: n ? 'pointer' : 'default' }}>{n || ''}</span>
      <span style={{ textAlign: 'center', color: fg }}>{t === '-' ? '−' : t === '+' ? '+' : ''}</span>
      <span className="selectable" style={{ whiteSpace: 'pre', color: t === ' ' ? 'var(--text-2)' : 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', tabSize: 4 }}><Hl text={text} lang={lang} /></span>
    </div>
  );
}

export function SplitRows({ lines, onComment, lang }: { lines: Row[]; onComment(line: number): void; lang?: string | null }) {
  const out: React.ReactNode[] = [];
  let i = 0;
  const cell = (l: Row | null, side: 'l' | 'r') => {
    const t = l?.[0];
    const num = side === 'l' ? l?.[1] : l?.[2];
    const bg = !l ? 'var(--bg-hover)' : t === '+' ? 'var(--diff-add-bg)' : t === '-' ? 'var(--diff-del-bg)' : 'transparent';
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr)', background: bg, minWidth: 0 }}>
        <span onClick={() => side === 'r' && num && onComment(num)} style={{ textAlign: 'right', paddingRight: 8, color: 'var(--text-disabled)', cursor: side === 'r' && num ? 'pointer' : 'default' }}>{num || ''}</span>
        <span className="selectable" style={{ whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', tabSize: 4, color: t === ' ' ? 'var(--text-2)' : 'var(--text-1)' }}><Hl text={l?.[3] ?? ''} lang={lang} /></span>
      </div>
    );
  };
  while (i < lines.length) {
    if (lines[i][0] === ' ') { out.push(<div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', font: '400 12px/20px var(--font-code)' }}>{cell(lines[i], 'l')}{cell(lines[i], 'r')}</div>); i++; continue; }
    const dels: Row[] = [], adds: Row[] = [];
    while (i < lines.length && lines[i][0] === '-') dels.push(lines[i++]);
    while (i < lines.length && lines[i][0] === '+') adds.push(lines[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) out.push(<div key={i + '-' + k} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', font: '400 12px/20px var(--font-code)' }}>{cell(dels[k] || null, 'l')}{cell(adds[k] || null, 'r')}</div>);
  }
  return <>{out}</>;
}

function Thread({ c, onRemove }: { c: ReviewComment; onRemove(): void }) {
  const app = useApp();
  return (
    <div style={{ margin: '6px 12px 8px 108px', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden', fontFamily: 'var(--font-sans)' }}>
      <div style={{ display: 'flex', gap: 10, padding: 12 }}>
        <Avatar name={app.user?.login || 'you'} src={app.user?.avatar || undefined} size={20} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ font: '500 12px/1 var(--font-sans)' }}>{app.user?.login || 'you'} <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', marginLeft: 6 }}>line {c.line}</span></span>
          <span className="selectable" style={{ font: '400 13px/1.5 var(--font-sans)', whiteSpace: 'pre-wrap' }}>{c.text}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-raised)' }}>
        <i className="ph ph-robot" style={{ fontSize: 13, color: 'var(--text-3)' }} />
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-3)' }}>Comments are sent to the agent as one batch when you ask for changes.</span>
        <Button size="sm" variant="ghost" onClick={onRemove}>Resolve</Button>
      </div>
    </div>
  );
}

function Composer({ onSave, onCancel }: { onSave(t: string): void; onCancel(): void }) {
  const [t, setT] = React.useState('');
  return (
    <div style={{ margin: '6px 12px 8px 108px', borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', fontFamily: 'var(--font-sans)' }}>
      <textarea autoFocus value={t} onChange={(e) => setT(e.target.value)} rows={3} placeholder="Leave a comment for the agent"
        onKeyDown={(e) => { if (e.key === 'Enter' && (platform() === 'darwin' ? e.metaKey : e.ctrlKey) && t.trim()) onSave(t.trim()); if (e.key === 'Escape') onCancel(); }}
        style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', font: '400 13px/1.5 var(--font-sans)', padding: '10px 12px 4px' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: '4px 8px 8px' }}>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={!t.trim()} onClick={() => onSave(t.trim())}>Add comment</Button>
      </div>
    </div>
  );
}

export function Changes({ s }: { s: Session }) {
  const app = useApp();
  const transcript = useTranscript(s.id) || [];
  const [sum, setSum] = React.useState<ChangesSummary | null>(null);
  const [dirtySet, setDirtySet] = React.useState<Set<string>>(new Set());
  const [sel, setSel] = React.useState<string | null>(null);
  const [unchecked, setUnchecked] = React.useState<Set<string>>(new Set());
  const [hunks, setHunks] = React.useState<DiffHunk[] | null>(null);
  const [shown, setShown] = React.useState<Set<string>>(new Set());
  const [mode, setMode] = React.useState('u');
  const [comments, setComments] = React.useState<ReviewComment[]>(pending.get(s.id) || []);
  const [composing, setComposing] = React.useState<number | null>(null);
  const [branches, setBranches] = React.useState<string[]>([]);
  const [base, setBase] = React.useState(s.base.replace(/^origin\//, ''));
  const [title, setTitle] = React.useState(s.task);
  const [body, setBody] = React.useState('');
  const [draft, setDraft] = React.useState(false);
  const [rm, setRm] = React.useState(s.removeAfterMerge);
  const [busy, setBusy] = React.useState('');
  const bodyEdited = React.useRef(false);
  const [lw, lgrip, lreset] = usePaneWidth('changes-files', 280, 200, 560);
  const [rw, rgrip, rreset] = usePaneWidth('changes-pr', 340, 280, 620, -1);
  const sig = s.files + ':' + s.add + ':' + s.del + ':' + s.commits.length;

  const setC = (c: ReviewComment[]) => { pending.set(s.id, c); setComments(c); };

  React.useEffect(() => {
    let dead = false;
    Promise.all([api.changes(s.id), api.changedFiles(s.id)]).then(([c, d]) => {
      if (dead) return;
      setSum(c);
      setDirtySet(new Set(d.map((x) => x.path)));
      setSel((cur) => (cur && c.files.some((f) => f.path === cur) ? cur : c.files.find((f) => !f.generated)?.path || c.files[0]?.path || null));
    }).catch((e) => toast({ tone: 'error', title: 'Could not read changes', description: errText(e) }));
    return () => { dead = true; };
  }, [s.id, sig]);

  React.useEffect(() => { api.repoBranches(s.repoId).then(setBranches).catch(() => undefined); }, [s.repoId]);

  const file = sum?.files.find((f) => f.path === sel);
  const fileLang = sel ? langFromPath(sel) : null;
  const collapsed = !!file && (file.generated || file.add + file.del > 1500 || file.binary) && !shown.has(file.path);
  React.useEffect(() => {
    setHunks(null);
    if (!sel || collapsed) return;
    let dead = false;
    api.fileDiff(s.id, sel).then((h) => !dead && setHunks(h)).catch(() => !dead && setHunks([]));
    return () => { dead = true; };
  }, [sel, collapsed, sig, s.id]);

  // Suggested PR text. Stops updating once the user types in it.
  React.useEffect(() => {
    if (!sum || bodyEdited.current) return;
    const items = sum.commits.slice().reverse().map((c) => `- ${c.msg}`).join('\n');
    setBody(`${s.task}\n\n${items ? items + '\n\n' : ''}Created with helm · session ${s.id}`);
  }, [sum, s.id]);

  const checks = transcript.filter((e) => e.k === 'bash' && e.done && CHECK_RE.test(e.cmd)) as Extract<(typeof transcript)[number], { k: 'bash' }>[];
  const checked = (sum?.files || []).filter((f) => !unchecked.has(f.path));
  const allOn = unchecked.size === 0;
  const pickable = (p: string) => dirtySet.has(p);
  const toggle = (p: string) => setUnchecked((u) => { const n = new Set(u); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e) { toast({ tone: 'error', title: 'That did not work', description: errText(e) }); } finally { setBusy(''); }
  };
  const filesToStage = checked.map((f) => f.path).filter(pickable);
  const createPr = () => run('pr', async () => {
    const r = await api.createPr({ sessionId: s.id, base, title, body, draft, removeAfterMerge: rm, files: filesToStage, message: title });
    toast({ tone: 'ready', title: 'Pull request opened', description: r.url || undefined });
    if (r.url) void api.openExternal(r.url);
  });
  const commitOnly = () => run('commit', async () => { await api.commitOnly(s.id, filesToStage, title); toast({ tone: 'ready', title: 'Committed', description: `${filesToStage.length} files on ${s.branch}` }); });
  const requestChanges = () => run('req', async () => { await api.requestChanges(s.id, comments); setC([]); go({ screen: 'session', id: s.id, tab: 'conversation' }); });

  const lineComments = (n: number | null) => (n ? comments.filter((c) => c.file === sel && c.line === n) : []);
  const totalAdd = sum?.files.reduce((a, f) => a + f.add, 0) || 0, totalDel = sum?.files.reduce((a, f) => a + f.del, 0) || 0;

  const renderThreads = (n: number | null) => <>
    {lineComments(n).map((c, i) => <Thread key={i} c={c} onRemove={() => setC(comments.filter((x) => x !== c))} />)}
    {composing != null && composing === n ? <Composer onCancel={() => setComposing(null)} onSave={(t) => { setC([...comments, { file: sel!, line: n!, text: t }]); setComposing(null); }} /> : null}
  </>;

  if (sum && sum.files.length === 0) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <i className="ph ph-git-diff" style={{ fontSize: 28, color: 'var(--text-3)' }} />
        <span style={{ font: '500 13px/1.3 var(--font-sans)' }}>No changes yet</span>
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{s.id} has not changed anything relative to {s.base.replace(/^origin\//, '')}.</span>
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ position: 'relative', width: lw, flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
        <Grip onMouseDown={lgrip} onDoubleClick={lreset} />
        <div style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <Checkbox checked={allOn} onChange={(on) => setUnchecked(on ? new Set() : new Set((sum?.files || []).filter((f) => pickable(f.path)).map((f) => f.path)))} />
          <span style={{ flex: 1, font: '500 12px/1 var(--font-sans)' }}>{sum?.files.length ?? 0} files</span>
          <DiffStat additions={totalAdd} deletions={totalDel} blocks={false} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 4px 8px' }}>
          {(sum?.files || []).map((f) => {
            const on = f.path === sel;
            const parts = f.path.split('/');
            return (
              <div key={f.path} onClick={() => setSel(f.path)} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: on ? 'var(--bg-selected)' : 'transparent' }}>
                <span onClick={(e) => e.stopPropagation()}><Checkbox checked={!unchecked.has(f.path)} disabled={!pickable(f.path)} onChange={() => toggle(f.path)} /></span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ font: '400 12px/1.1 var(--font-mono)', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[parts.length - 1]}</span>
                  <span style={{ font: '400 10.5px/1.1 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts.slice(0, -1).join('/') || '.'}</span>
                </div>
                <span style={{ font: '400 10.5px/1 var(--font-mono)', color: 'var(--diff-add-fg)' }}>+{f.add}</span>
                <span style={{ font: '400 10.5px/1 var(--font-mono)', color: 'var(--diff-del-fg)' }}>−{f.del}</span>
                <span style={{ font: '500 11px/1 var(--font-mono)', width: 10, color: sClr[f.status] }}>{f.status}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)' }}>
        <div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
          <span style={{ font: '400 12.5px/1 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel}</span>
          {file ? <DiffStat additions={file.add} deletions={file.del} /> : null}
          <SegmentedControl size="sm" value={mode} onChange={setMode} options={[{ value: 'u', label: 'Unified' }, { value: 's', label: 'Split' }]} />
          <IconButton icon="code" label="Open in Code tab" size="sm" onClick={() => go({ screen: 'session', id: s.id, tab: 'code' })} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {collapsed && file ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 320, textAlign: 'center' }}>
                <i className="ph ph-file-dashed" style={{ fontSize: 28, color: 'var(--text-3)' }} />
                <span style={{ font: '500 13px/1.3 var(--font-sans)' }}>{file.binary ? 'Binary file' : file.generated ? 'Generated file, diff hidden' : 'Diff collapsed'}</span>
                <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{file.binary ? 'There is no text diff for this file.' : file.generated ? 'This looks like a lock file or generated output. Review the sources it came from instead.' : 'Large diffs are collapsed by default.'}</span>
                {!file.binary ? <Button size="sm" onClick={() => setShown(new Set(shown).add(file.path))}>Show diff</Button> : null}
              </div>
            </div>
          ) : hunks == null ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading diff…</div>
            : hunks.length === 0 ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>No textual changes.</div>
            : hunks.map((h, i) => (
              <div key={i}>
                <div style={{ padding: '6px 16px', font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--accent-text)', background: 'var(--accent-muted)' }}>{h.header}</div>
                {mode === 's' ? <SplitRows lines={h.lines} onComment={setComposing} lang={fileLang} />
                  : h.lines.map((l, j) => <React.Fragment key={j}><DiffLine l={l} onComment={setComposing} lang={fileLang} />{renderThreads(l[2])}</React.Fragment>)}
              </div>
            ))}
        </div>
      </div>

      <aside style={{ position: 'relative', width: rw, flex: 'none', borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
        <Grip edge="left" onMouseDown={rgrip} onDoubleClick={rreset} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Checks run by the agent</span>
            {checks.length === 0 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>The agent has not run tests or linters in this session.</span> : null}
            {checks.slice(-8).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className={'ph-fill ph-' + (c.ok ? 'check-circle' : 'x-circle')} style={{ fontSize: 14, color: c.ok ? 'var(--status-ready)' : 'var(--status-error)' }} />
                <span style={{ font: '400 12px/1 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cmd}</span>
                <span style={{ font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{c.meta}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Commits on {s.branch}</span>
            {sum && sum.commits.length === 0 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No commits yet. {sum.dirty} uncommitted {sum.dirty === 1 ? 'file' : 'files'} will be committed with the pull request.</span> : null}
            {(sum?.commits || []).map((c) => (
              <div key={c.hash} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{c.hash}</span>
                <span style={{ font: '400 12px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.msg}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={label}>Pull request</span>
            {s.prUrl ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>A pull request is open for this branch. <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal(s.prUrl!); }}>View on GitHub</a>. Creating another pushes new commits to the same branch.</div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>
              <Select size="sm" icon="git-branch" mono value={base} onChange={(e) => setBase(e.target.value)} options={[...new Set([base, ...branches])]} /><i className="ph ph-arrow-left" style={{ fontSize: 12 }} /><BranchTag name={s.branch} />
            </div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <textarea rows={8} value={body} onChange={(e) => { bodyEdited.current = true; setBody(e.target.value); }}
              style={{ resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px' }} />
            <Checkbox checked={draft} onChange={setDraft} label="Open as draft" />
            <Checkbox checked={rm} onChange={setRm} label="Remove worktree after merge" description={s.worktree} />
          </div>
        </div>
        <div style={{ flex: 'none', padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button variant="primary" icon="git-pull-request" kbd={MOD() + '↵'} fullWidth loading={busy === 'pr'} disabled={!title.trim() || !!busy || !app.user} onClick={createPr}>Create pull request</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button style={{ flex: 1 }} icon="chat-circle-text" disabled={comments.length === 0 || !!busy} loading={busy === 'req'} onClick={requestChanges}>Request changes · {comments.length}</Button>
            <Button variant="ghost" style={{ flex: 1 }} disabled={filesToStage.length === 0 || !!busy} loading={busy === 'commit'} onClick={commitOnly}>Commit only</Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
