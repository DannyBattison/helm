import React from 'react';
import type { DiffHunk, ExternalSession, FileChange, HistoryCommit, PullRequest, Repo as R, TranscriptEvent, WorktreeInfo } from '@shared/types';
import { api, platform } from '../api';
import { fmtTokens, lifetimeTokens, money, relTime, tilde } from '../lib';
import { go, setUI, toast, useApp, useUI } from '../store';
import { Avatar, Badge, BranchTag, Button, Dialog, DiffStat, Grip, SegmentedControl, Select, Skeleton, StatusDot, Tabs, useColumns, usePaneWidth } from '../ui';
import { CodeView } from './CodeView';
import { langFromPath } from '../highlight';
import { DiffLine, SplitRows } from './Changes';
import { TranscriptItem } from './Session';
import { Issues } from './Issues';
import { Actions } from './Actions';
import { RepoMemory } from './Memory';
import { usePush } from './push';
import { TranscriptList } from './TranscriptList';

const ROW = 36;
const LANE_X = (l: number) => 14 + l * 16;
const GRAPH_COLOR: Record<string, string> = { main: 'var(--text-2)', working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)', error: 'var(--status-idle)' };
const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const head: React.CSSProperties = { font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };

function Graph({ commits }: { commits: HistoryCommit[] }) {
  const index = new Map(commits.map((c, i) => [c.hash, i]));
  const y = (i: number) => i * ROW + ROW / 2;
  const paths: React.ReactNode[] = [];
  commits.forEach((c, i) => c.parents.forEach((ph) => {
    const pi = index.get(ph);
    if (pi == null) {
      // parent is beyond the loaded window: run the line off the bottom
      paths.push(<path key={i + '-' + ph} d={`M${LANE_X(c.lane)} ${y(i)} L${LANE_X(c.lane)} ${commits.length * ROW}`} stroke={GRAPH_COLOR[c.kind]} strokeWidth="2" strokeLinecap="round" fill="none" />);
      return;
    }
    const p = commits[pi];
    const xc = LANE_X(c.lane), xp = LANE_X(p.lane), yc = y(i), yp = y(pi);
    const colorOf = c.lane > p.lane ? c : p;
    let d: string;
    if (xc === xp) d = `M${xc} ${yc} L${xp} ${yp}`;
    else if (c.lane > p.lane) d = `M${xc} ${yc} L${xc} ${yp - 14} C${xc} ${yp - 4} ${xp} ${yp - 8} ${xp} ${yp}`;
    else d = `M${xc} ${yc} C${xc} ${yc + 8} ${xp} ${yc + 4} ${xp} ${yc + 14} L${xp} ${yp}`;
    paths.push(<path key={i + '-' + ph} d={d} fill="none" stroke={GRAPH_COLOR[colorOf.kind]} strokeWidth="2" strokeLinecap="round" />);
  }));
  const maxLane = commits.reduce((m, c) => Math.max(m, c.lane), 0);
  return (
    <svg width={LANE_X(Math.max(3, maxLane)) + 14} height={commits.length * ROW} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
      {paths}
      {commits.map((c, i) => <circle key={c.hash} cx={LANE_X(c.lane)} cy={y(i)} r={c.parents.length > 1 ? 5 : 4} fill={c.parents.length > 1 ? 'var(--bg-app)' : GRAPH_COLOR[c.kind]} stroke={GRAPH_COLOR[c.kind]} strokeWidth="2" />)}
    </svg>
  );
}

type Cols = ReturnType<typeof useColumns>;

/** Placeholder rows for a table, in the table's own grid so nothing moves when the data arrives. */
function SkeletonRows({ n = 6, template, widths, height = 40, lead }: { n?: number; template: string; widths: (number | null)[]; height?: number; lead?: boolean }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: template, gap: 12, alignItems: 'center', minHeight: height, borderTop: '1px solid var(--border-subtle)' }}>
          {widths.map((w, j) => <span key={j} style={{ minWidth: 0 }}>{w ? <Skeleton w={Math.max(28, w - ((i * 13 + j * 7) % 32)) + '%'} /> : lead && j === 0 ? <Skeleton w={8} h={8} r={4} /> : null}</span>)}
        </div>
      ))}
    </>
  );
}

/** The commit list while history is read: a lane dot and bars where the message, author and hash will be. */
function HistorySkeleton({ col, n = 14 }: { col: Cols; n?: number }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ height: ROW, display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', padding: '0 16px 0 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style={{ display: 'flex', justifyContent: 'flex-start', paddingLeft: LANE_X(0) - 4 }}><Skeleton w={8} h={8} r={4} /></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{i % 4 === 0 ? <Skeleton w={74} h={16} r={3} /> : null}<Skeleton w={(30 + ((i * 17) % 50)) + '%'} h={10} /></span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Skeleton w={16} h={16} r={8} /><Skeleton w="50%" h={9} /></span>
          <Skeleton w={52} h={9} />
          <Skeleton w={44} h={9} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  );
}

function HistoryList({ commits, sel, setSel, col, onOpen }: { commits: HistoryCommit[]; sel: number; setSel(i: number): void; col: Cols; onOpen(i: number): void }) {
  return (
    <div style={{ position: 'relative' }}>
      <Graph commits={commits} />
      {commits.map((c, i) => (
        <div key={c.hash} onClick={() => setSel(i)} onDoubleClick={() => onOpen(i)} style={{ height: ROW, display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', padding: '0 16px 0 0', cursor: 'pointer',
          background: sel === i ? 'var(--bg-selected)' : 'transparent', borderBottom: '1px solid var(--border-subtle)' }}>
          <span />
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {c.refs.slice(0, 3).map((r) => <BranchTag key={r} name={r} kind={/^v\d/.test(r) ? 'commit' : 'branch'} style={r === 'main' || r === 'master' ? { boxShadow: 'inset 0 0 0 1px var(--border-strong)' } : { flex: 'none' }} />)}
            <span style={{ font: '400 13px/1 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.msg}</span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, font: c.agent ? '400 11.5px/1 var(--font-mono)' : '400 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>
            <Avatar agent={c.agent} name={c.who} size={16} /><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.who}</span>
          </span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{c.hash.slice(0, 7)}</span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)', textAlign: 'right' }}>{relTime(c.at)}</span>
        </div>
      ))}
    </div>
  );
}

/** Every file a commit touched, with its diff. */
function CommitDiff({ repo, commit, files, start, onClose }: { repo: R; commit: HistoryCommit; files: FileChange[]; start?: string; onClose(): void }) {
  const [sel, setSel] = React.useState(start || files[0]?.path || '');
  const [hunks, setHunks] = React.useState<DiffHunk[] | null>(null);
  const [mode, setMode] = React.useState('u');
  React.useEffect(() => {
    if (!sel) return;
    let dead = false;
    setHunks(null);
    api.commitDiff(repo.id, commit.hash, sel).then((h) => !dead && setHunks(h)).catch(() => !dead && setHunks([]));
    return () => { dead = true; };
  }, [sel, commit.hash]);
  const noop = () => undefined;
  const lang = langFromPath(sel);
  return (
    <Dialog width={1180} title={commit.msg} description={`${commit.hash.slice(0, 7)} · ${commit.who} · ${files.length} ${files.length === 1 ? 'file' : 'files'}`} onClose={onClose}>
      <div style={{ display: 'flex', height: 'min(68vh, 640px)', margin: '-8px -20px -16px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ width: 280, flex: 'none', overflow: 'auto', borderRight: '1px solid var(--border)', background: 'var(--bg-sidebar)', padding: 4 }}>
          {files.map((f) => {
            const parts = f.path.split('/');
            return (
              <div key={f.path} onClick={() => setSel(f.path)} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: sel === f.path ? 'var(--bg-selected)' : 'transparent' }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ font: '400 12px/1.1 var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts[parts.length - 1]}</span>
                  <span style={{ font: '400 10.5px/1.1 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts.slice(0, -1).join('/') || '.'}</span>
                </div>
                <DiffStat additions={f.add} deletions={f.del} blocks={false} />
              </div>
            );
          })}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-editor)' }}>
          <div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px 0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
            <span style={{ font: '400 12.5px/1 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sel}</span>
            <SegmentedControl size="sm" value={mode} onChange={setMode} options={[{ value: 'u', label: 'Unified' }, { value: 's', label: 'Split' }]} />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {hunks == null ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading diff…</div>
              : hunks.length === 0 ? <div style={{ padding: 16, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No textual changes in this file. It may be binary, renamed or empty.</div>
              : hunks.map((h, i) => (
                <div key={i}>
                  <div style={{ padding: '6px 16px', font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--accent-text)', background: 'var(--accent-muted)' }}>{h.header}</div>
                  {mode === 's' ? <SplitRows lines={h.lines} onComment={noop} lang={lang} /> : h.lines.map((l, j) => <DiffLine key={j} l={l} onComment={noop} lang={lang} />)}
                </div>
              ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function CommitDetail({ repo, c, files, onOpen }: { repo: R; c: HistoryCommit; files: FileChange[] | null; onOpen(path?: string): void }) {
  const app = useApp();
  const session = c.sessionId ? app.sessions.find((s) => s.id === c.sessionId) : undefined;
  const [w, grip, reset] = usePaneWidth('commit-detail', 340, 260, 620, -1);
  return (
    <aside style={{ position: 'relative', width: w, flex: 'none', borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Grip edge="left" onMouseDown={grip} onDoubleClick={reset} />
        <span className="selectable" style={{ font: '600 14px/1.35 var(--font-sans)' }}>{c.msg}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>
          <Avatar agent={c.agent} name={c.who} size={18} />{c.who}{c.agent ? <span style={{ color: 'var(--text-3)' }}>· on behalf of {app.user?.login}</span> : null}
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><BranchTag kind="commit" name={c.hash.slice(0, 7)} />{c.refs.map((r) => <BranchTag key={r} name={r} />)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}><span style={head}>Files</span>{files ? <DiffStat additions={files.reduce((a, f) => a + f.add, 0)} deletions={files.reduce((a, f) => a + f.del, 0)} /> : <Skeleton w={70} h={9} />}</div>
        {files == null ? [78, 60, 70].map((w, i) => <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 }}><Skeleton w={13} h={13} r={3} /><Skeleton w={w + '%'} h={9} /></div>) : null}
        {(files || []).slice(0, 80).map((f) => (
          <div key={f.path} onClick={() => onOpen(f.path)} className="helm-row-hover" title="Show diff" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 26, padding: '0 6px', margin: '0 -6px', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>
            <i className="ph ph-file-code" style={{ fontSize: 13, color: 'var(--text-3)' }} />
            <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.2 var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
            <DiffStat additions={f.add} deletions={f.del} blocks={false} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button size="sm" icon="git-diff" disabled={!files?.length} onClick={() => onOpen()}>View diff</Button>
        <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={async () => {
          if (await api.commitPushed(repo.id, c.hash).catch(() => true)) void api.openExternal(`https://github.com/${repo.id}/commit/${c.hash}`);
          else toast({ tone: 'neutral', title: 'Not on GitHub yet', description: `${c.hash.slice(0, 7)} only exists on this computer, so GitHub has no page for it. Push the branch first.` });
        }}>GitHub</Button>
        {session ? <Button size="sm" variant="ghost" icon="chats-circle" onClick={() => go({ screen: 'session', id: session.id, tab: 'conversation' })}>Session</Button> : null}
      </div>
    </aside>
  );
}

function Worktrees({ repo, list, reload }: { repo: R; list: WorktreeInfo[] | null; reload(): void }) {
  const app = useApp();
  const col = useColumns('worktrees', [{ w: 230, min: 140 }, { w: 1, min: 160, flex: true }, { w: 150, min: 100 }, { w: 100, min: 70 }, { w: 100, min: 70 }, { w: 150, min: 100, fixed: true }]);
  return (
    <div style={{ padding: '0 20px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, padding: '10px 0', ...head }}>
        {col.cell(0, 'Branch')}{col.cell(1, 'Worktree')}{col.cell(2, 'Session')}{col.cell(3, 'Ahead / behind')}{col.cell(4, 'Uncommitted')}<span />
      </div>
      {list == null ? <SkeletonRows n={4} template={col.template} widths={[70, 60, 55, 40, 40, null]} /> : null}
      {(list || []).map((w) => {
        const s = w.sessionId ? app.sessions.find((x) => x.id === w.sessionId) : undefined;
        return (
          <div key={w.path} style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', minHeight: 40, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ minWidth: 0 }}><BranchTag worktree={!!w.sessionId} name={w.branch} /></span>
            <span title={w.path} style={{ font: '400 11.5px/1.2 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tilde(w.path, app.home)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1 var(--font-mono)', minWidth: 0 }}>{s ? <><StatusDot status={s.status} size={7} />{s.id}</> : <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)' }}>{w.main ? 'Your checkout' : 'No session'}</span>}</span>
            <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-2)' }}>↑{w.ahead} ↓{w.behind}</span>
            <span style={{ font: '400 11.5px/1 var(--font-mono)', color: w.dirty ? 'var(--status-attention-text)' : 'var(--text-3)' }}>{w.dirty ? w.dirty + (w.dirty === 1 ? ' file' : ' files') : 'clean'}</span>
            <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
              {s ? <Button size="sm" variant="ghost" onClick={() => go({ screen: 'session', id: s.id, tab: 'code' })}>Open</Button> : null}
              {!w.main && (!s || s.status === 'idle' || s.status === 'ready') ? <Button size="sm" variant="ghost" onClick={async () => {
                if (!confirm(`Remove the worktree at ${w.path}? Commits on ${w.branch} stay in the repository until the branch is deleted.`)) return;
                try { await api.removeWorktree(repo.id, w.path); reload(); } catch (e) { toast({ tone: 'error', title: 'Could not remove worktree', description: errText(e) }); }
              }}>Remove</Button> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PullRequests({ prs, err, repoId }: { prs: PullRequest[] | null; err: string; repoId: string }) {
  const app = useApp();
  const col = useColumns('pulls', [{ w: 1, min: 220, flex: true }, { w: 70, min: 50 }, { w: 240, min: 120 }, { w: 230, min: 150, fixed: true }]);
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '20px ' + col.template, gap: 12, padding: '10px 0', ...head }}>
        <span />{col.cell(0, 'Pull request')}{col.cell(1, 'Number')}{col.cell(2, 'Branch')}<span style={{ textAlign: 'right' }}>Status</span>
      </div>
      {prs == null ? <SkeletonRows n={5} template={'20px ' + col.template} widths={[null, 75, 30, 55, 50]} height={44} lead /> : null}
      {err ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)', padding: '8px 0' }}>{err}</div> : null}
      {prs && !err && prs.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>No pull requests yet.</div> : null}
      {(prs || []).map((p) => (
        <div key={p.number} onClick={() => api.openExternal(p.url)} className="helm-row-hover" style={{ display: 'grid', gridTemplateColumns: '20px ' + col.template, gap: 12, alignItems: 'center', minHeight: 44, borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
          <i className="ph ph-git-pull-request" style={{ fontSize: 15, color: p.state === 'open' ? 'var(--status-ready)' : p.state === 'merged' ? 'var(--accent-text)' : 'var(--status-idle)' }} />
          <span style={{ font: '500 13px/1 var(--font-sans)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>#{p.number}</span>
          <span style={{ minWidth: 0 }}><BranchTag name={p.branch} /></span>
          <span style={{ textAlign: 'right', display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>{p.state === 'open' ? <Button size="sm" variant="ghost" icon="chats" title="Start a session that addresses the review comments" onClick={(e: any) => { e.stopPropagation(); api.feedbackTask(repoId, p.number).then((t) => setUI({ newSession: { repoId, task: t.task, base: t.base } })).catch((err: any) => toast({ tone: 'error', title: 'No comments to address', description: errText(err) })); }}>Fix comments</Button> : null}{p.state === 'open' && !p.draft ? <Button size="sm" variant="secondary" icon="git-merge" onClick={(e: any) => { e.stopPropagation(); setUI({ mergingPr: { repoId: repoId, number: p.number, sessionId: app.sessions.find((x) => x.prUrl === p.url)?.id } }); }}>Merge</Button> : null}<Badge tone={p.state === 'merged' ? 'accent' : p.draft ? 'idle' : p.checks === 'failing' ? 'error' : p.checks === 'pending' ? 'working' : p.state === 'open' ? 'ready' : 'idle'}>
            {p.state === 'merged' ? 'Merged' : p.state === 'closed' ? 'Closed' : p.draft ? 'Draft' : p.checks === 'failing' ? 'Checks failing' : p.checks === 'pending' ? 'Checks running' : p.checks === 'passing' ? 'Checks passing' : 'Open'}
          </Badge></span>
        </div>
      ))}
    </div>
  );
}

export function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return relTime(t);
}

/** A Claude Code session that helm did not start: its conversation, read-only, updating while it runs. */
export function ExternalSessionView({ repoId, id }: { repoId: string; id: string }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === repoId);
  const known = useUI((u) => u.externals[repoId]?.find((x) => x.id === id));
  // Only a window of the conversation is held: the latest events first, earlier ones as you scroll up.
  const [win, setWin] = React.useState<{ start: number; total: number; events: TranscriptEvent[] } | null>(null);
  const [err, setErr] = React.useState('');
  const winRef = React.useRef(win);
  winRef.current = win;
  const activeRef = React.useRef(false);
  activeRef.current = !!known?.active;
  const busy = React.useRef(false);
  React.useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    setWin(null); setErr('');
    const pull = async () => {
      try {
        const cur = winRef.current;
        const r = await api.externalTranscript(repoId, id, cur ? { start: cur.start } : { tail: 200 });
        if (dead) return;
        if (!r.ready) { setErr(r.error || ''); return; }
        setErr('');
        setWin({ start: r.start, total: r.total, events: r.events });
      } catch (e) { if (!dead) setErr(errText(e)); }
    };
    // Poll quickly until the first read finishes, then every few seconds while it runs, and rarely once it is idle.
    const loop = async () => { await pull(); if (!dead) timer = setTimeout(loop, winRef.current ? (activeRef.current ? 4000 : 20000) : 1000); };
    void loop();
    return () => { dead = true; clearTimeout(timer); };
  }, [repoId, id]);
  const loadEarlier = async () => {
    const cur = winRef.current;
    if (!cur || cur.start === 0 || busy.current) return;
    busy.current = true;
    try {
      const s0 = Math.max(0, cur.start - 200);
      const r = await api.externalTranscript(repoId, id, { start: s0, end: cur.start });
      if (r.ready) setWin((w) => (w ? { ...w, start: s0, events: [...r.events, ...w.events] } : w));
    } finally { busy.current = false; }
  };
  const active = !!known?.active;
  const mb = known?.size ? known.size / 1e6 : 0;
  if (!repo) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This repository is not in helm.</div>;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => go({ screen: 'repo', id: repoId, tab: 'external' })}>All sessions</Button>
          <i className="ph ph-eye" title="Read-only" style={{ fontSize: 16, color: 'var(--text-3)' }} />
          <span style={{ font: '600 15px/1.2 var(--font-sans)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{known?.title || 'Claude Code session'}</span>
          {known?.branch ? <BranchTag name={known.branch} /> : null}
          <Badge tone="neutral">External · read-only</Badge>
          <Button size="sm" variant="secondary" icon="play" disabled={active} title={active ? 'It is running right now. Let it finish first.' : 'Copy this conversation into a helm session with its own worktree'} onClick={() => setUI({ continuing: { repoId, externalId: id, title: known?.title || 'Claude Code session' } })}>Continue in helm</Button>
          {active ? <Badge tone="working" dot>Active now</Badge> : known ? <Badge>Last active {ago(known.lastModified)}</Badge> : null}
        </div>
        <div style={{ font: '400 11.5px/1.4 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={known?.cwd}>{known?.cwd ? tilde(known.cwd, app.home) + ' · ' : ''}{id}{win ? ` · ${win.total} events` : ''}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {win == null ? (
          <div style={{ maxWidth: 820, margin: '0 auto', padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: err ? 'var(--status-error-text)' : 'var(--text-3)' }}>
              {err || (mb > 100 ? `Reading a ${mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : Math.round(mb) + ' MB'} session file. This takes a few seconds the first time, and is remembered after that.` : 'Loading conversation…')}
            </span>
            {err ? null : [70, 90, 55, 80].map((w, i) => <div key={i} style={{ display: 'flex', gap: 10 }}><Skeleton w={22} h={22} r={11} /><div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton w="22%" h={9} /><Skeleton w={w + '%'} h={11} /></div></div>)}
          </div>
        ) : (
          <TranscriptList items={win.events} firstIndex={win.start} onStartReached={loadEarlier}
            renderItem={(m) => <TranscriptItem m={m} s={null as any} onDeny={() => undefined} />}
            header={win.start > 0 ? <div style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)', textAlign: 'center' }}>{win.start} earlier events. Scroll up to load them.</div> : null}
            footer={<>
              {active ? <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--status-working-text)' }}><i className="ph ph-circle-notch" style={{ fontSize: 14, animation: 'helm-spin .9s linear infinite' }} />Updating while it runs</div> : null}
              <div style={{ marginLeft: 32, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This session was started outside helm, so it is read-only here. To keep going, continue it where it started.</div>
            </>} />
        )}
      </div>
    </div>
  );
}

/** Claude Code sessions for this repository that helm did not start: the VS Code extension, the CLI, anything that writes to ~/.claude. */
function ExternalSessions({ repo, onCount }: { repo: R; onCount(n: number): void }) {
  const app = useApp();
  const shared = useUI((u) => u.externals[repo.id]);
  const [list, setList] = React.useState<ExternalSession[] | null>(shared ?? null);
  const [err, setErr] = React.useState('');
  const col = useColumns('external-sessions', [{ w: 20, min: 20, fixed: true }, { w: 1, min: 240, flex: true }, { w: 230, min: 120 }, { w: 120, min: 90 }, { w: 90, min: 70, fixed: true }]);
  const load = React.useCallback(() => {
    api.listExternalSessions(repo.id).then((l) => { setList(l); setErr(''); }).catch((e) => { setList([]); setErr(errText(e)); });
  }, [repo.id]);
  React.useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  const visibleList = (list || []).filter((x) => !x.archived);
  const hiddenCount = (list || []).length - visibleList.length;
  React.useEffect(() => onCount(visibleList.length), [list]);
  const open = (x: ExternalSession) => go({ screen: 'external', repoId: repo.id, id: x.id });
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 12px' }}>
      <div style={{ padding: '12px 0 4px', font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)', maxWidth: 760 }}>
        Claude Code sessions for this repository that helm did not start, for example from the VS Code extension or the command line. They are found by project folder in <code style={{ font: 'var(--type-data)' }}>~/.claude</code>, are read-only here, and also appear in the list on the left.{hiddenCount ? <> {hiddenCount} {hiddenCount === 1 ? 'is' : 'are'} archived: <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: 'archive' }); }}>see the Archive</a>.</> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, padding: '10px 0', ...head }}>
        <span />{col.cell(1, 'Session')}{col.cell(2, 'Branch')}{col.cell(3, 'Last active')}<span style={{ textAlign: 'right' }}>Size</span>
      </div>
      {list == null ? <SkeletonRows n={5} template={col.template} widths={[null, 70, 50, 40, 30]} height={44} lead /> : null}
      {err ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)', padding: '8px 0' }}>{err}</div> : null}
      {list && !err && visibleList.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>No sessions from outside helm for this repository.</div> : null}
      {visibleList.map((x) => (
        <div key={x.id} onClick={() => open(x)} className="helm-row-hover" style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', minHeight: 44, borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
          <StatusDot status={x.active ? 'working' : 'idle'} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ font: '500 13px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
              {x.active ? <Badge tone="working">Active · read-only</Badge> : null}
            </span>
            {x.cwd && x.cwd !== repo.localPath ? <span style={{ font: '400 11px/1.2 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tilde(x.cwd, app.home)}</span> : null}
          </span>
          <span style={{ minWidth: 0 }}>{x.branch ? <BranchTag name={x.branch} /> : null}</span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: x.active ? 'var(--status-working-text)' : 'var(--text-3)' }}>{x.active ? 'active now' : ago(x.lastModified)}</span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)', textAlign: 'right' }}>{x.size ? (x.size > 1e6 ? (x.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(x.size / 1e3)) + ' kB') : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Browse and edit the repository's own checkout, or any session's worktree. */
function RepoCode({ repo, themeKey }: { repo: R; themeKey: 'dark' | 'light' }) {
  const app = useApp();
  const [ws, setWs] = React.useState('repo:' + repo.id);
  const [info, setInfo] = React.useState<{ branch: string; dirty: number } | null>(null);
  const session = app.sessions.find((s) => s.id === ws && s.repoId === repo.id);
  React.useEffect(() => { setInfo(null); api.workspaceInfo(ws).then((i) => setInfo({ branch: i.branch, dirty: i.dirty })).catch(() => undefined); }, [ws]);
  const sessions = app.sessions.filter((s) => s.repoId === repo.id);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 38, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Editing</span>
        <Select size="sm" value={ws} onChange={(e: any) => setWs(e.target.value)} options={[{ value: 'repo:' + repo.id, label: 'Your checkout' }, ...sessions.map((s) => ({ value: s.id, label: 'Session · ' + s.id }))]} />
        {info ? <BranchTag name={info.branch} /> : null}
        {info && info.dirty ? <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--status-attention-text)' }}>{info.dirty} uncommitted</span> : null}
        <span style={{ flex: 1 }} />
        <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>{session ? 'Saving writes to this session’s worktree.' : 'Saving writes straight to your checkout.'}</span>
      </div>
      <CodeView key={ws} wsId={ws} session={session} branch={info?.branch || repo.defaultBranch} themeKey={themeKey} />
    </div>
  );
}

export function Repo({ id, themeKey, tab: firstTab }: { id: string; themeKey: 'dark' | 'light'; tab?: string }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === id);
  const [tab, setTab] = React.useState(firstTab || 'history');
  const [sel, setSel] = React.useState(0);
  const [history, setHistory] = React.useState<HistoryCommit[] | null>(null);
  const [wts, setWts] = React.useState<WorktreeInfo[] | null>(null);
  const pushes = usePush(id);
  const [prs, setPrs] = React.useState<PullRequest[] | null>(null);
  const [files, setFiles] = React.useState<FileChange[] | null>(null);
  const [diff, setDiff] = React.useState<{ path?: string } | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetched, setFetched] = React.useState<number | null>(null);
  const [prErr, setPrErr] = React.useState('');
  const [extCount, setExtCount] = React.useState<number | undefined>(undefined);
  const sessSig = app.sessions.filter((s) => s.repoId === id).map((s) => s.id + s.status).join();
  const maxLane = (history || []).reduce((m, c) => Math.max(m, c.lane), 0);
  const gutter = Math.max(78, LANE_X(maxLane) + 26);
  const col = useColumns('history', [{ w: gutter, min: gutter, fixed: true }, { w: 1, min: 200, flex: true }, { w: 160, min: 90 }, { w: 80, min: 60 }, { w: 80, min: 60, fixed: true }]);

  const [limit, setLimit] = React.useState(150);
  const [more, setMore] = React.useState(false);
  const loadHistory = React.useCallback((lim: number) => api.repoHistory(id, lim).then((h) => { setHistory(h); setMore(false); }).catch((e) => { setHistory((cur) => cur ?? []); setMore(false); toast({ tone: 'error', title: 'Could not read history', description: errText(e) }); }), [id]);
  const loadWts = React.useCallback(() => api.repoWorktrees(id).then(setWts).catch(() => setWts([])), [id]);
  const loadAll = React.useCallback(() => { void loadHistory(limit); if (tab === 'worktrees' || wts) void loadWts(); }, [loadHistory, loadWts, limit, tab, wts]);
  // Opening a repository paints the last history read straight away, then checks whether anything changed.
  React.useEffect(() => {
    let dead = false;
    setHistory(null); setLimit(150); setWts(null); setMore(false);
    api.repoHistoryCached(id, 150).then((c) => { if (!dead && c) setHistory((cur) => cur ?? c); }).catch(() => undefined);
    return () => { dead = true; };
  }, [id]);
  React.useEffect(() => { void loadHistory(limit); }, [id, limit, sessSig]);
  // Worktrees take a git call each, so they are only read once their tab is opened.
  React.useEffect(() => { if (tab === 'worktrees' || wts) void loadWts(); }, [tab, id, sessSig]);
  React.useEffect(() => { setPrs(null); setPrErr(''); api.repoPulls(id).then(setPrs).catch((e) => { setPrs([]); setPrErr(errText(e)); }); }, [id]);

  const commit = history?.[Math.min(sel, (history?.length || 1) - 1)];
  React.useEffect(() => {
    setFiles(null);
    if (commit) api.commitFiles(id, commit.hash).then(setFiles).catch(() => setFiles([]));
  }, [commit?.hash, id]);

  if (!repo) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This repository is not in helm.</div>;
  const fetchNow = async () => {
    setFetching(true);
    try { await api.fetchRepo(id); setFetched(Date.now()); loadAll(); } catch (e) { toast({ tone: 'error', title: 'Fetch failed', description: errText(e) }); } finally { setFetching(false); }
  };
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-book-bookmark" style={{ fontSize: 20, color: 'var(--text-3)' }} />
          <span style={{ font: '600 16px/1 var(--font-sans)' }}><span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{repo.owner}/</span>{repo.name}</span>
          <Badge>{repo.private ? 'Private' : 'Public'}</Badge>
          <BranchTag name={repo.defaultBranch} />
          <span title={repo.localPath} style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fetched ? 'Fetched just now' : tilde(repo.localPath, app.home)}</span>
          {(() => {
            const l = app.lifetime[repo.id];
            const n = lifetimeTokens(l);
            if (!n) return null;
            const tip = `Lifetime usage in this repository, across every session including deleted ones.\nInput ${fmtTokens(l.input)} · Output ${fmtTokens(l.output)} · Cache read ${fmtTokens(l.cacheRead)}` + (app.settings.billing === 'api' ? `\nCost ${money(l.cost)} (API prices)` : '');
            return <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 7px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border)', font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap' }}><i className="ph ph-coins" style={{ fontSize: 12, color: 'var(--text-3)' }} />{fmtTokens(n)} tokens lifetime</span>;
          })()}
          <span style={{ flex: 1 }} />
          <span title={pushes.tip}><Button variant="ghost" icon="cloud-arrow-up" loading={pushes.busy} disabled={pushes.ahead.length === 0} onClick={pushes.push}>{pushes.commits ? `Push all · ${pushes.commits}` : 'Push all'}</Button></span>
          <Button variant="ghost" icon="arrows-clockwise" loading={fetching} onClick={fetchNow}>Fetch</Button>
          <Button variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(`https://github.com/${repo.id}`)}>GitHub</Button>
          <Button variant="primary" icon="plus" kbd={platform() === 'darwin' ? '⌘N' : 'Ctrl+N'} onClick={() => setUI({ newSession: { repoId: repo.id } })}>New session</Button>
        </div>
        <Tabs value={tab} onChange={setTab} style={{ borderBottom: 'none', padding: 0 }} tabs={[
          { value: 'history', label: 'History', icon: 'git-commit' },
          { value: 'code', label: 'Code', icon: 'code' },
          { value: 'external', label: 'Claude sessions', icon: 'chats-circle', count: extCount },
          { value: 'memory', label: 'Memory', icon: 'brain' },
          { value: 'worktrees', label: 'Branches & worktrees', icon: 'tree-structure', count: wts?.length },
          { value: 'issues', label: 'Issues', icon: 'circle-dashed' },
          { value: 'actions', label: 'Actions', icon: 'lightning' },
          { value: 'prs', label: 'Pull requests', icon: 'git-pull-request', count: prs?.filter((p) => p.state === 'open').length }]} />
      </div>
      {tab === 'history' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', height: 30, flex: 'none', padding: '0 16px 0 0', borderBottom: '1px solid var(--border)', ...head }}>
              <span />{col.cell(1, 'Message')}{col.cell(2, 'Author')}{col.cell(3, 'Commit')}<span style={{ textAlign: 'right' }}>When</span>
            </div>
            <div onScroll={(e) => {
              const el = e.currentTarget;
              if (history && history.length >= limit && limit < 3000 && !more && el.scrollHeight - el.scrollTop - el.clientHeight < 500) { setMore(true); setLimit((l) => l + 300); }
            }} style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {history == null ? <HistorySkeleton col={col} /> : <HistoryList commits={history} sel={sel} setSel={setSel} col={col} onOpen={() => setDiff({})} />}
              {more ? <HistorySkeleton col={col} n={3} /> : null}
              {history && history.length > 0 && history.length < limit ? <div style={{ padding: '12px 16px', font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>Start of history · {history.length} commits</div> : null}
            </div>
          </div>
          {commit ? <CommitDetail repo={repo} c={commit} files={files} onOpen={(path) => setDiff({ path })} /> : null}
        </div>
      ) : tab === 'code' ? <RepoCode repo={repo} themeKey={themeKey} />
        : tab === 'memory' ? <RepoMemory repo={repo} />
        : tab === 'issues' ? <Issues repoId={repo.id} />
        : tab === 'actions' ? <Actions repoId={repo.id} />
        : tab === 'external' ? <ExternalSessions repo={repo} onCount={setExtCount} />
        : tab === 'worktrees' ? <div style={{ flex: 1, overflow: 'auto' }}><Worktrees repo={repo} list={wts} reload={loadWts} /></div>
        : <PullRequests prs={prs} err={prErr} repoId={repo.id} />}
      {diff && commit && files?.length ? <CommitDiff repo={repo} commit={commit} files={files} start={diff.path} onClose={() => setDiff(null)} /> : null}
    </div>
  );
}
