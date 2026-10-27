import React from 'react';
import { CopyBox } from '../ui';
import { usePush } from './push';
import { sessionTitle, type ActivityEvent, type ExternalSession, type Session } from '@shared/types';
import { contextWindow } from '@shared/reports';
import { api, platform } from '../api';
import { isFreeGroup, whereLabel, ago, clock, fmtTokens, lifetimeTokens, laneAxis, laneData, LANE_MIN, livePlan, repoOf, reposWithSessions, runningSubagents, sessionTokens, totals, untilReset } from '../lib';
import { Cmd } from '../Hl';
import { go, setUI, useApp, useMoney, toast, useUI } from '../store';
import { Avatar, Button, DiffStat, Hint, Meter, SegmentedControl, Stat, StatusDot, useColumns, useNarrow } from '../ui';
import { PlanMeters } from './Shell';
import { isQuickQuestion } from './QuestionForm';
import { ForecastNotice } from './Review';

const lanePct = (m: number) => ((m / LANE_MIN) * 100).toFixed(2) + '%';
const LANE_COLOR: Record<string, string> = { working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)' };

const guard = (p: Promise<any>) => p.catch((e: any) => toast({ tone: 'error', title: 'That did not work', description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') }));

export function Lane({ s, now }: { s: Session; now: number }) {
  const { segs, marks } = laneData(s, now);
  return (
    <div style={{ position: 'relative', height: 20 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 1, background: 'var(--border-subtle)' }} />
      {segs.map(([a, b, st], i) => <div key={i} style={{ position: 'absolute', top: 6, height: 8, left: lanePct(a), width: lanePct(b - a), borderRadius: `${i === 0 ? 2 : 0}px ${i === segs.length - 1 ? 2 : 0}px ${i === segs.length - 1 ? 2 : 0}px ${i === 0 ? 2 : 0}px`, background: LANE_COLOR[st], opacity: st === 'working' ? 0.85 : 1 }} />)}
      {marks.map((m, i) => <div key={'m' + i} title="Commit" style={{ position: 'absolute', top: 3, left: lanePct(m), width: 2, height: 14, marginLeft: -1, borderRadius: 1, background: 'var(--text-1)', boxShadow: '0 0 0 1.5px var(--bg-panel)' }} />)}
      <div style={{ position: 'absolute', top: -2, bottom: -2, left: lanePct(104), width: 1, background: 'var(--text-3)' }} />
    </div>
  );
}

export function AttentionCard({ s }: { s: Session }) {
  const a = s.ask!;
  const { fmt, sym, from } = useMoney();
  const open = () => go({ screen: 'session', id: s.id, tab: 'conversation' });
  const resolve = (answer: any) => guard(api.resolveAsk(s.id, a.id, answer));
  const q = a.questions?.[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>
        <StatusDot status="attention" size={7} />
        <span style={{ color: 'var(--text-2)' }}>{s.free ? 'free agent' : s.repoId.split('/')[1]}</span><span>/</span>
        <span style={{ color: 'var(--text-1)', cursor: 'pointer' }} onClick={open}>{sessionTitle(s)}</span>
        <span style={{ marginLeft: 'auto' }}>{ago(a.at)}</span>
      </div>
      <div style={{ font: '600 13px/1.5 var(--font-sans)', textWrap: 'pretty' as any }}>{a.summary || a.head}</div>
      {a.command ? <CopyBox text={a.command}><code className="selectable" style={{ font: 'var(--type-data)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflow: 'auto' }}>{a.tool === 'Bash' || a.tool === 'PowerShell' ? <><span style={{ color: 'var(--text-3)' }}>$ </span><Cmd text={a.command} /></> : a.command}</code></CopyBox> : null}
      {a.type === 'budget' && a.scope === 'plan' ? <PlanMeters /> : null}
      {a.type === 'budget' && a.scope !== 'plan' ? <Meter value={s.cost} max={s.budget} detail={fmt(s.cost) + ' / ' + fmt(s.budget)} label="Session budget" /> : null}
      {a.note ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)', flex: 1, textWrap: 'pretty' as any }}>{a.note}{a.orphaned ? (/[.!?]$/.test(a.note) ? ' ' : '. ') + 'helm was restarted while this waited. Answering resumes the session.' : ''}</div> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.type === 'approve' ? <>
          <Button size="sm" variant="primary" onClick={() => resolve({ decision: 'approve' })}>Approve once</Button>
          {a.pattern ? <Button size="sm" onClick={() => resolve({ decision: 'always' })}>Always allow</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => resolve({ decision: 'deny' })}>Deny</Button>
        </> : null}
        {a.type === 'question' ? <>
          {(isQuickQuestion(a.questions) ? q?.options || [] : []).slice(0, 3).map((o, i) => <Button key={o.label} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => resolve({ answers: { [q!.question]: o.label } })}>{o.label}</Button>)}
          <Button size="sm" variant="ghost" onClick={open}>Reply</Button>
        </> : null}
        {a.type === 'budget' ? <>
          <Button size="sm" variant="primary" onClick={() => resolve({ addBudget: a.scope === 'plan' ? 0 : from(5) })}>{a.scope === 'plan' ? 'Continue anyway' : `Add ${sym}5 and resume`}</Button>
          <Button size="sm" variant="ghost" onClick={open}>Open session</Button>
        </> : null}
        {a.type === 'approve' ? <Button size="sm" variant="ghost" onClick={open}>Open session</Button> : null}
      </div>
    </div>
  );
}

/** A Claude Code session that helm did not start. It sits among the others, marked read-only, and opens its transcript. */
function ExternalRow({ x, repoId, tpl, sub, narrow }: { x: ExternalSession; repoId: string; tpl: string; sub: boolean; narrow?: boolean }) {
  const [hover, setHover] = React.useState(false);
  const size = x.size ? (x.size > 1e6 ? (x.size / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(x.size / 1e3)) + ' kB') : '';
  const last = ago(x.lastModified);
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => go({ screen: 'external', repoId, id: x.id })} title="Started outside helm. Read-only."
      style={{ display: 'grid', gridTemplateColumns: narrow ? '20px minmax(0,1fr)' : tpl, gap: narrow ? 8 : 12, alignItems: 'center', minHeight: 44, padding: narrow ? '8px 12px' : '0 12px', borderTop: '1px solid var(--border-subtle)', background: hover ? 'var(--bg-hover)' : 'transparent', cursor: 'pointer' }}>
      <StatusDot status={x.active ? 'working' : 'idle'} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <i className="ph ph-eye" style={{ fontSize: 13, color: 'var(--text-3)', flex: 'none' }} />
          <span style={{ font: 'italic 500 13px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
        </span>
        <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          {x.branch ? <><i className="ph ph-git-branch" style={{ fontSize: 11 }} />{x.branch} · </> : null}external · read-only
        </span>
      </div>
      <span style={{ font: 'italic 400 12px/1.5 var(--font-sans)', color: x.active ? 'var(--status-working-text)' : 'var(--text-3)', gridColumn: narrow ? 2 : undefined }}>{x.active ? 'Active now' : 'Last active ' + (last === 'now' ? 'just now' : last + ' ago')}{narrow && size ? ' · ' + size : ''}</span>
      {narrow ? null : <>
        <span /><span /><span />
        {sub ? null : <span />}
        <span style={{ font: 'var(--type-data)', color: 'var(--text-3)', textAlign: 'right' }}>{size}</span>
      </>}
    </div>
  );
}

function SessionRow({ s, now, tpl, sub, narrow }: { s: Session; now: number; tpl: string; sub: boolean; narrow?: boolean }) {
  const { fmt, sym, from } = useMoney();
  const [hover, setHover] = React.useState(false);
  const needs = s.status === 'attention';
  const a = s.ask;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' })}
      style={{ display: 'grid', gridTemplateColumns: narrow ? '20px minmax(0,1fr)' : tpl, gap: narrow ? 8 : 12, alignItems: 'center', minHeight: 44, padding: narrow ? '10px 12px' : '0 12px', borderTop: '1px solid var(--border-subtle)', background: hover ? 'var(--bg-hover)' : 'transparent', cursor: 'pointer' }}>
      <StatusDot status={s.status} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: '500 13px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.task}</span>
        <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><i className={'ph ph-' + (s.free ? 'folder' : 'git-branch')} style={{ fontSize: 11 }} />{whereLabel(s)}{runningSubagents(s) ? <span style={{ color: 'var(--status-working-text)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-tree-structure" style={{ fontSize: 11 }} />{runningSubagents(s)} {runningSubagents(s) === 1 ? 'subagent' : 'subagents'}</span> : null}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, gridColumn: narrow ? 2 : undefined }}>
        <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.5 var(--font-sans)', color: needs ? 'var(--status-attention-text)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.step}</span>
        {a?.type === 'approve' ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); void guard(api.resolveAsk(s.id, a.id, { decision: 'approve' })); }}>Approve</Button> : null}
        {a?.type === 'budget' ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); void guard(api.resolveAsk(s.id, a.id, { addBudget: a.scope === 'plan' ? 0 : from(5) })); }}>{a.scope === 'plan' ? 'Continue' : `Add ${sym}5`}</Button> : null}
        {s.status === 'ready' ? <Button size="sm" variant="secondary" icon="git-diff">Review</Button> : null}
      </div>
      {narrow ? (
        <div style={{ gridColumn: 2, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px', font: 'var(--type-data)', color: 'var(--text-2)' }}>
          <span title="Context">ctx {fmtTokens(s.ctx)}</span>
          <span>{fmtTokens(sessionTokens(s))} tokens</span>
          {sub ? null : <span>{fmt(s.cost)}</span>}
          <DiffStat additions={s.add} deletions={s.del} />
        </div>
      ) : <>
        <Lane s={s} now={now} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Meter value={s.ctx} max={contextWindow(s)} warnAt={0.75} style={{ flex: 1 }} /><span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-2)', width: 30, textAlign: 'right' }}>{fmtTokens(s.ctx)}</span></div>
        <span style={{ font: 'var(--type-data)', textAlign: 'right' }}>{fmtTokens(sessionTokens(s))}</span>
        {sub ? null : <span style={{ font: 'var(--type-data)', textAlign: 'right' }}>{fmt(s.cost)}</span>}
        <span style={{ textAlign: 'right' }}><DiffStat additions={s.add} deletions={s.del} /></span>
      </>}
    </div>
  );
}

function FirstRun() {
  const app = useApp();
  const none = app.repos.length === 0;
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '56px 0' }}>
      <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <i className={'ph ph-' + (none ? 'book-bookmark' : 'robot')} style={{ fontSize: 30, color: 'var(--text-3)' }} />
        <h2 style={{ margin: 0, font: '600 16px/1.5 var(--font-sans)' }}>{none ? 'Add your first repository' : 'Start your first session'}</h2>
        <p style={{ margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>
          {none ? 'helm works with GitHub repositories. Clone one from your account, from a URL, or register a clone you already have.' : 'Describe a task and helm gives the agent its own worktree and branch. Your checkout is never touched.'}
        </p>
        {none ? <div style={{ display: 'flex', gap: 8 }}><Button variant="primary" icon="book-bookmark" onClick={() => setUI({ adding: true })}>Add repository</Button>{app.settings.freeAgents ? <Button variant="secondary" icon="robot" onClick={() => setUI({ newSession: { repoId: '@free' } })}>Start a free agent</Button> : null}</div> : <Button variant="primary" icon="plus" onClick={() => setUI({ newSession: {} })}>New session</Button>}
      </div>
    </div>
  );
}

const BOARD: [string, string, string[]][] = [['attention', 'Needs you', ['attention']], ['working', 'Working', ['working']], ['ready', 'Ready for review', ['ready']], ['idle', 'Idle', ['idle', 'error']]];

function BoardCard({ s }: { s: Session }) {
  const { fmt } = useMoney();
  const [hover, setHover] = React.useState(false);
  const sub = useApp().settings.billing === 'subscription';
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' })}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 'var(--radius-md)', background: hover ? 'var(--bg-hover)' : 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', cursor: 'pointer', minWidth: 0 }}>
      <span style={{ font: '500 13px/1.45 var(--font-sans)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.task}</span>
      <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}><i className={'ph ph-' + (s.free ? 'folder' : 'git-branch')} style={{ fontSize: 11, flex: 'none' }} /><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{whereLabel(s)}</span></span>
      <span style={{ font: '400 12px/1.5 var(--font-sans)', color: s.status === 'attention' ? 'var(--status-attention-text)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.step}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: 'var(--type-data)', color: 'var(--text-2)' }}>
        {runningSubagents(s) ? <span style={{ color: 'var(--status-working-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-tree-structure" style={{ fontSize: 11 }} />{runningSubagents(s)}</span> : null}
        <span title="Context">ctx {fmtTokens(s.ctx)}</span>
        {sub ? null : <span>{fmt(s.cost)}</span>}
        <span style={{ flex: 1 }} />
        <DiffStat additions={s.add} deletions={s.del} />
      </div>
    </div>
  );
}

/** Sessions as a kanban board: one column per state, newest activity first. */
function Board({ sessions, only }: { sessions: Session[]; only: string }) {
  const narrow = useNarrow();
  const cols = BOARD.filter(([k]) => only === 'all' || only === k);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : `repeat(${cols.length}, minmax(220px, 1fr))`, gap: 12, padding: 12, borderTop: '1px solid var(--border)', overflowX: 'auto', alignItems: 'start' }}>
      {cols.map(([k, label, states]) => {
        const items = sessions.filter((s) => states.includes(s.status)).sort((a, b) => b.lastAccess - a.lastAccess);
        return (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, padding: 8, borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 2px 4px' }}>
              <StatusDot status={k as any} size={7} />
              <span style={{ font: '600 12.5px/1.5 var(--font-sans)' }}>{label}</span>
              <span style={{ font: '500 11px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{items.length}</span>
            </div>
            {items.length ? items.map((s) => <BoardCard key={s.id} s={s} />) : <div style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '6px 2px' }}>Nothing here</div>}
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard({ filter: initial }: { filter?: string }) {
  const app = useApp();
  const [filter, setFilter] = React.useState(initial || 'all');
  const [layout, setLayout] = React.useState<string>(() => localStorage.getItem('helm-overview-layout') === 'board' ? 'board' : 'list');
  const pickLayout = (v: string) => { setLayout(v); localStorage.setItem('helm-overview-layout', v); };
  const pushes = usePush();
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const t = totals(app);
  const externals = useUI((u) => u.externals);
  const totalExt = Object.values(externals).reduce((n, l) => n + l.filter((x) => !x.archived).length, 0);
  const archivedTotal = app.sessions.filter((s) => s.archivedAt).length + Object.values(externals).reduce((n, l) => n + l.filter((x) => x.archived).length, 0);
  const liveSessions = app.sessions.filter((s) => !s.archivedAt).length;
  const { fmt } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const plan = livePlan(app);
  const narrow = useNarrow();
  const col = useColumns(sub ? 'ledger-sub' : 'ledger-api', [
    { w: 20, min: 20, fixed: true }, { w: 270, min: 150 }, { w: 200, min: 150, flex: true }, { w: 300, min: 180 }, { w: 88, min: 60 }, { w: 56, min: 44 },
    ...(sub ? [] : [{ w: 56, min: 44 }]), { w: 104, min: 80, fixed: true }
  ]);
  const visible = (s: Session) => (filter === 'archived' ? !!s.archivedAt : !s.archivedAt && filter !== 'external' && (filter === 'all' || s.status === filter));
  const extVisible = (x: ExternalSession) => (filter === 'archived' ? x.archived : !x.archived && (filter === 'all' || filter === 'external' || (filter === 'working' && x.active)));
  const extFor = (id: string) => (externals[id] || []).filter(extVisible);
  const extShown = (id: string) => extFor(id).filter((x, i) => filter === 'external' || x.active || i < 5);
  const board = layout === 'board' && filter !== 'external' && filter !== 'archived';
  const axis = laneAxis(now);
  const asks = app.sessions.filter((s) => s.ask).sort((a, b) => a.ask!.at - b.ask!.at);
  const cell: React.CSSProperties = { padding: narrow ? 12 : '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid var(--border-subtle)' };
  const groups = reposWithSessions(app, true).filter(({ repo: r, sessions }) => sessions.some(visible) || extFor(r.id).length > 0);
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const withSessions = new Set(app.sessions.map((s) => s.repoId)).size;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: narrow ? '14px 12px 24px' : '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: narrow ? 14 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ margin: 0, font: '600 20px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>{filter === 'attention' ? 'Needs you' : 'Overview'}</h1>
            <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{date} · {liveSessions} {liveSessions === 1 ? 'session' : 'sessions'} across {withSessions} {withSessions === 1 ? 'repository' : 'repositories'}{totalExt ? ` · ${totalExt} external, read-only` : ''}</span>
          </div>
          <span title={pushes.tip}><Button variant="ghost" icon="cloud-arrow-up" loading={pushes.busy} disabled={pushes.ahead.length === 0} onClick={pushes.push}>{pushes.commits ? `Push all · ${pushes.commits}` : 'Push all'}</Button></span>
          <Button variant="ghost" icon="book-bookmark" onClick={() => setUI({ adding: true })}>Add repository</Button>
          <Hint id="new-session" title="Start an agent" text="Describe a task and an agent works on it in its own branch, while you do something else."><Button variant="primary" icon="plus" kbd={narrow ? undefined : platform() === 'darwin' ? '⌘N' : 'Ctrl+N'} onClick={() => setUI({ newSession: {} })}>New session</Button></Hint>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'repeat(2, minmax(0,1fr))' : 'repeat(4, minmax(0,1fr)) minmax(0,1.6fr)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div style={{ ...cell, borderLeft: 'none' }}><Stat label="Working" value={t.working} tone="working" /></div>
          <div style={cell}><Stat label="Needs you" value={t.attention} tone="attention" /></div>
          <div style={cell}><Stat label="Ready for review" value={t.ready} tone="ready" /></div>
          <div style={cell}><Stat label="Tokens today" value={fmtTokens(t.tokens)} /></div>
          <div style={{ ...cell, gap: 10, ...(narrow ? { gridColumn: '1 / -1', borderTop: '1px solid var(--border-subtle)' } : null) }}>
            {sub ? <>
              <Stat label="Plan usage this week" value={plan.weekly ? Math.round(plan.weekly.util * 100) + '%' : '—'} detail={plan.weekly ? `resets in ${untilReset(plan.weekly.resetsAt)}` : 'appears after the first message'} />
              <Meter value={plan.fiveHour?.util ?? 0} max={1} warnAt={app.settings.warnAt / 100} detail={plan.fiveHour ? `5-hour window ${Math.round(plan.fiveHour.util * 100)}% · resets ${untilReset(plan.fiveHour.resetsAt)}` : '5-hour window: no data yet'} />
            </> : <>
              <Stat label="Spend this week" value={fmt(t.spent)} />
              <Meter value={t.spent} max={t.cap} warnAt={app.settings.warnAt / 100} detail={`of ${fmt(t.cap, true)} across ${app.repos.length} ${app.repos.length === 1 ? 'repository' : 'repositories'}`} />
            </>}
          </div>
        </div>

        <ForecastNotice conflicts={app.forecast || []} />

        {liveSessions === 0 && totalExt === 0 && archivedTotal === 0 ? <FirstRun /> : null}

        {asks.length > 0 ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ph-fill ph-bell-ringing" style={{ fontSize: 14, color: 'var(--status-attention)' }} />
              <span style={{ font: '600 13px/1.5 var(--font-sans)' }}>Needs you</span>
              <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Oldest first. Agents wait here until you answer.</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : 'repeat(3, minmax(0,1fr))', gap: 12 }}>
              {asks.map((s) => <AttentionCard key={s.id + s.ask!.id} s={s} />)}
            </div>
          </section>
        ) : null}

        {liveSessions > 0 || totalExt > 0 || archivedTotal > 0 ? (
          <section style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, padding: '10px 12px' }}>
              <span style={{ font: '600 13px/1.5 var(--font-sans)' }}>Sessions</span>
              <SegmentedControl size="sm" value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All', count: liveSessions },
                { value: 'attention', label: 'Needs you', count: t.attention },
                { value: 'working', label: 'Working', count: t.working },
                { value: 'ready', label: 'Review', count: t.ready },
                { value: 'external', label: 'External', count: totalExt },
                { value: 'archived', label: 'Archived', count: archivedTotal }]} />
              <span style={{ flex: 1 }} />
              {narrow || board ? null : [['working', 'Working'], ['attention', 'Waiting on you'], ['ready', 'Ready']].map(([k, l]) => (
                <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, font: '400 11px/1.5 var(--font-sans)', color: 'var(--text-3)' }}><span style={{ width: 12, height: 6, borderRadius: 2, background: LANE_COLOR[k] }} />{l}</span>
              ))}
              {narrow || board ? null : <span style={{ display: 'flex', alignItems: 'center', gap: 5, font: '400 11px/1.5 var(--font-sans)', color: 'var(--text-3)' }}><span style={{ width: 2, height: 10, borderRadius: 1, background: 'var(--text-1)' }} />Commit</span>}
              <SegmentedControl size="sm" value={layout} onChange={pickLayout} options={[{ value: 'list', label: 'List', icon: 'list' }, { value: 'board', label: 'Board', icon: 'kanban' }]} />
            </div>
            {board ? <Board sessions={app.sessions.filter(visible)} only={filter} /> : <>
            {narrow ? null : <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'end', padding: '6px 12px', borderTop: '1px solid var(--border)', font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              <span />{col.cell(1, 'Session')}{col.cell(2, 'Now')}
              {col.cell(3, axis.map(([m, l]) => <span key={l} style={{ position: 'absolute', left: lanePct(m), transform: 'translateX(-50%)', font: '400 10.5px/1.5 var(--font-mono)', textTransform: 'none', letterSpacing: 0, color: l === 'now' ? 'var(--text-1)' : 'var(--text-3)' }}>{l}</span>), { height: 11 })}
              {col.cell(4, 'Context')}{col.cell(5, 'Tokens', { textAlign: 'right' })}{sub ? null : col.cell(6, 'Cost', { textAlign: 'right' })}<span style={{ textAlign: 'right' }}>Changes</span>
            </div>}
            {groups.map(({ repo: r, sessions }) => (
              <div key={r.id}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: narrow ? 'wrap' : undefined, gap: 10, minHeight: 34, padding: '0 8px 0 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
                  <i className={'ph ph-' + (isFreeGroup(r) ? 'robot' : 'book-bookmark')} style={{ fontSize: 14, color: 'var(--text-3)' }} />
                  <span style={{ font: '600 12.5px/1.5 var(--font-sans)', cursor: isFreeGroup(r) ? 'default' : 'pointer' }} onClick={() => { if (!isFreeGroup(r)) go({ screen: 'repo', id: r.id }); }}>{isFreeGroup(r) ? 'Free agents' : <><span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{r.owner}/</span>{r.name}</>}</span>
                  {isFreeGroup(r) ? <span style={{ font: '400 11px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>not tied to a repository</span> : null}
                  {!isFreeGroup(r) && lifetimeTokens(app.lifetime[r.id]) ? <span title="Lifetime tokens in this repository, including deleted sessions" style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{fmtTokens(lifetimeTokens(app.lifetime[r.id]))} lifetime</span> : null}
                  {sub || isFreeGroup(r) || narrow ? null : <>
                    <Meter value={app.weekSpend[r.id] || 0} max={r.cap} style={{ width: 90, marginLeft: 6 }} warnAt={app.settings.warnAt / 100} />
                    <span style={{ font: '400 11px/1.5 var(--font-mono)', color: (app.weekSpend[r.id] || 0) / r.cap >= app.settings.warnAt / 100 ? 'var(--status-attention-text)' : 'var(--text-3)' }}>{fmt(app.weekSpend[r.id] || 0)} / {fmt(r.cap, true)}</span>
                  </>}
                  <span style={{ flex: 1 }} />
                  {isFreeGroup(r) ? null : <Button size="sm" variant="ghost" icon="git-commit" onClick={() => go({ screen: 'repo', id: r.id })}>History</Button>}
                  {isFreeGroup(r) && !app.settings.freeAgents ? null : <Button size="sm" variant="ghost" icon="plus" onClick={() => setUI({ newSession: { repoId: r.id } })}>{isFreeGroup(r) ? 'New free agent' : 'New session'}</Button>}
                </div>
                {sessions.filter(visible).map((s) => <SessionRow key={s.id} s={s} now={now} tpl={col.template} sub={sub} narrow={narrow} />)}
                {extShown(r.id).map((x) => <ExternalRow key={x.id} x={x} repoId={r.id} tpl={col.template} sub={sub} narrow={narrow} />)}
                {extFor(r.id).length > extShown(r.id).length ? <div onClick={() => go({ screen: 'repo', id: r.id, tab: 'external' })} className="helm-row-hover" style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)', cursor: 'pointer' }}>{extFor(r.id).length - extShown(r.id).length} more external sessions</div> : null}
              </div>
            ))}
            </>}
          </section>
        ) : null}
        <LifetimeByRepo />
      </div>
    </div>
  );
}

/** Tokens used per repository over its whole life, deleted sessions included. Shown for every repository, with or without sessions. */
function LifetimeByRepo() {
  const app = useApp();
  const narrow = useNarrow();
  const { fmt } = useMoney();
  const api = app.settings.billing === 'api';
  const rows = app.repos.map((r) => ({ r, l: app.lifetime[r.id], n: lifetimeTokens(app.lifetime[r.id]) })).sort((a, b) => b.n - a.n);
  const max = Math.max(1, ...rows.map((x) => x.n));
  const total = rows.reduce((n, x) => n + x.n, 0);
  if (!rows.length) return null;
  return (
    <section style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 16px' }}>
        <span style={{ font: '600 13px/1.5 var(--font-sans)' }}>Tokens by repository</span>
        {narrow ? null : <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Lifetime, including deleted sessions</span>}
        <span style={{ flex: 1 }} />
        <span style={{ font: '500 12px/1.5 var(--font-mono)', color: 'var(--text-2)' }}>{fmtTokens(total)} total</span>
      </div>
      {rows.map(({ r, l, n }) => (
        <div key={r.id} onClick={() => go({ screen: 'repo', id: r.id })} className="helm-row-hover" title={l ? `Input ${fmtTokens(l.input)} · Output ${fmtTokens(l.output)} · Cache read ${fmtTokens(l.cacheRead)}` : 'No usage yet'}
          style={{ display: 'grid', gridTemplateColumns: (narrow ? 'minmax(0,1fr) 60px 56px' : 'minmax(160px, 260px) 1fr 80px') + (api ? ' 70px' : ''), gap: narrow ? 8 : 14, alignItems: 'center', minHeight: 38, padding: narrow ? '0 12px' : '0 16px', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
          <span style={{ font: '500 12.5px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{r.owner}/</span>{r.name}</span>
          <span style={{ height: 6, borderRadius: 3, background: 'var(--bg-raised)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: (n / max) * 100 + '%', borderRadius: 3, background: 'var(--accent)' }} /></span>
          <span style={{ font: '500 12px/1.5 var(--font-mono)', textAlign: 'right' }}>{n ? fmtTokens(n) : '0'}</span>
          {api ? <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-3)', textAlign: 'right' }}>{l ? fmt(l.cost) : ''}</span> : null}
        </div>
      ))}
    </section>
  );
}

export function Activity() {
  const app = useApp();
  const narrow = useNarrow();
  const [f, setF] = React.useState('all');
  const [log, setLog] = React.useState<ActivityEvent[] | null>(null);
  const [more, setMore] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const PAGE = 300;
  const ICON: Record<string, [string, string]> = {
    ready: ['check-circle', 'var(--status-ready)'], attention: ['bell-ringing', 'var(--status-attention)'], budget: ['coins', 'var(--status-attention)'], commit: ['git-commit', 'var(--text-2)'],
    start: ['play-circle', 'var(--status-working)'], merge: ['git-merge', 'var(--accent-text)'], done: ['check', 'var(--text-3)'], error: ['warning-circle', 'var(--status-error)'],
    push: ['cloud-arrow-up', 'var(--text-2)'], fetch: ['arrows-clockwise', 'var(--text-3)'], git: ['git-branch', 'var(--text-2)'], pr: ['git-pull-request', 'var(--status-ready)'],
    worktree: ['tree-structure', 'var(--text-3)'], session: ['chats-circle', 'var(--text-3)'], approval: ['shield-check', 'var(--status-attention)'], bash: ['terminal', 'var(--text-3)'], edit: ['pencil-simple', 'var(--text-3)']
  };
  const groups: Record<string, string[] | null> = {
    all: null,
    attention: ['attention', 'budget', 'error', 'approval'],
    git: ['commit', 'merge', 'push', 'fetch', 'git', 'pr', 'worktree'],
    sessions: ['start', 'done', 'ready', 'session', 'error'],
    agents: ['bash', 'edit', 'push', 'git', 'commit', 'approval']
  };
  // The newest page is read again whenever something is logged; older pages are added on request.
  React.useEffect(() => {
    api.activityLog({ limit: PAGE }).then((l) => { setLog((cur) => { const older = (cur || []).filter((e) => l.length && e.t < l[l.length - 1].t); return [...l, ...older]; }); if (l.length < PAGE) setMore(false); }).catch(() => setLog((c) => c || []));
  }, [app.activitySeq]);
  const older = async () => {
    if (!log?.length || loading) return;
    setLoading(true);
    try { const l = await api.activityLog({ before: log[log.length - 1].t, limit: PAGE }); setLog([...log, ...l]); if (l.length < PAGE) setMore(false); } finally { setLoading(false); }
  };
  const rows = (log || []).filter((a) => !groups[f] || groups[f]!.includes(a.kind) && (f !== 'agents' || !a.human));
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = rows.filter((a) => a.t >= startOfDay), earlier = rows.filter((a) => a.t < startOfDay);
  const list = (items: typeof rows, label: string) => items.length ? <>
    <div style={{ font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)', marginTop: 4 }}>{label}</div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((a) => {
        const [ic, col] = ICON[a.kind] || ICON.done;
        const human = a.kind === 'merge' || a.human;
        const failed = a.ok === false;
        return (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: narrow ? '44px 20px minmax(0,1fr)' : '44px 20px minmax(0,1fr) auto', gap: 10, alignItems: 'center', minHeight: 36, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{clock(a.t)}</span>
            <i className={'ph ph-' + ic} style={{ fontSize: 15, color: col }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, font: '400 13px/1.5 var(--font-sans)' }}>
              <Avatar size={16} agent={!human} name={a.who} />
              <span style={{ font: '500 12px/1.5 var(--font-mono)', color: 'var(--text-1)', cursor: human ? 'default' : 'pointer' }} onClick={() => !human && a.sessionId && go({ screen: 'session', id: a.sessionId, tab: 'conversation' })}>{a.who}</span>
              <span title={a.detail || a.what} style={{ color: failed ? 'var(--status-error-text)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.what}</span>
            </span>
            {narrow ? null : <span style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{a.repo}</span>}
          </div>
        );
      })}
    </div>
  </> : null;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ maxWidth: 860, padding: narrow ? '14px 12px 24px' : '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h1 style={{ margin: 0, flex: 1, font: '600 20px/1.5 var(--font-sans)' }}>Activity</h1>
          <SegmentedControl size="sm" value={f} onChange={setF} options={[{ value: 'all', label: 'All' }, { value: 'attention', label: 'Needs you' }, { value: 'git', label: 'Git' }, { value: 'sessions', label: 'Sessions' }, { value: 'agents', label: 'Agent actions' }]} />
        </div>
        {log == null ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Loading…</div> : null}
        {log && rows.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Nothing yet. Everything helm and its agents do shows up here: git pushes and fetches, commits, merges, commands and file edits, approvals, and changes to sessions. Reading files is not logged.</div> : null}
        {list(today, 'Today')}
        {list(earlier, 'Earlier')}
        {more && log && log.length >= PAGE ? <div><Button size="sm" variant="ghost" loading={loading} onClick={older}>Show older</Button></div> : null}
      </div>
    </div>
  );
}

export { repoOf };
