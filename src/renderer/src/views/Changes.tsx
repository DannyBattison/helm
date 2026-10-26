import React from 'react';
import type { ChangesSummary, DiffHunk, ReviewComment, Session } from '@shared/types';
import { hunkId } from '@shared/hunks';
import { blockers } from '@shared/selfreview';
import { api, platform } from '../api';
import { Hl } from '../Hl';
import { langFromPath } from '../highlight';
import { CHECK_RE, relTime } from '../lib';
import { go, setUI, toast, useApp, useTranscript } from '../store';
import { Avatar, Badge, BranchTag, Button, Checkbox, DiffStat, Grip, IconButton, Input, SegmentedControl, Select, usePaneWidth } from '../ui';

const label: React.CSSProperties = { font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
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
          <span style={{ font: '500 12px/1.5 var(--font-sans)' }}>{app.user?.login || 'you'} <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', marginLeft: 6 }}>line {c.line}</span></span>
          <span className="selectable" style={{ font: '400 13px/1.5 var(--font-sans)', whiteSpace: 'pre-wrap' }}>{c.text}</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-raised)' }}>
        <i className="ph ph-robot" style={{ fontSize: 13, color: 'var(--text-3)' }} />
        <span style={{ flex: 1, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Comments are sent to the agent as one batch when you ask for changes.</span>
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

function HunkActions({ s, path, h, accepted, onAsk, onChanged }: { s: Session; path: string; h: DiffHunk; accepted: boolean; onAsk(): void; onChanged(): void }) {
  const [busy, setBusy] = React.useState(false);
  const id = hunkId(path, h);
  const revert = async () => {
    setBusy(true);
    try { await api.revertHunk(s.id, path, h); toast({ tone: 'neutral', title: 'Hunk reverted', description: 'The agent will be told you changed the file. A checkpoint of the earlier state is in Checkpoints.' }); onChanged(); }
    catch (e) { toast({ tone: 'error', title: 'Could not revert the hunk', description: errText(e) }); } finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 2, flex: 'none' }}>
      <Button size="sm" variant="ghost" icon={accepted ? 'check-circle' : 'circle'} onClick={() => void api.setHunksReviewed(s.id, [id], !accepted)}>{accepted ? 'Accepted' : 'Accept'}</Button>
      <Button size="sm" variant="ghost" icon="chat-circle-text" onClick={onAsk}>Ask</Button>
      <Button size="sm" variant="ghost" icon="arrow-u-up-left" loading={busy} onClick={() => void revert()}>Reject</Button>
    </span>
  );
}

const SEVERITY: Record<string, { tone: string; label: string }> = { blocker: { tone: 'error', label: 'Blocker' }, warning: { tone: 'attention', label: 'Warning' }, note: { tone: 'neutral', label: 'Note' } };

function ReviewPanel({ s, onOpen }: { s: Session; onOpen(file: string): void }) {
  const r = s.review;
  const head = s.commits[s.commits.length - 1]?.hash || '';
  // The review records the commit it saw; a later commit means it is out of date.
  const stale = !!r && r.state === 'done' && !!head && !r.head.startsWith(head.slice(0, 5)) && !head.startsWith(r.head.slice(0, 5));
  const run = () => api.startReview(s.id).catch((e) => toast({ tone: 'error', title: 'Could not start the review', description: errText(e) }));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...label, flex: 1 }}>Review by Claude</span>
        <Button size="sm" variant="secondary" icon="magnifying-glass" loading={r?.state === 'running'} disabled={s.worktreeGone} onClick={() => void run()}>{r ? 'Review again' : 'Review this branch'}</Button>
      </div>
      {!r ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>A separate, read-only Claude goes through the diff for bugs, missing tests and changes outside the task. It cannot edit anything.</span> : null}
      {r?.state === 'running' ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Reading the diff…</span> : null}
      {r?.state === 'failed' ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)' }}>{r.summary}</span> : null}
      {r?.state === 'done' ? <>
        <span className="selectable" style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-1)' }}>{r.summary}</span>
        {stale ? <span style={{ font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--status-attention-text)' }}>The branch has new commits since this review.</span> : null}
        {r.findings.length === 0 ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-ready-text)' }}><i className="ph ph-check-circle" /> No findings.</span> : null}
        {r.findings.map((f, i) => (
          <div key={i} onClick={() => f.file && onOpen(f.file)} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', cursor: f.file ? 'pointer' : 'default' }}>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <Badge tone={SEVERITY[f.severity].tone as any}>{SEVERITY[f.severity].label}</Badge>
              {f.file ? <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.file}{f.line ? ':' + f.line : ''}</span> : null}
            </span>
            <span className="selectable" style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{f.text}</span>
          </div>
        ))}
        {r.findings.length ? <Button size="sm" variant="ghost" icon="chat-circle-text" style={{ alignSelf: 'flex-start' }} onClick={() => void api.requestChanges(s.id, r.findings.filter((f) => f.severity !== 'note').map((f) => ({ file: f.file || 'General', line: f.line || 0, text: f.text }))).then(() => go({ screen: 'session', id: s.id, tab: 'conversation' }))}>Send blockers and warnings to the agent</Button> : null}
      </> : null}
    </div>
  );
}

/** A free agent's folder, when it is one of yours: there is no git history to compare against, so nothing to show. */
export function Changes({ s }: { s: Session }) {
  if (s.free && !s.free.managed) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 380, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <i className="ph ph-folder-simple" style={{ fontSize: 28, color: 'var(--text-3)' }} />
        <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>Changes are not tracked here</span>
        <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This agent works directly in your own folder, so helm has nothing to compare against and leaves git alone. Use your editor or git to see what it did.</span>
      </div>
    </div>
  );
  return <ChangesView s={s} />;
}

function ChangesView({ s }: { s: Session }) {
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
  const [delBranch, setDelBranch] = React.useState(s.deleteBranchAfterMerge ?? s.removeAfterMerge);
  const [deliver, setDeliver] = React.useState<'pr' | 'merge'>(app.settings.deliver);
  const prNum = s.prUrl && !s.mergedAt ? +(/\/pull\/(\d+)/.exec(s.prUrl)?.[1] || 0) || null : null;
  const openPr = deliver === 'pr' && !!prNum;
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => setArmed(false), [deliver, base, title]);
  const [busy, setBusy] = React.useState('');
  const bodyEdited = React.useRef(false);
  const [lw, lgrip, lreset] = usePaneWidth('changes-files', 280, 200, 560);
  const [rw, rgrip, rreset] = usePaneWidth('changes-pr', 340, 280, 620, -1);
  const [tick, setTick] = React.useState(0);
  const [fileHunks, setFileHunks] = React.useState<Record<string, string[]>>({});
  const sig = s.files + ':' + s.add + ':' + s.del + ':' + s.commits.length + ':' + tick;
  const accepted = React.useMemo(() => new Set(s.reviewed || []), [s.reviewed]);

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

  // Every file's hunk ids, for the "n of m hunks accepted" count. Read one at a time so a big change does not stall the view.
  React.useEffect(() => {
    if (!sum) return;
    let dead = false;
    (async () => {
      const next: Record<string, string[]> = {};
      for (const f of sum.files.filter((x) => !x.generated && !x.binary && x.add + x.del <= 1500).slice(0, 60)) {
        try { next[f.path] = (await api.fileDiff(s.id, f.path)).map((h) => hunkId(f.path, h)); } catch { /* file gone */ }
        if (dead) return;
      }
      if (!dead) setFileHunks(next);
    })();
    return () => { dead = true; };
  }, [sum, s.id]);

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
    setBody(`${s.task}\n\n${items ? items + '\n\n' : ''}${s.source?.kind === 'issue' ? `Closes #${s.source.number}\n\n` : ''}Created with helm · session ${s.id}`);
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
    const r = await api.createPr({ sessionId: s.id, base, title, body, draft, removeAfterMerge: rm, deleteBranchAfterMerge: delBranch, files: filesToStage, message: title });
    toast({ tone: 'ready', title: 'Pull request opened', description: r.url || undefined });
    if (r.url && app.settings.openPrAfterCreate) void api.openExternal(r.url);
  });
  const merge = () => run('merge', async () => {
    const r = await api.mergeDirect({ sessionId: s.id, base, message: title || s.task, files: filesToStage, removeAfterMerge: rm || delBranch, deleteBranchAfterMerge: delBranch });
    setArmed(false);
    toast({ tone: 'ready', title: `Merged into ${base}`, description: [`${r.sha} is on GitHub`, r.localUpdated ? `local ${base} updated` : r.localNote].filter(Boolean).join(' · ') });
    if (rm && app.settings.afterMerge === 'delete') go({ screen: 'overview' });
  });
  const commitOnly = () => run('commit', async () => { await api.commitOnly(s.id, filesToStage, title); toast({ tone: 'ready', title: 'Committed', description: `${filesToStage.length} files on ${s.branch}` }); });
  const requestChanges = () => run('req', async () => { await api.requestChanges(s.id, comments); setC([]); go({ screen: 'session', id: s.id, tab: 'conversation' }); });

  const lineComments = (n: number | null) => (n ? comments.filter((c) => c.file === sel && c.line === n) : []);
  const allIds = Object.values(fileHunks).flat();
  const totalHunks = allIds.length, doneHunks = allIds.filter((h) => accepted.has(h)).length;
  const openBlockers = blockers(s.review);
  const totalAdd = sum?.files.reduce((a, f) => a + f.add, 0) || 0, totalDel = sum?.files.reduce((a, f) => a + f.del, 0) || 0;

  const renderThreads = (n: number | null) => <>
    {lineComments(n).map((c, i) => <Thread key={i} c={c} onRemove={() => setC(comments.filter((x) => x !== c))} />)}
    {composing != null && composing === n ? <Composer onCancel={() => setComposing(null)} onSave={(t) => { setC([...comments, { file: sel!, line: n!, text: t }]); setComposing(null); }} /> : null}
  </>;

  if (sum && sum.files.length === 0) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <i className="ph ph-git-diff" style={{ fontSize: 28, color: 'var(--text-3)' }} />
        <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>No changes yet</span>
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{s.id} has not changed anything {s.free ? 'in its folder yet' : <>relative to {s.base.replace(/^origin\//, '')}</>}.</span>
      </div>
    </div>
  );

  return (
    <div className="helm-split" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="helm-list" style={{ position: 'relative', width: lw, flex: 'none', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)' }}>
        <Grip onMouseDown={lgrip} onDoubleClick={lreset} />
        <div style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px' }}>
          <Checkbox checked={allOn} onChange={(on) => setUnchecked(on ? new Set() : new Set((sum?.files || []).filter((f) => pickable(f.path)).map((f) => f.path)))} />
          <span style={{ flex: 1, font: '500 12px/1.5 var(--font-sans)' }} title="Hunks accepted, of all hunks in the change">{sum?.files.length ?? 0} files{totalHunks ? <span style={{ font: '400 11px/1.5 var(--font-mono)', color: doneHunks === totalHunks ? 'var(--status-ready-text)' : 'var(--text-3)', marginLeft: 8, whiteSpace: 'nowrap' }}>✓ {doneHunks}/{totalHunks}</span> : null}</span>
          {totalHunks && doneHunks < totalHunks ? <Button size="sm" variant="ghost" onClick={() => void api.setHunksReviewed(s.id, Object.values(fileHunks).flat(), true)}>Accept all</Button> : null}
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
                  <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[parts.length - 1]}</span>
                  <span style={{ font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts.slice(0, -1).join('/') || '.'}</span>
                </div>
                <span style={{ font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--diff-add-fg)' }}>+{f.add}</span>
                <span style={{ font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--diff-del-fg)' }}>−{f.del}</span>
                {fileHunks[f.path]?.length && fileHunks[f.path].every((h) => accepted.has(h)) ? <i className="ph-fill ph-check-circle" title="All hunks accepted" style={{ fontSize: 12, color: 'var(--status-ready)' }} /> : null}
                <span style={{ font: '500 11px/1.5 var(--font-mono)', width: 10, color: sClr[f.status] }}>{f.status}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="helm-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)' }}>
        <div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
          <span style={{ font: '400 12.5px/1.5 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel}</span>
          {file ? <DiffStat additions={file.add} deletions={file.del} /> : null}
          <SegmentedControl size="sm" value={mode} onChange={setMode} options={[{ value: 'u', label: 'Unified' }, { value: 's', label: 'Split' }]} />
          <IconButton icon="code" label="Open in Code tab" size="sm" onClick={() => go({ screen: 'session', id: s.id, tab: 'code' })} />
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {collapsed && file ? (
            <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, maxWidth: 320, textAlign: 'center' }}>
                <i className="ph ph-file-dashed" style={{ fontSize: 28, color: 'var(--text-3)' }} />
                <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>{file.binary ? 'Binary file' : file.generated ? 'Generated file, diff hidden' : 'Diff collapsed'}</span>
                <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{file.binary ? 'There is no text diff for this file.' : file.generated ? 'This looks like a lock file or generated output. Review the sources it came from instead.' : 'Large diffs are collapsed by default.'}</span>
                {!file.binary ? <Button size="sm" onClick={() => setShown(new Set(shown).add(file.path))}>Show diff</Button> : null}
              </div>
            </div>
          ) : hunks == null ? <div style={{ padding: 16, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Loading diff…</div>
            : hunks.length === 0 ? <div style={{ padding: 16, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No textual changes.</div>
            : hunks.map((h, i) => (
              <div key={i}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px 3px 16px', background: 'var(--accent-muted)' }}>
                  <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--accent-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.header}</span>
                  {sel ? <HunkActions s={s} path={sel} h={h} accepted={accepted.has(hunkId(sel, h))} onAsk={() => { const first = h.lines.find((l) => l[0] === '+' && l[2]) || h.lines.find((l) => l[2]); if (first) setComposing(first[2]); }} onChanged={() => setTick((t) => t + 1)} /> : null}
                </div>
                {mode === 's' ? <SplitRows lines={h.lines} onComment={setComposing} lang={fileLang} />
                  : h.lines.map((l, j) => <React.Fragment key={j}><DiffLine l={l} onComment={setComposing} lang={fileLang} />{renderThreads(l[2])}</React.Fragment>)}
              </div>
            ))}
        </div>
      </div>

      {s.free ? null : <aside style={{ position: 'relative', width: rw, flex: 'none', borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
        <Grip edge="left" onMouseDown={rgrip} onDoubleClick={rreset} />
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <ReviewPanel s={s} onOpen={(file) => { setSel(file); }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Checks run by the agent</span>
            {checks.length === 0 ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>The agent has not run tests or linters in this session.</span> : null}
            {checks.slice(-8).map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <i className={'ph-fill ph-' + (c.ok ? 'check-circle' : 'x-circle')} style={{ fontSize: 14, color: c.ok ? 'var(--status-ready)' : 'var(--status-error)' }} />
                <span style={{ font: '400 12px/1.5 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.cmd}</span>
                <span style={{ font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{c.meta}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={label}>Commits on {s.branch}</span>
            {sum && sum.commits.length === 0 ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No commits yet. {sum.dirty} uncommitted {sum.dirty === 1 ? 'file' : 'files'} will be committed with the pull request.</span> : null}
            {(sum?.commits || []).map((c) => (
              <div key={c.hash} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{c.hash}</span>
                <span style={{ font: '400 12px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.msg}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...label, flex: 1 }}>{deliver === 'pr' ? 'Pull request' : 'Merge'}</span>
              <SegmentedControl value={deliver} onChange={(v: string) => setDeliver(v as any)} options={[{ value: 'pr', label: 'Pull request' }, { value: 'merge', label: 'Merge directly' }]} />
            </div>
            {s.mergedAt ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>Merged into <b>{s.mergedInto}</b> {relTime(s.mergedAt)}. Merging again pushes anything new since.</div> : null}
            {openPr ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}><Button size="sm" variant="secondary" icon="chats" style={{ marginBottom: 8 }} onClick={() => void api.sendPrFeedback(s.id).then((n) => toast({ tone: n ? 'ready' : 'neutral', title: n ? `Sent ${n} review ${n === 1 ? 'comment' : 'comments'} to the agent` : 'No new review comments' })).catch((e) => toast({ tone: 'error', title: 'Could not read the review comments', description: errText(e) }))}>Send new review comments to the agent</Button><br />Pull request #{prNum} is open for this branch. <a href="#" onClick={(e) => { e.preventDefault(); void api.openExternal(s.prUrl!); }}>View on GitHub</a>. Commits pushed to <b>{s.branch}</b> join it.</div> : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
              <Select size="sm" icon="git-branch" mono value={base} onChange={(e) => setBase(e.target.value)} options={[...new Set([base, ...branches])]} /><i className="ph ph-arrow-left" style={{ fontSize: 12 }} /><BranchTag name={s.branch} />
            </div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={deliver === 'pr' && !openPr ? 'Title' : 'Commit message for uncommitted files'} />
            {deliver === 'merge' ? <div style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No pull request and no review: the branch is brought up to date with <b>{base}</b> (merging it in if needed), then pushed onto <b>{base}</b> on GitHub. If <b>{base}</b> is protected, GitHub refuses it.</div> : null}
            {deliver === 'pr' && !openPr ? <textarea rows={8} value={body} onChange={(e) => { bodyEdited.current = true; setBody(e.target.value); }}
              style={{ resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px' }} /> : null}
            {deliver === 'pr' && !openPr ? <Checkbox checked={draft} onChange={setDraft} label="Open as draft" /> : null}
            <Checkbox checked={rm || delBranch} disabled={delBranch} onChange={setRm} label="Remove worktree after merge" description={delBranch ? 'Needed to delete the branch' : s.worktree} />
            <Checkbox checked={delBranch} onChange={setDelBranch} label={<span>Delete the branch after merge <code style={{ font: 'var(--type-data)' }}>{s.branch}</code></span>} description="Here and on GitHub" />
          </div>
        </div>
        <div style={{ flex: 'none', padding: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {openBlockers || (totalHunks && doneHunks < totalHunks) ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--status-attention-text)' }}>
              {openBlockers ? <span><i className="ph ph-warning" /> The review found {openBlockers} {openBlockers === 1 ? 'blocker' : 'blockers'}.</span> : null}
              {totalHunks && doneHunks < totalHunks ? <span>{totalHunks - doneHunks} {totalHunks - doneHunks === 1 ? 'hunk' : 'hunks'} not yet accepted.</span> : null}
            </div>
          ) : null}
          {openPr
            ? <Button variant="primary" icon="git-merge" fullWidth disabled={!!busy} onClick={() => setUI({ mergingPr: { repoId: s.repoId, number: prNum!, sessionId: s.id } })}>Merge pull request #{prNum}</Button>
            : deliver === 'pr'
            ? <Button variant="primary" icon="git-pull-request" kbd={MOD() + '↵'} fullWidth loading={busy === 'pr'} disabled={!title.trim() || !!busy || !app.user} onClick={createPr}>Create pull request</Button>
            : <Button variant={armed ? 'danger' : 'primary'} icon="git-merge" fullWidth loading={busy === 'merge'} disabled={!!busy || (!sum?.commits.length && filesToStage.length === 0)} onClick={() => (armed ? merge() : setArmed(true))}>{armed ? `Push to ${base} on GitHub. Click again to confirm` : `Merge into ${base}`}</Button>}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button style={{ flex: 1 }} icon="chat-circle-text" disabled={comments.length === 0 || !!busy} loading={busy === 'req'} onClick={requestChanges}>Request changes · {comments.length}</Button>
            <Button variant="ghost" style={{ flex: 1 }} disabled={filesToStage.length === 0 || !!busy} loading={busy === 'commit'} onClick={commitOnly}>Commit only</Button>
          </div>
        </div>
      </aside>}
    </div>
  );
}
