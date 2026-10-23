import React from 'react';
import type { Session } from '@shared/types';
import { api, platform } from '../api';
import { ago, clock, fmtTokens, laneAxis, laneData, LANE_MIN, livePlan, repoOf, reposWithSessions, runningSubagents, sessionTokens, totals, untilReset } from '../lib';
import { go, setUI, useApp, useMoney, toast } from '../store';
import { Avatar, Button, DiffStat, Meter, SegmentedControl, Stat, StatusDot, useColumns } from '../ui';
import { PlanMeters } from './Shell';

const lanePct = (m: number) => ((m / LANE_MIN) * 100).toFixed(2) + '%';
const LANE_COLOR: Record<string, string> = { working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)' };

const guard = (p: Promise<any>) => p.catch((e: any) => toast({ tone: 'error', title: 'That did not work', description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') }));

export function Lane({ s, now }: { s: Session; now: number }) {
  const { segs, marks } = laneData(s, now);
  return (
    <div style={{ position: 'relative', height: 20 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 1, background: 'var(--border-subtle)' }} />
      {segs.map(([a, b, st], i) => <div key={i} style={{ position: 'absolute', top: 6, height: 8, left: lanePct(a), width: lanePct(b - a), borderRadius: 2, background: LANE_COLOR[st], opacity: st === 'working' ? 0.85 : 1 }} />)}
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>
        <StatusDot status="attention" size={7} />
        <span style={{ color: 'var(--text-2)' }}>{s.repoId.split('/')[1]}</span><span>/</span>
        <span style={{ color: 'var(--text-1)', cursor: 'pointer' }} onClick={open}>{s.id}</span>
        <span style={{ marginLeft: 'auto' }}>{ago(a.at)}</span>
      </div>
      <div style={{ font: '600 13px/1.35 var(--font-sans)', textWrap: 'pretty' as any }}>{a.head}</div>
      {a.command ? <code className="selectable" style={{ font: 'var(--type-data)', padding: '6px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', color: 'var(--text-1)', wordBreak: 'break-all' }}>{a.tool === 'Bash' || a.tool === 'PowerShell' ? '$ ' : ''}{a.command}</code> : null}
      {a.type === 'budget' && a.scope === 'plan' ? <PlanMeters /> : null}
      {a.type === 'budget' && a.scope !== 'plan' ? <Meter value={s.cost} max={s.budget} detail={fmt(s.cost) + ' / ' + fmt(s.budget)} label="Session budget" /> : null}
      {a.note ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)', flex: 1, textWrap: 'pretty' as any }}>{a.note}</div> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a.type === 'approve' ? <>
          <Button size="sm" variant="primary" onClick={() => resolve({ decision: 'approve' })}>Approve once</Button>
          {a.pattern ? <Button size="sm" onClick={() => resolve({ decision: 'always' })}>Always allow</Button> : null}
          <Button size="sm" variant="ghost" onClick={() => resolve({ decision: 'deny' })}>Deny</Button>
        </> : null}
        {a.type === 'question' ? <>
          {(q?.options || []).slice(0, 3).map((o, i) => <Button key={o.label} size="sm" variant={i === 0 ? 'primary' : 'secondary'} onClick={() => resolve({ answers: { [q!.question]: o.label } })}>{o.label}</Button>)}
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

function SessionRow({ s, now, tpl, sub }: { s: Session; now: number; tpl: string; sub: boolean }) {
  const { fmt, sym, from } = useMoney();
  const [hover, setHover] = React.useState(false);
  const needs = s.status === 'attention';
  const a = s.ask;
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' })}
      style={{ display: 'grid', gridTemplateColumns: tpl, gap: 12, alignItems: 'center', minHeight: 44, padding: '0 12px', borderTop: '1px solid var(--border-subtle)', background: hover ? 'var(--bg-hover)' : 'transparent', cursor: 'pointer' }}>
      <StatusDot status={s.status} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <span style={{ font: '500 13px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.task}</span>
        <span style={{ font: '400 11px/1.2 var(--font-mono)', color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><i className="ph ph-git-branch" style={{ fontSize: 11 }} />{s.branch}{runningSubagents(s) ? <span style={{ color: 'var(--status-working-text)', marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-tree-structure" style={{ fontSize: 11 }} />{runningSubagents(s)} {runningSubagents(s) === 1 ? 'subagent' : 'subagents'}</span> : null}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.3 var(--font-sans)', color: needs ? 'var(--status-attention-text)' : 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.step}</span>
        {a?.type === 'approve' ? <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); void guard(api.resolveAsk(s.id, a.id, { decision: 'approve' })); }}>Approve</Button> : null}
        {a?.type === 'budget' ? <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); void guard(api.resolveAsk(s.id, a.id, { addBudget: a.scope === 'plan' ? 0 : from(5) })); }}>{a.scope === 'plan' ? 'Continue' : `Add ${sym}5`}</Button> : null}
        {s.status === 'ready' ? <Button size="sm" variant="secondary" icon="git-diff">Review</Button> : null}
      </div>
      <Lane s={s} now={now} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Meter value={s.ctx} max={200000} warnAt={0.75} style={{ flex: 1 }} /><span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-2)', width: 30, textAlign: 'right' }}>{fmtTokens(s.ctx)}</span></div>
      <span style={{ font: 'var(--type-data)', textAlign: 'right' }}>{fmtTokens(sessionTokens(s))}</span>
      {sub ? null : <span style={{ font: 'var(--type-data)', textAlign: 'right' }}>{fmt(s.cost)}</span>}
      <span style={{ textAlign: 'right' }}><DiffStat additions={s.add} deletions={s.del} /></span>
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
        <h2 style={{ margin: 0, font: '600 16px/1.3 var(--font-sans)' }}>{none ? 'Add your first repository' : 'Start your first session'}</h2>
        <p style={{ margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>
          {none ? 'helm works with GitHub repositories. Clone one from your account, from a URL, or register a clone you already have.' : 'Describe a task and helm gives the agent its own worktree and branch. Your checkout is never touched.'}
        </p>
        {none ? <Button variant="primary" icon="book-bookmark" onClick={() => setUI({ adding: true })}>Add repository</Button> : <Button variant="primary" icon="plus" onClick={() => setUI({ newSession: {} })}>New session</Button>}
      </div>
    </div>
  );
}

export function Dashboard({ filter: initial }: { filter?: string }) {
  const app = useApp();
  const [filter, setFilter] = React.useState(initial || 'all');
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const i = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(i); }, []);
  const t = totals(app);
  const { fmt } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const plan = livePlan(app);
  const col = useColumns(sub ? 'ledger-sub' : 'ledger-api', [
    { w: 20, min: 20, fixed: true }, { w: 270, min: 150 }, { w: 200, min: 150, flex: true }, { w: 300, min: 180 }, { w: 88, min: 60 }, { w: 56, min: 44 },
    ...(sub ? [] : [{ w: 56, min: 44 }]), { w: 104, min: 80, fixed: true }
  ]);
  const visible = (s: Session) => filter === 'all' || s.status === filter;
  const axis = laneAxis(now);
  const asks = app.sessions.filter((s) => s.ask).sort((a, b) => a.ask!.at - b.ask!.at);
  const cell: React.CSSProperties = { padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid var(--border-subtle)' };
  const groups = reposWithSessions(app).filter(({ sessions }) => sessions.some(visible));
  const date = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  const withSessions = new Set(app.sessions.map((s) => s.repoId)).size;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ margin: 0, font: '600 20px/1.2 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>{filter === 'attention' ? 'Needs you' : 'Overview'}</h1>
            <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>{date} · {app.sessions.length} {app.sessions.length === 1 ? 'session' : 'sessions'} across {withSessions} {withSessions === 1 ? 'repository' : 'repositories'}</span>
          </div>
          <Button variant="ghost" icon="book-bookmark" onClick={() => setUI({ adding: true })}>Add repository</Button>
          <Button variant="primary" icon="plus" kbd={platform() === 'darwin' ? '⌘N' : 'Ctrl+N'} disabled={app.repos.length === 0} onClick={() => setUI({ newSession: {} })}>New session</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr)) minmax(0,1.6fr)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
          <div style={{ ...cell, borderLeft: 'none' }}><Stat label="Working" value={t.working} tone="working" /></div>
          <div style={cell}><Stat label="Needs you" value={t.attention} tone="attention" /></div>
          <div style={cell}><Stat label="Ready for review" value={t.ready} tone="ready" /></div>
          <div style={cell}><Stat label="Tokens today" value={fmtTokens(t.tokens)} /></div>
          <div style={{ ...cell, gap: 10 }}>
            {sub ? <>
              <Stat label="Plan usage this week" value={plan.weekly ? Math.round(plan.weekly.util * 100) + '%' : '—'} detail={plan.weekly ? `resets in ${untilReset(plan.weekly.resetsAt)}` : 'appears after the first message'} />
              <Meter value={plan.fiveHour?.util ?? 0} max={1} warnAt={app.settings.warnAt / 100} detail={plan.fiveHour ? `5-hour window ${Math.round(plan.fiveHour.util * 100)}% · resets ${untilReset(plan.fiveHour.resetsAt)}` : '5-hour window: no data yet'} />
            </> : <>
              <Stat label="Spend this week" value={fmt(t.spent)} />
              <Meter value={t.spent} max={t.cap} warnAt={app.settings.warnAt / 100} detail={`of ${fmt(t.cap, true)} across ${app.repos.length} ${app.repos.length === 1 ? 'repository' : 'repositories'}`} />
            </>}
          </div>
        </div>

        {app.sessions.length === 0 ? <FirstRun /> : null}

        {asks.length > 0 ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="ph-fill ph-bell-ringing" style={{ fontSize: 14, color: 'var(--status-attention)' }} />
              <span style={{ font: '600 13px/1 var(--font-sans)' }}>Needs you</span>
              <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Oldest first. Agents wait here until you answer.</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
              {asks.map((s) => <AttentionCard key={s.id + s.ask!.id} s={s} />)}
            </div>
          </section>
        ) : filter === 'attention' ? (
          <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Nothing is waiting on you.</div>
        ) : null}

        {app.sessions.length > 0 ? (
          <section style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
              <span style={{ font: '600 13px/1 var(--font-sans)' }}>Sessions</span>
              <SegmentedControl size="sm" value={filter} onChange={setFilter} options={[
                { value: 'all', label: 'All', count: app.sessions.length },
                { value: 'attention', label: 'Needs you', count: t.attention },
                { value: 'working', label: 'Working', count: t.working },
                { value: 'ready', label: 'Review', count: t.ready }]} />
              <span style={{ flex: 1 }} />
              {[['working', 'Working'], ['attention', 'Waiting on you'], ['ready', 'Ready']].map(([k, l]) => (
                <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, font: '400 11px/1 var(--font-sans)', color: 'var(--text-3)' }}><span style={{ width: 12, height: 6, borderRadius: 2, background: LANE_COLOR[k] }} />{l}</span>
              ))}
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, font: '400 11px/1 var(--font-sans)', color: 'var(--text-3)' }}><span style={{ width: 2, height: 10, borderRadius: 1, background: 'var(--text-1)' }} />Commit</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'end', padding: '6px 12px', borderTop: '1px solid var(--border)', font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              <span />{col.cell(1, 'Session')}{col.cell(2, 'Now')}
              {col.cell(3, axis.map(([m, l]) => <span key={l} style={{ position: 'absolute', left: lanePct(m), transform: 'translateX(-50%)', font: '400 10.5px/1 var(--font-mono)', textTransform: 'none', letterSpacing: 0, color: l === 'now' ? 'var(--text-1)' : 'var(--text-3)' }}>{l}</span>), { height: 11 })}
              {col.cell(4, 'Context')}{col.cell(5, 'Tokens', { textAlign: 'right' })}{sub ? null : col.cell(6, 'Cost', { textAlign: 'right' })}<span style={{ textAlign: 'right' }}>Changes</span>
            </div>
            {groups.map(({ repo: r, sessions }) => (
              <div key={r.id}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 8px 0 12px', borderTop: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
                  <i className="ph ph-book-bookmark" style={{ fontSize: 14, color: 'var(--text-3)' }} />
                  <span style={{ font: '600 12.5px/1 var(--font-sans)', cursor: 'pointer' }} onClick={() => go({ screen: 'repo', id: r.id })}><span style={{ fontWeight: 400, color: 'var(--text-3)' }}>{r.owner}/</span>{r.name}</span>
                  {sub ? null : <>
                    <Meter value={app.weekSpend[r.id] || 0} max={r.cap} style={{ width: 90, marginLeft: 6 }} warnAt={app.settings.warnAt / 100} />
                    <span style={{ font: '400 11px/1 var(--font-mono)', color: (app.weekSpend[r.id] || 0) / r.cap >= app.settings.warnAt / 100 ? 'var(--status-attention-text)' : 'var(--text-3)' }}>{fmt(app.weekSpend[r.id] || 0)} / {fmt(r.cap, true)}</span>
                  </>}
                  <span style={{ flex: 1 }} />
                  <Button size="sm" variant="ghost" icon="git-commit" onClick={() => go({ screen: 'repo', id: r.id })}>History</Button>
                  <Button size="sm" variant="ghost" icon="plus" onClick={() => setUI({ newSession: { repoId: r.id } })}>New session</Button>
                </div>
                {sessions.filter(visible).map((s) => <SessionRow key={s.id} s={s} now={now} tpl={col.template} sub={sub} />)}
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function Activity() {
  const app = useApp();
  const [f, setF] = React.useState('all');
  const ICON: Record<string, [string, string]> = { ready: ['check-circle', 'var(--status-ready)'], attention: ['bell-ringing', 'var(--status-attention)'], budget: ['coins', 'var(--status-attention)'], commit: ['git-commit', 'var(--text-2)'], start: ['play-circle', 'var(--status-working)'], merge: ['git-merge', 'var(--accent-text)'], done: ['check', 'var(--text-3)'], error: ['warning-circle', 'var(--status-error)'] };
  const groups: Record<string, string[] | null> = { all: null, attention: ['attention', 'budget', 'error'], commits: ['commit', 'merge'], sessions: ['start', 'done', 'ready'] };
  const rows = app.activity.filter((a) => !groups[f] || groups[f]!.includes(a.kind));
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const today = rows.filter((a) => a.t >= startOfDay), earlier = rows.filter((a) => a.t < startOfDay);
  const list = (items: typeof rows, label: string) => items.length ? <>
    <div style={{ font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)', marginTop: 4 }}>{label}</div>
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((a) => {
        const [ic, col] = ICON[a.kind] || ICON.done;
        const human = a.kind === 'merge' || a.human;
        return (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '44px 20px minmax(0,1fr) auto', gap: 10, alignItems: 'center', minHeight: 36, borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{clock(a.t)}</span>
            <i className={'ph ph-' + ic} style={{ fontSize: 15, color: col }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, font: '400 13px/1.35 var(--font-sans)' }}>
              <Avatar size={16} agent={!human} name={a.who} />
              <span style={{ font: '500 12px/1 var(--font-mono)', color: 'var(--text-1)', cursor: human ? 'default' : 'pointer' }} onClick={() => !human && a.sessionId && go({ screen: 'session', id: a.sessionId, tab: 'conversation' })}>{a.who}</span>
              <span style={{ color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.what}</span>
            </span>
            <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{a.repo}</span>
          </div>
        );
      })}
    </div>
  </> : null;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ maxWidth: 860, padding: '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, flex: 1, font: '600 20px/1.2 var(--font-sans)' }}>Activity</h1>
          <SegmentedControl size="sm" value={f} onChange={setF} options={[{ value: 'all', label: 'All' }, { value: 'attention', label: 'Needs you' }, { value: 'commits', label: 'Commits & merges' }, { value: 'sessions', label: 'Sessions' }]} />
        </div>
        {rows.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Nothing yet. Events from your sessions show up here.</div> : null}
        {list(today, 'Today')}
        {list(earlier, 'Earlier')}
      </div>
    </div>
  );
}

export { repoOf };
