import React from 'react';
import type { Report, WorktreeUsage } from '@shared/types';
import { bytesText, durationText, type SystemPoint, type SystemStatus } from '@shared/system';
import { fmtDuration } from '@shared/reports';
import { FREE_ID, repoLabel } from '@shared/types';
import { api } from '../api';
import { fmtTokens } from '../lib';
import { go, toast, useApp, useMoney } from '../store';
import { Badge, Button, Meter, Panel, SegmentedControl, Stat, useNarrow } from '../ui';

const fail = (title: string) => (e: any) => toast({ tone: 'error', title, description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') });
const head: React.CSSProperties = { font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
const mono: React.CSSProperties = { font: '400 12px/1.5 var(--font-mono)' };
const pct = (x: number) => Math.round(x * 100) + '%';
const empty = (text: string) => <div style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)', padding: '4px 0' }}>{text}</div>;

/** A row with a name, a bar scaled to the largest value in its list, and a figure. */
function BarRow({ label, value, max, text, sub, onClick, tone }: { label: React.ReactNode; value: number; max: number; text: React.ReactNode; sub?: React.ReactNode; onClick?: () => void; tone?: string }) {
  return (
    <div onClick={onClick} className={'helm-barrow' + (onClick ? ' helm-row-hover' : '')} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr auto', gap: 12, alignItems: 'center', padding: '5px 4px', cursor: onClick ? 'pointer' : undefined, borderRadius: 'var(--radius-sm)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ ...mono, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        {sub ? <span style={{ font: '400 11px/1.5 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span> : null}
      </span>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-active)', overflow: 'hidden' }}>
        <div style={{ width: (max ? Math.max(value / max, value > 0 ? 0.01 : 0) * 100 : 0) + '%', height: '100%', borderRadius: 999, background: tone || 'var(--accent)' }} />
      </div>
      <span style={{ ...mono, color: 'var(--text-2)', minWidth: 64, textAlign: 'right' }}>{text}</span>
    </div>
  );
}

/** Columns for the last N days; hovering a bar names the day and the amount. */
function Columns({ data, format, height = 96 }: { data: { key: string; value: number }[]; format: (v: number) => string; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const label = (k: string) => new Date(k + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: data.length > 45 ? 1 : 3, height }}>
        {data.map((d) => (
          <div key={d.key} title={`${label(d.key)}: ${format(d.value)}`} style={{ flex: 1, minWidth: 1, height: Math.max(d.value > 0 ? 3 : 1, max ? (d.value / max) * height : 1), borderRadius: '2px 2px 0 0', background: d.value > 0 ? 'var(--accent)' : 'var(--border)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>
        <span>{data[0] ? label(data[0].key) : ''}</span>
        <span>{data.length ? label(data[data.length - 1].key) : ''}</span>
      </div>
    </div>
  );
}

const Grid = ({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) => <div className="helm-stack" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 12 }}>{children}</div>;

function Spend({ r, fmt }: { r: Report; fmt: (v: number, whole?: boolean) => string }) {
  const s = r.spend;
  const maxRepo = Math.max(...s.byRepo.map((x) => x.cost), 0);
  const o = r.outcomes;
  const soon = (w: Report['spend']['weekly']) => (w ? (w.hitsAt ? `At this pace you hit the limit ${new Date(w.hitsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : `On course for ${pct(w.projected)} by the reset`) : null);
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat label="Spent" value={fmt(s.total.cost)} detail={`${fmt(s.perDay)} a day · about ${fmt(s.perMonth, true)} a month`} />
          <Stat label="Tokens" value={fmtTokens(s.total.tokens)} detail="all models" />
          <Stat label="Cache hit" value={pct(s.cacheHit)} detail="of input read from cache" tone={s.cacheHit < 0.5 && s.total.tokens > 0 ? 'attention' : undefined} />
          <Stat label="Per merged session" value={o.costPerMerged != null ? fmt(o.costPerMerged) : '–'} detail={o.costPer100Lines != null ? `${fmt(o.costPer100Lines)} per 100 changed lines` : 'nothing merged yet'} />
          <Stat label="Abandoned" value={pct(o.wasteShare)} detail="of spend on sessions never merged" tone={o.wasteShare > 0.25 ? 'attention' : undefined} />
        </div>
      </Panel>
      {s.fiveHour || s.weekly ? (
        <Panel title="Plan usage pace" icon="gauge">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>
            {s.fiveHour ? <span><b style={{ color: 'var(--text-1)', fontWeight: 600 }}>5-hour window:</b> {soon(s.fiveHour)}.</span> : null}
            {s.weekly ? <span><b style={{ color: 'var(--text-1)', fontWeight: 600 }}>Weekly:</b> {soon(s.weekly)}.</span> : null}
          </div>
        </Panel>
      ) : null}
      <Panel title="Spend by day" icon="chart-bar"><Columns data={s.days.map((d) => ({ key: d.day, value: d.cost }))} format={(v) => fmt(v)} /></Panel>
      <Grid>
        <Panel title="By repository" icon="book-bookmark">
          {s.byRepo.length ? s.byRepo.map((x) => <BarRow key={x.id} label={repoLabel(x.id)} value={x.cost} max={maxRepo} text={fmt(x.cost)} sub={fmtTokens(x.tokens) + ' tokens'} onClick={x.id === FREE_ID ? undefined : () => go({ screen: 'repo', id: x.id })} />) : empty('No usage in this period.')}
        </Panel>
        <Panel title="By model and effort" icon="cpu">
          {s.byModel.map((x) => <BarRow key={x.id} label={x.id} value={x.cost} max={s.byModel[0].cost} text={fmt(x.cost)} sub={fmtTokens(x.tokens) + ' tokens'} />)}
          {s.byEffort.length ? <div style={{ ...head, margin: '12px 4px 4px' }}>Sessions by effort</div> : null}
          {s.byEffort.map((x) => <BarRow key={x.id} label={x.id} value={x.cost} max={s.byEffort[0].cost} text={fmt(x.cost)} sub={`${x.sessions} ${x.sessions === 1 ? 'session' : 'sessions'}`} tone="var(--text-2)" />)}
          {!s.byModel.length ? empty('No usage in this period.') : null}
        </Panel>
      </Grid>
      <Panel title="Most expensive sessions" icon="coins">
        {s.topSessions.length ? s.topSessions.map((x) => <BarRow key={x.id} label={x.id} value={x.cost} max={s.topSessions[0].cost} text={fmt(x.cost)} sub={`${repoLabel(x.repoId)} · ${x.model}`} onClick={() => go({ screen: 'session', id: x.id })} />) : empty('No sessions in this period.')}
      </Panel>
      <Panel title="Cost per outcome" icon="target">
        <div className="helm-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {(['merged', 'pr', 'open', 'abandoned'] as const).map((k) => (
            <Stat key={k} label={{ merged: 'Merged', pr: 'In a pull request', open: 'In progress', abandoned: 'Abandoned' }[k]} value={o.counts[k]} detail={fmt(o.cost[k]) + ' spent'} tone={k === 'abandoned' && o.counts[k] ? 'attention' : undefined} />
          ))}
        </div>
      </Panel>
    </>
  );
}

function Throughput({ r }: { r: Report }) {
  const t = r.throughput;
  const max = Math.max(...t.weeks.map((w) => Math.max(w.started, w.merged, w.abandoned)), 1);
  const total = Object.entries(t.statusTime).filter(([k]) => k !== 'idle');
  const sum = total.reduce((n, [, v]) => n + (v || 0), 0) || 1;
  const STATUS: Record<string, string> = { working: 'Agents working', attention: 'Waiting on you', ready: 'Ready, not yet reviewed', error: 'Failed' };
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat label="Waiting on you" value={fmtDuration(t.waiting.total)} detail={`${pct(t.waiting.share)} of agent time`} tone={t.waiting.share > 0.3 ? 'attention' : undefined} />
          <Stat label="To first commit" value={fmtDuration(t.leadTime.firstCommit)} detail="median" />
          <Stat label="To pull request" value={fmtDuration(t.leadTime.pullRequest)} detail="median" />
          <Stat label="To merge" value={fmtDuration(t.leadTime.merged)} detail="median" />
        </div>
      </Panel>
      <Panel title="Sessions per week" icon="calendar-blank">
        <div style={{ display: 'flex', gap: 14, marginBottom: 8, font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--text-3)', marginRight: 5 }} />Started</span>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--status-ready)', marginRight: 5 }} />Merged</span>
          <span><i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--status-attention)', marginRight: 5 }} />Abandoned</span>
        </div>
        {t.weeks.map((w) => (
          <div key={w.start} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 12, alignItems: 'center', padding: '3px 4px' }}>
            <span style={{ ...mono, color: 'var(--text-3)' }}>{new Date(w.start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {([['started', 'var(--text-3)'], ['merged', 'var(--status-ready)'], ['abandoned', 'var(--status-attention)']] as const).map(([k, c]) => (
                <div key={k} title={`${w[k]} ${k}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ height: 5, width: (w[k] / max) * 100 + '%', minWidth: w[k] ? 3 : 0, borderRadius: 999, background: c }} />
                  {w[k] ? <span style={{ font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{w[k]}</span> : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </Panel>
      <Grid>
        <Panel title="Where the time went" icon="hourglass">
          {total.length ? total.map(([k, v]) => <BarRow key={k} label={STATUS[k] || k} value={v || 0} max={sum} text={fmtDuration(v || 0)} tone={k === 'attention' ? 'var(--status-attention)' : k === 'error' ? 'var(--status-error)' : undefined} />) : empty('No sessions in this period.')}
        </Panel>
        <Panel title="Waited longest for you" icon="bell-ringing">
          {t.waiting.sessions.length ? t.waiting.sessions.map((x) => <BarRow key={x.id} label={x.id} value={x.ms} max={t.waiting.sessions[0].ms} text={fmtDuration(x.ms)} sub={repoLabel(x.repoId)} tone="var(--status-attention)" onClick={() => go({ screen: 'session', id: x.id })} />) : empty('Nothing waited on you.')}
        </Panel>
      </Grid>
    </>
  );
}

function Approvals({ r }: { r: Report }) {
  const a = r.approvals;
  const app = useApp();
  const allow = (pattern: string) => api.updateSettings({ alwaysAllow: [...new Set([...app.settings.alwaysAllow, pattern])] }).then(() => toast({ tone: 'ready', title: 'Always allowed', description: pattern })).catch(fail('Could not save'));
  const max = Math.max(...a.byCommand.map((x) => x.approved + x.always + x.denied), 0);
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat label="Asked of you" value={a.total} detail={`${a.commandsRun} commands run in total`} />
          <Stat label="Approved" value={a.approved + a.always} detail={`${a.always} as always allow`} />
          <Stat label="Denied" value={a.denied} tone={a.denied ? 'attention' : undefined} />
          <Stat label="Median wait" value={fmtDuration(a.medianWaitMs)} detail="before you answered" />
        </div>
      </Panel>
      {a.suggestions.length ? (
        <Panel title="Suggested allow rules" icon="lightbulb" actions={<span style={{ font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)', paddingRight: 8 }}>approved often, never denied</span>}>
          {a.suggestions.map((x) => (
            <div key={x.pattern} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 4px' }}>
              <code style={{ ...mono, color: 'var(--text-1)' }}>{x.pattern}</code>
              <span style={{ flex: 1, font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>approved {x.count} times</span>
              <Button size="sm" variant="secondary" icon="check" onClick={() => void allow(x.pattern)}>Always allow</Button>
            </div>
          ))}
        </Panel>
      ) : null}
      <Panel title="Commands you were asked about" icon="terminal-window">
        {a.byCommand.length ? a.byCommand.map((x) => (
          <BarRow key={x.key} label={x.key} value={x.approved + x.always + x.denied} max={max} text={`${x.approved + x.always} ok${x.denied ? ` · ${x.denied} no` : ''}`} tone={x.denied ? 'var(--status-attention)' : undefined} />
        )) : empty('Nothing asked for approval in this period.')}
      </Panel>
    </>
  );
}

function Quality({ r }: { r: Report }) {
  const q = r.quality;
  const maxTool = Math.max(...q.tools.map((x) => x.n), 0);
  return (
    <>
      <Panel title="Looks stuck" icon="warning">
        {q.stuck.length ? q.stuck.map((x) => (
          <div key={x.id} className="helm-row-hover" onClick={() => go({ screen: 'session', id: x.id })} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 4px', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}>
            <Badge tone="attention" icon="warning">Stuck</Badge>
            <span style={{ ...mono }}>{x.id}</span>
            <span style={{ flex: 1, font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{x.reason}</span>
            <span style={{ ...mono, color: 'var(--text-3)' }}>{repoLabel(x.repoId)}</span>
          </div>
        )) : empty('No session looks stuck. A session is flagged when it edits one file 10 times, or fails the same command 3 times in a row, without committing.')}
      </Panel>
      <Grid>
        <Panel title="Context window" icon="database">
          {q.context.length ? q.context.map((x) => (
            <div key={x.id} onClick={() => go({ screen: 'session', id: x.id })} style={{ padding: '4px', cursor: 'pointer' }}>
              <Meter value={x.ctx} max={x.window} warnAt={0.7} label={x.id} detail={`${fmtTokens(x.ctx)} · ${pct(x.pct)}`} />
            </div>
          )) : empty('No sessions have used context yet.')}
        </Panel>
        <Panel title="Tool calls" icon="wrench">
          {q.tools.length ? q.tools.slice(0, 12).map((x) => <BarRow key={x.name} label={x.name} value={x.n} max={maxTool} text={`${x.n}${x.err ? ` · ${x.err} failed` : ''}`} tone={x.err / Math.max(1, x.n) > 0.2 ? 'var(--status-attention)' : undefined} />) : empty('Tool use is counted from now on.')}
        </Panel>
      </Grid>
      <Grid>
        <Panel title="Files agents touch most" icon="file-code">
          {q.hotFiles.length ? q.hotFiles.map((f) => (
            <BarRow key={f.repoId + f.path} label={f.path} value={f.sessions} max={q.hotFiles[0].sessions} text={`${f.sessions} ${f.sessions === 1 ? 'session' : 'sessions'}`} sub={`${repoLabel(f.repoId)} · +${f.add} −${f.del}`} />
          )) : empty('No changes recorded.')}
        </Panel>
        <Panel title="Edited again and again" icon="arrows-clockwise">
          {q.churn.length ? q.churn.map((c) => <BarRow key={c.id + c.file} label={c.file} value={c.edits} max={q.churn[0].edits} text={c.edits + ' edits'} sub={c.id} tone="var(--status-attention)" onClick={() => go({ screen: 'session', id: c.id })} />) : empty('No file was edited five times or more in one go.')}
        </Panel>
      </Grid>
    </>
  );
}

function Digest({ days }: { days: number }) {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => { setText(null); void api.reportDigest(days).then(setText); }, [days]);
  return (
    <Panel title="Digest" icon="newspaper" actions={<>
      <Button size="sm" variant="ghost" icon="copy" disabled={!text} onClick={() => { void api.copyText(text!); toast({ tone: 'neutral', title: 'Copied the digest' }); }}>Copy</Button>
      <Button size="sm" variant="ghost" icon="download-simple" onClick={() => void api.exportReport('digest', days).catch(fail('Could not save'))}>Save…</Button>
    </>}>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', font: '400 12.5px/1.6 var(--font-mono)', color: 'var(--text-2)' }}>{text ?? 'Writing…'}</pre>
    </Panel>
  );
}

function Audit({ days }: { days: number }) {
  return (
    <Panel title="Audit log" icon="list-checks">
      <div style={{ font: '400 12.5px/1.6 var(--font-sans)', color: 'var(--text-2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span>Every command an agent ran, every file it edited, and every approval or question you answered, with the time and how long the agent waited. Tokens, keys, passwords and credentials in URLs are masked before anything is stored. helm keeps the last 5,000 entries.</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="sm" variant="secondary" icon="download-simple" onClick={() => void api.exportReport('audit', days).catch(fail('Could not save'))}>Export audit log (CSV)…</Button>
          <Button size="sm" variant="secondary" icon="download-simple" onClick={() => void api.exportReport('spend', days).catch(fail('Could not save'))}>Export spend (CSV)…</Button>
          <Button size="sm" variant="secondary" icon="download-simple" onClick={() => void api.exportReport('sessions', days).catch(fail('Could not save'))}>Export sessions (CSV)…</Button>
        </div>
      </div>
    </Panel>
  );
}

const sectionTitle = (t: string) => <div style={{ ...head, marginTop: 8 }}>{t}</div>;

const gb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB');

/** Disk used by session worktrees, with the build output and packages that can be deleted without losing work. */
function Disk() {
  // The system panels above show the machine; this part is about what helm's sessions take on it.
  const [rows, setRows] = React.useState<WorktreeUsage[] | null>(null);
  const [busy, setBusy] = React.useState('');
  const load = (refresh = false) => { setRows(null); api.worktreeUsage(refresh).then(setRows).catch((e) => { fail('Could not measure the worktrees')(e); setRows([]); }); };
  React.useEffect(() => load(), []);
  const total = (rows || []).reduce((n, r) => n + r.bytes, 0);
  const free = (rows || []).filter((r) => !r.running).reduce((n, r) => n + r.reclaimable, 0);
  const max = Math.max(...(rows || []).map((r) => r.bytes), 0);
  const act = async (key: string, fn: () => Promise<unknown>, done: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); toast({ tone: 'ready', title: done(r) }); load(true); } catch (e) { fail('That did not work')(e); } finally { setBusy(''); }
  };
  const cleanAll = async () => {
    setBusy('all');
    let freed = 0;
    for (const r of (rows || []).filter((x) => !x.running && x.reclaimable > 0)) { try { freed += await api.cleanWorktree(r.sessionId); } catch { /* one that cannot be cleaned does not stop the rest */ } }
    toast({ tone: 'ready', title: `Freed ${gb(freed)}` });
    setBusy('');
    load(true);
  };
  return (
    <>
      {sectionTitle('Session worktrees')}
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Stat label="Worktrees" value={rows ? gb(total) : '…'} detail={rows ? `${rows.length} ${rows.length === 1 ? 'worktree' : 'worktrees'}` : 'measuring…'} />
          <Stat label="Can be freed" value={rows ? gb(free) : '…'} detail="ignored build output and packages, in sessions not running" tone={free > 2e9 ? 'attention' : undefined} />
          <span style={{ flex: 1 }} />
          <Button variant="ghost" icon="arrows-clockwise" onClick={() => load(true)}>Measure again</Button>
          <Button variant="primary" icon="broom" disabled={!free || !!busy} loading={busy === 'all'} onClick={() => void cleanAll()}>Free {gb(free)}</Button>
        </div>
      </Panel>
      <Panel title="Worktrees, largest first" icon="hard-drives">
        {rows == null ? empty('Measuring. The first time can take a while for big repositories.') : null}
        {rows && !rows.length ? empty('No session has a worktree.') : null}
        {(rows || []).map((r) => (
          <div key={r.sessionId} className="helm-barrow" style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 240px) 1fr auto', gap: 12, alignItems: 'center', padding: '7px 4px', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <span style={{ ...mono, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={() => go({ screen: 'session', id: r.sessionId })}>{r.sessionId}</span>
              <span style={{ font: '400 11px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{r.repoId} · {r.running ? 'running' : r.merged ? 'merged' : r.archived ? 'archived' : r.status}{r.dirty ? ` · ${r.dirty} uncommitted` : ''}{r.unpushed ? ` · ${r.unpushed} unpushed` : ''}</span>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--bg-active)', overflow: 'hidden', display: 'flex' }} title={`${gb(r.bytes)}, of which ${gb(r.reclaimable)} can be freed (${r.reclaimDirs.join(', ') || 'nothing'})`}>
                <div style={{ width: (max ? ((r.bytes - r.reclaimable) / max) * 100 : 0) + '%', background: 'var(--text-3)' }} />
                <div style={{ width: (max ? (r.reclaimable / max) * 100 : 0) + '%', background: 'var(--accent)' }} />
              </div>
              <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{gb(r.bytes)}{r.partial ? '+' : ''}{r.reclaimable ? ` · ${gb(r.reclaimable)} in ${r.reclaimDirs.join(', ')}` : ''}</span>
            </div>
            <span style={{ display: 'flex', gap: 4 }}>
              <Button size="sm" variant="secondary" icon="broom" disabled={!r.reclaimable || r.running || !!busy} loading={busy === 'c' + r.sessionId} title={r.running ? 'Stop the session first' : undefined} onClick={() => void act('c' + r.sessionId, () => api.cleanWorktree(r.sessionId), (b) => `Freed ${gb(b)}`)}>Clean</Button>
              {r.archived || r.merged ? <Button size="sm" variant="ghost" icon="trash" disabled={!!busy} loading={busy === 'd' + r.sessionId} title="Remove the worktree. The branch and the conversation stay." onClick={() => void act('d' + r.sessionId, () => api.dropWorktree(r.sessionId), () => 'Worktree removed')}>Remove</Button> : null}
            </span>
          </div>
        ))}
      </Panel>
      <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)', maxWidth: 760 }}>Clean deletes node_modules, dist, build, .next, target, .venv and similar folders at the top of a worktree, and only where git ignores them and tracks nothing inside, so it can be rebuilt by installing again. Your copied .env files are not touched.</span>
    </>
  );
}

/** A line graph of readings over time, scaled 0..max (or to the largest value when max is not given). */
function Trend({ points, max, format, color = 'var(--accent)', height = 72 }: { points: { t: number; v: number | null }[]; max?: number; format: (v: number) => string; color?: string; height?: number }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const vals = points.map((p) => p.v ?? 0);
  const top = max ?? (Math.max(...vals, 0) * 1.15 || 1);
  const W = 600, n = points.length;
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W);
  const y = (v: number) => height - 2 - Math.min(1, v / top) * (height - 4);
  const line = points.map((p, i) => (p.v == null ? null : `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)).filter(Boolean).join(' ');
  const h = hover != null ? points[hover] : null;
  const span = n > 1 ? points[n - 1].t - points[0].t : 0;
  return (
    <div>
      <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)} onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))))); }}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', background: 'var(--bg-active)', borderRadius: 'var(--radius-sm)' }}>
          {n > 1 ? <polygon points={`0,${height} ${line} ${W},${height}`} fill={color} opacity={0.15} /> : null}
          {n > 1 ? <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
          {hover != null && h?.v != null ? <line x1={x(hover)} x2={x(hover)} y1={0} y2={height} stroke="var(--text-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {h ? <div style={{ position: 'absolute', top: 2, right: 6, ...mono, fontSize: 11, color: 'var(--text-1)' }}>{new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {h.v == null ? '–' : format(h.v)}</div> : null}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, font: '400 10.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>
        <span>{span ? durationText(span / 1000) + ' ago' : ''}</span><span>now</span>
      </div>
    </div>
  );
}

/** CPU, memory, disk and load of the machine helm runs on: this computer, or the server when hosted. */
function System() {
  const [st, setSt] = React.useState<SystemStatus | null>(null);
  React.useEffect(() => {
    let live = true;
    const tick = () => api.systemStatus().then((r) => live && setSt(r)).catch(fail('Could not read the system status'));
    tick();
    const t = setInterval(tick, 3000);
    return () => { live = false; clearInterval(t); };
  }, []);
  if (!st) return <div style={{ ...head }}>Reading…</div>;
  const h: SystemPoint[] = st.history;
  const memPct = st.memory.total ? st.memory.used / st.memory.total : 0;
  return (
    <>
      <Panel>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <Stat label="CPU" value={st.cpu == null ? '…' : pct(st.cpu)} detail={`${st.cores} ${st.cores === 1 ? 'core' : 'cores'} · load ${st.load.map((l) => l.toFixed(2)).join(' ')}`} tone={st.cpu != null && st.cpu > 0.9 ? 'attention' : undefined} />
          <Stat label={st.memory.limited ? 'Memory (limit)' : 'Memory'} value={bytesText(st.memory.used)} detail={`of ${bytesText(st.memory.total)} · ${pct(memPct)}`} tone={memPct > 0.9 ? 'attention' : undefined} />
          <Stat label="helm itself" value={bytesText(st.process.rss)} detail={`${st.process.cpu == null ? '…' : pct(st.process.cpu)} CPU · pid ${st.process.pid}`} />
          <Stat label="Sessions" value={`${st.sessions.running} running`} detail={`${st.sessions.total} not archived`} />
          <Stat label="Up" value={durationText(st.uptime)} detail={`${st.hostname} · ${st.platform} ${st.arch}`} />
        </div>
      </Panel>
      <Grid>
        <Panel title="CPU" icon="cpu"><Trend points={h.map((p) => ({ t: p.t, v: p.cpu }))} max={1} format={pct} /></Panel>
        <Panel title="Memory" icon="memory"><Trend points={h.map((p) => ({ t: p.t, v: p.mem }))} max={st.memory.total} format={bytesText} /></Panel>
        <Panel title="Disk space free" icon="hard-drives"><Trend points={h.map((p) => ({ t: p.t, v: p.disk }))} max={st.disks[0]?.total} format={bytesText} color="var(--status-ready)" /></Panel>
        <Panel title="Load average (1 min)" icon="activity"><Trend points={h.map((p) => ({ t: p.t, v: p.load }))} format={(v) => v.toFixed(2)} /></Panel>
        <Panel title="helm's own memory" icon="gauge"><Trend points={h.map((p) => ({ t: p.t, v: p.rss }))} format={bytesText} color="var(--text-2)" /></Panel>
        <Panel title="helm's own CPU" icon="gauge"><Trend points={h.map((p) => ({ t: p.t, v: p.proc }))} max={1} format={pct} color="var(--text-2)" /></Panel>
      </Grid>
      <Panel title="Disk space" icon="hard-drives">
        {st.disks.length ? st.disks.map((d) => <Meter key={d.label} label={d.label} detail={`${bytesText(d.total - d.free)} used · ${bytesText(d.free)} free of ${bytesText(d.total)}`} value={d.total - d.free} max={d.total} style={{ padding: '4px 0' }} />) : empty('No disk information.')}
      </Panel>
      <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)', maxWidth: 760 }}>{st.model ? st.model + '. ' : ''}Readings are taken every few seconds while helm runs, and the last hour is kept. {st.memory.limited ? 'Memory is measured against the limit this container was given.' : ''}</span>
    </>
  );
}

const TABS = [
  { value: 'spend', label: 'Spend', icon: 'coins' },
  { value: 'throughput', label: 'Throughput', icon: 'gauge' },
  { value: 'approvals', label: 'Approvals', icon: 'shield-check' },
  { value: 'quality', label: 'Quality', icon: 'heartbeat' },
  { value: 'digest', label: 'Digest', icon: 'newspaper' },
  { value: 'audit', label: 'Audit', icon: 'list-checks' },
  { value: 'system', label: 'System', icon: 'cpu' }
];

export function Reports({ tab = 'spend' }: { tab?: string }) {
  const narrow = useNarrow();
  const app = useApp();
  const { fmt } = useMoney();
  const [days, setDays] = React.useState(() => { try { return +(localStorage.getItem('helm-report-days') || 30) || 30; } catch { return 30; } });
  const [report, setReport] = React.useState<Report | null>(null);
  const [err, setErr] = React.useState('');
  // Recompute when sessions change, but no more often than every few seconds.
  const stamp = app.sessions.reduce((n, s) => n + s.commits.length + (s.mergedAt ? 1 : 0) + (s.archivedAt ? 1 : 0), 0) + ':' + Math.round(app.sessions.reduce((n, s) => n + s.cost, 0) * 100);
  React.useEffect(() => {
    let live = true;
    const t = setTimeout(() => api.getReport(days).then((r) => live && (setReport(r), setErr(''))).catch((e) => live && setErr(String(e?.message || e))), 150);
    return () => { live = false; clearTimeout(t); };
  }, [days, stamp]);
  const set = (d: number) => { setDays(d); try { localStorage.setItem('helm-report-days', String(d)); } catch { /* storage unavailable */ } };

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: narrow ? '14px 12px 24px' : '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1200 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ margin: 0, font: '600 20px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>Reports</h1>
            <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>What your agents cost, how long things take, and where they need you. Spend history starts when this version was first run.</span>
          </div>
          <SegmentedControl value={String(days)} onChange={(v: string) => set(+v)} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        </div>
        <SegmentedControl value={tab} onChange={(v: string) => go({ screen: 'reports', tab: v })} options={TABS} style={{ alignSelf: 'flex-start' }} />
        {err ? <div style={{ color: 'var(--status-error-text)', font: '400 12.5px/1.5 var(--font-sans)' }}>Could not build the report: {err}</div> : null}
        {!report && !err && tab !== 'system' && tab !== 'digest' && tab !== 'audit' ? <div style={{ ...head }}>Working it out…</div> : null}
        {report && tab === 'spend' ? <Spend r={report} fmt={fmt} /> : null}
        {report && tab === 'throughput' ? <Throughput r={report} /> : null}
        {report && tab === 'approvals' ? <Approvals r={report} /> : null}
        {report && tab === 'quality' ? <Quality r={report} /> : null}
        {tab === 'digest' ? <Digest days={days} /> : null}
        {tab === 'audit' ? <Audit days={days} /> : null}
        {tab === 'system' || tab === 'disk' ? <><System /><Disk /></> : null}
      </div>
    </div>
  );
}
