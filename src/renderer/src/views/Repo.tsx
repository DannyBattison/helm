import React from 'react';
import type { DiffHunk, FileChange, HistoryCommit, PullRequest, Repo as R, WorktreeInfo } from '@shared/types';
import { api, platform } from '../api';
import { relTime, tilde } from '../lib';
import { go, setUI, toast, useApp } from '../store';
import { Avatar, Badge, BranchTag, Button, Dialog, DiffStat, Grip, SegmentedControl, Select, StatusDot, Tabs, useColumns, usePaneWidth } from '../ui';
import { CodeView } from './CodeView';
import { DiffLine, SplitRows } from './Changes';

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
                  {mode === 's' ? <SplitRows lines={h.lines} onComment={noop} /> : h.lines.map((l, j) => <DiffLine key={j} l={l} onComment={noop} />)}
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}><span style={head}>Files</span><DiffStat additions={c.add} deletions={c.del} /></div>
        {files == null ? <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading…</span> : null}
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
        <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(`https://github.com/${repo.id}/commit/${c.hash}`)}>GitHub</Button>
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
      {list == null ? <div style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div> : null}
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

function PullRequests({ prs, err }: { prs: PullRequest[] | null; err: string }) {
  const col = useColumns('pulls', [{ w: 1, min: 220, flex: true }, { w: 70, min: 50 }, { w: 240, min: 120 }, { w: 150, min: 110, fixed: true }]);
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 8px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '20px ' + col.template, gap: 12, padding: '10px 0', ...head }}>
        <span />{col.cell(0, 'Pull request')}{col.cell(1, 'Number')}{col.cell(2, 'Branch')}<span style={{ textAlign: 'right' }}>Status</span>
      </div>
      {prs == null ? <div style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div> : null}
      {err ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)', padding: '8px 0' }}>{err}</div> : null}
      {prs && !err && prs.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>No pull requests yet.</div> : null}
      {(prs || []).map((p) => (
        <div key={p.number} onClick={() => api.openExternal(p.url)} className="helm-row-hover" style={{ display: 'grid', gridTemplateColumns: '20px ' + col.template, gap: 12, alignItems: 'center', minHeight: 44, borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
          <i className="ph ph-git-pull-request" style={{ fontSize: 15, color: p.state === 'open' ? 'var(--status-ready)' : p.state === 'merged' ? 'var(--accent-text)' : 'var(--status-idle)' }} />
          <span style={{ font: '500 13px/1 var(--font-sans)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
          <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>#{p.number}</span>
          <span style={{ minWidth: 0 }}><BranchTag name={p.branch} /></span>
          <span style={{ textAlign: 'right' }}><Badge tone={p.state === 'merged' ? 'accent' : p.draft ? 'idle' : p.checks === 'failing' ? 'error' : p.checks === 'pending' ? 'working' : p.state === 'open' ? 'ready' : 'idle'}>
            {p.state === 'merged' ? 'Merged' : p.state === 'closed' ? 'Closed' : p.draft ? 'Draft' : p.checks === 'failing' ? 'Checks failing' : p.checks === 'pending' ? 'Checks running' : p.checks === 'passing' ? 'Checks passing' : 'Open'}
          </Badge></span>
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

export function Repo({ id, themeKey }: { id: string; themeKey: 'dark' | 'light' }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === id);
  const [tab, setTab] = React.useState('history');
  const [sel, setSel] = React.useState(0);
  const [history, setHistory] = React.useState<HistoryCommit[] | null>(null);
  const [wts, setWts] = React.useState<WorktreeInfo[] | null>(null);
  const [prs, setPrs] = React.useState<PullRequest[] | null>(null);
  const [files, setFiles] = React.useState<FileChange[] | null>(null);
  const [diff, setDiff] = React.useState<{ path?: string } | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetched, setFetched] = React.useState<number | null>(null);
  const [prErr, setPrErr] = React.useState('');
  const sessSig = app.sessions.filter((s) => s.repoId === id).map((s) => s.id + s.status).join();
  const maxLane = (history || []).reduce((m, c) => Math.max(m, c.lane), 0);
  const gutter = Math.max(78, LANE_X(maxLane) + 26);
  const col = useColumns('history', [{ w: gutter, min: gutter, fixed: true }, { w: 1, min: 200, flex: true }, { w: 160, min: 90 }, { w: 80, min: 60 }, { w: 80, min: 60, fixed: true }]);

  const loadAll = React.useCallback(() => {
    api.repoHistory(id).then(setHistory).catch((e) => { setHistory([]); toast({ tone: 'error', title: 'Could not read history', description: errText(e) }); });
    api.repoWorktrees(id).then(setWts).catch(() => setWts([]));
  }, [id]);
  React.useEffect(() => { loadAll(); }, [id, sessSig]);
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
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon="arrows-clockwise" loading={fetching} onClick={fetchNow}>Fetch</Button>
          <Button variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(`https://github.com/${repo.id}`)}>GitHub</Button>
          <Button variant="primary" icon="plus" kbd={platform() === 'darwin' ? '⌘N' : 'Ctrl+N'} onClick={() => setUI({ newSession: { repoId: repo.id } })}>New session</Button>
        </div>
        <Tabs value={tab} onChange={setTab} style={{ borderBottom: 'none', padding: 0 }} tabs={[
          { value: 'history', label: 'History', icon: 'git-commit' },
          { value: 'code', label: 'Code', icon: 'code' },
          { value: 'worktrees', label: 'Branches & worktrees', icon: 'tree-structure', count: wts?.length },
          { value: 'prs', label: 'Pull requests', icon: 'git-pull-request', count: prs?.filter((p) => p.state === 'open').length }]} />
      </div>
      {tab === 'history' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', height: 30, flex: 'none', padding: '0 16px 0 0', borderBottom: '1px solid var(--border)', ...head }}>
              <span />{col.cell(1, 'Message')}{col.cell(2, 'Author')}{col.cell(3, 'Commit')}<span style={{ textAlign: 'right' }}>When</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {history == null ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading history…</div> : <HistoryList commits={history} sel={sel} setSel={setSel} col={col} onOpen={() => setDiff({})} />}
            </div>
          </div>
          {commit ? <CommitDetail repo={repo} c={commit} files={files} onOpen={(path) => setDiff({ path })} /> : null}
        </div>
      ) : tab === 'code' ? <RepoCode repo={repo} themeKey={themeKey} />
        : tab === 'worktrees' ? <div style={{ flex: 1, overflow: 'auto' }}><Worktrees repo={repo} list={wts} reload={loadAll} /></div>
        : <PullRequests prs={prs} err={prErr} />}
      {diff && commit && files?.length ? <CommitDiff repo={repo} commit={commit} files={files} start={diff.path} onClose={() => setDiff(null)} /> : null}
    </div>
  );
}
