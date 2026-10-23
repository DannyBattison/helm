import React from 'react';
import type { FileChange, HistoryCommit, PullRequest, Repo as R, WorktreeInfo } from '@shared/types';
import { api } from '../api';
import { relTime, tilde } from '../lib';
import { go, setUI, toast, useApp } from '../store';
import { Avatar, Badge, BranchTag, Button, DiffStat, StatusDot, Tabs } from '../ui';

const ROW = 36;
const LANE_X = (l: number) => 14 + l * 16;
const GRAPH_COLOR: Record<string, string> = { main: 'var(--text-2)', working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)', error: 'var(--status-idle)' };
const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

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

function HistoryList({ commits, sel, setSel }: { commits: HistoryCommit[]; sel: number; setSel(i: number): void }) {
  return (
    <div style={{ position: 'relative' }}>
      <Graph commits={commits} />
      {commits.map((c, i) => (
        <div key={c.hash} onClick={() => setSel(i)} style={{ height: ROW, display: 'grid', gridTemplateColumns: '78px minmax(0,1fr) 150px 70px 76px', gap: 12, alignItems: 'center', padding: '0 16px 0 0', cursor: 'pointer', background: sel === i ? 'var(--bg-selected)' : 'transparent', borderBottom: '1px solid var(--border-subtle)' }}>
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

function CommitDetail({ repo, c }: { repo: R; c: HistoryCommit }) {
  const app = useApp();
  const [files, setFiles] = React.useState<FileChange[] | null>(null);
  React.useEffect(() => { setFiles(null); api.commitFiles(repo.id, c.hash).then(setFiles).catch(() => setFiles([])); }, [c.hash, repo.id]);
  const session = c.sessionId ? app.sessions.find((s) => s.id === c.sessionId) : undefined;
  return (
    <aside style={{ width: 340, flex: 'none', borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="selectable" style={{ font: '600 14px/1.35 var(--font-sans)' }}>{c.msg}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>
          <Avatar agent={c.agent} name={c.who} size={18} />{c.who}{c.agent ? <span style={{ color: 'var(--text-3)' }}>· on behalf of {app.user?.login}</span> : null}
        </span>
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><BranchTag kind="commit" name={c.hash.slice(0, 7)} />{c.refs.map((r) => <BranchTag key={r} name={r} />)}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>Files</span><DiffStat additions={c.add} deletions={c.del} /></div>
        {files == null ? <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading…</span> : null}
        {(files || []).slice(0, 60).map((f) => (
          <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <i className="ph ph-file-code" style={{ fontSize: 13, color: 'var(--text-3)' }} />
            <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.2 var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.path}</span>
            <DiffStat additions={f.add} deletions={f.del} blocks={false} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {session ? <Button size="sm" icon="git-diff" onClick={() => go({ screen: 'session', id: session.id, tab: 'changes' })}>View diff</Button> : null}
        <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(`https://github.com/${repo.id}/commit/${c.hash}`)}>GitHub</Button>
        {session ? <Button size="sm" variant="ghost" icon="chats-circle" onClick={() => go({ screen: 'session', id: session.id, tab: 'conversation' })}>Session</Button> : null}
      </div>
    </aside>
  );
}

function Worktrees({ repo, list, reload }: { repo: R; list: WorktreeInfo[] | null; reload(): void }) {
  const app = useApp();
  const cols = 'minmax(0,1.2fr) minmax(0,1.6fr) 140px 90px 80px 120px';
  return (
    <div style={{ padding: '0 20px 20px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '10px 0', font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
        <span>Branch</span><span>Worktree</span><span>Session</span><span>Ahead / behind</span><span>Uncommitted</span><span />
      </div>
      {list == null ? <div style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div> : null}
      {(list || []).map((w) => {
        const s = w.sessionId ? app.sessions.find((x) => x.id === w.sessionId) : undefined;
        return (
          <div key={w.path} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, alignItems: 'center', minHeight: 40, borderTop: '1px solid var(--border-subtle)' }}>
            <span><BranchTag worktree={!!w.sessionId} name={w.branch} /></span>
            <span title={w.path} style={{ font: '400 11.5px/1.2 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tilde(w.path, app.home)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 12px/1 var(--font-mono)' }}>{s ? <><StatusDot status={s.status} size={7} />{s.id}</> : <span style={{ color: 'var(--text-3)', fontFamily: 'var(--font-sans)' }}>{w.main ? 'Your checkout' : 'No session'}</span>}</span>
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

export function Repo({ id }: { id: string }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === id);
  const [tab, setTab] = React.useState('history');
  const [sel, setSel] = React.useState(0);
  const [history, setHistory] = React.useState<HistoryCommit[] | null>(null);
  const [wts, setWts] = React.useState<WorktreeInfo[] | null>(null);
  const [prs, setPrs] = React.useState<PullRequest[] | null>(null);
  const [fetching, setFetching] = React.useState(false);
  const [fetched, setFetched] = React.useState<number | null>(null);
  const [prErr, setPrErr] = React.useState('');
  const sessSig = app.sessions.filter((s) => s.repoId === id).map((s) => s.id + s.status).join();

  const loadAll = React.useCallback(() => {
    api.repoHistory(id).then(setHistory).catch((e) => { setHistory([]); toast({ tone: 'error', title: 'Could not read history', description: errText(e) }); });
    api.repoWorktrees(id).then(setWts).catch(() => setWts([]));
  }, [id]);
  React.useEffect(() => { loadAll(); }, [id, sessSig]);
  React.useEffect(() => { setPrs(null); setPrErr(''); api.repoPulls(id).then(setPrs).catch((e) => { setPrs([]); setPrErr(errText(e)); }); }, [id]);

  if (!repo) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This repository is not in helm.</div>;
  const fetchNow = async () => {
    setFetching(true);
    try { await api.fetchRepo(id); setFetched(Date.now()); loadAll(); } catch (e) { toast({ tone: 'error', title: 'Fetch failed', description: errText(e) }); } finally { setFetching(false); }
  };
  const commit = history?.[Math.min(sel, (history?.length || 1) - 1)];
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <i className="ph ph-book-bookmark" style={{ fontSize: 20, color: 'var(--text-3)' }} />
          <span style={{ font: '600 16px/1 var(--font-sans)' }}><span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{repo.owner}/</span>{repo.name}</span>
          <Badge>{repo.private ? 'Private' : 'Public'}</Badge>
          <BranchTag name={repo.defaultBranch} />
          <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>{fetched ? 'Fetched just now' : tilde(repo.localPath, app.home)}</span>
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon="arrows-clockwise" loading={fetching} onClick={fetchNow}>Fetch</Button>
          <Button variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(`https://github.com/${repo.id}`)}>GitHub</Button>
          <Button variant="primary" icon="plus" kbd="⌘N" onClick={() => setUI({ newSession: { repoId: repo.id } })}>New session</Button>
        </div>
        <Tabs value={tab} onChange={setTab} style={{ borderBottom: 'none', padding: 0 }} tabs={[
          { value: 'history', label: 'History', icon: 'git-commit' },
          { value: 'worktrees', label: 'Branches & worktrees', icon: 'tree-structure', count: wts?.length },
          { value: 'prs', label: 'Pull requests', icon: 'git-pull-request', count: prs?.filter((p) => p.state === 'open').length }]} />
      </div>
      {tab === 'history' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
            {history == null ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading history…</div> : <HistoryList commits={history} sel={sel} setSel={setSel} />}
          </div>
          {commit ? <CommitDetail repo={repo} c={commit} /> : null}
        </div>
      ) : tab === 'worktrees' ? <div style={{ flex: 1, overflow: 'auto' }}><Worktrees repo={repo} list={wts} reload={loadAll} /></div> : (
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 20px' }}>
          {prs == null ? <div style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>Loading…</div> : null}
          {prErr ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)', padding: '8px 0' }}>{prErr}</div> : null}
          {prs && !prErr && prs.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '8px 0' }}>No pull requests yet.</div> : null}
          {(prs || []).map((p) => (
            <div key={p.number} onClick={() => api.openExternal(p.url)} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
              <i className="ph ph-git-pull-request" style={{ fontSize: 15, color: p.state === 'open' ? 'var(--status-ready)' : p.state === 'merged' ? 'var(--accent-text)' : 'var(--status-idle)' }} />
              <span style={{ font: '500 13px/1 var(--font-sans)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>#{p.number}</span>
              <BranchTag name={p.branch} />
              <span style={{ flex: 1 }} />
              <Badge tone={p.state === 'merged' ? 'accent' : p.draft ? 'idle' : p.checks === 'failing' ? 'error' : p.checks === 'pending' ? 'working' : p.state === 'open' ? 'ready' : 'idle'}>
                {p.state === 'merged' ? 'Merged' : p.state === 'closed' ? 'Closed' : p.draft ? 'Draft' : p.checks === 'failing' ? 'Checks failing' : p.checks === 'pending' ? 'Checks running' : p.checks === 'passing' ? 'Checks passing' : 'Open'}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
