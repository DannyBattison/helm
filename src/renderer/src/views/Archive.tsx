import React from 'react';
import type { ExternalSession, Session } from '@shared/types';
import { api } from '../api';
import { ago, fmtTokens, relTime, sessionTokens } from '../lib';
import { go, setUI, toast, useApp, useUI } from '../store';
import { Badge, Button, Input, StatusDot, useColumns, useNarrow } from '../ui';

const head: React.CSSProperties = { font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
const fail = (title: string) => (e: any) => toast({ tone: 'error', title, description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') });

/** Everything hidden from the left tree and Overview, with a way back. */
export function Archive() {
  const app = useApp();
  const externals = useUI((u) => u.externals);
  const [q, setQ] = React.useState('');
  const narrow = useNarrow();
  const col = useColumns('archive', [{ w: 20, min: 20, fixed: true }, { w: 1, min: 220, flex: true }, { w: 170, min: 110 }, { w: 170, min: 110 }, { w: 90, min: 70 }, { w: 64, min: 50 }, { w: 200, min: 190, fixed: true }]);
  const days = app.settings.archiveAfterDays;
  const match = (...f: (string | undefined)[]) => !q.trim() || f.some((x) => x?.toLowerCase().includes(q.trim().toLowerCase()));

  const mine = app.sessions.filter((s) => s.archivedAt && match(s.task, s.id, s.branch, s.repoId, s.free ? 'free agent' : '')).sort((a, b) => b.archivedAt! - a.archivedAt!);
  const ext: { repoId: string; x: ExternalSession }[] = [];
  for (const [repoId, list] of Object.entries(externals)) for (const x of list) if (x.archived && match(x.title, x.branch, repoId)) ext.push({ repoId, x });
  ext.sort((a, b) => b.x.lastModified - a.x.lastModified);
  const total = app.sessions.filter((s) => s.archivedAt).length + Object.values(externals).reduce((n, l) => n + l.filter((x) => x.archived).length, 0);

  const restore = (s: Session) => api.archiveSession(s.id, false).catch(fail('Could not restore'));
  const reason = (s: Session) => (s.archivedAuto ? `idle for ${days || 'many'} days` : 'by you');

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <div style={{ padding: narrow ? '14px 12px 24px' : '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 style={{ margin: 0, font: '600 20px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>Archive</h1>
            <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
              {total} {total === 1 ? 'session' : 'sessions'} hidden from the left tree and Overview.{' '}
              {days ? `Sessions not opened for ${days} days are archived automatically.` : 'Automatic archiving is off.'}{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); go({ screen: 'settings', section: 'worktrees' }); }}>Change</a>
            </span>
          </div>
          <Input icon="magnifying-glass" placeholder="Filter archived sessions" value={q} onChange={(e: any) => setQ(e.target.value)} style={{ width: narrow ? '100%' : 280 }} />
        </div>

        <div style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ minWidth: col.minWidth + 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'end', padding: '10px 12px', ...head }}>
            <span />{col.cell(1, 'Session')}{col.cell(2, 'Repository')}{col.cell(3, 'Archived')}{col.cell(4, 'Last active')}{col.cell(5, 'Tokens')}<span />
          </div>
          {mine.length + ext.length === 0 ? <div style={{ padding: '24px 12px', borderTop: '1px solid var(--border-subtle)', font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{total ? 'Nothing matches that filter.' : 'Nothing is archived. Right-click a session in the left tree to archive it.'}</div> : null}

          {mine.map((s) => (
            <div key={s.id} className="helm-row-hover" onClick={() => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' })} style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', minHeight: 48, padding: '0 12px', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
              <StatusDot status={s.status} pulse={false} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ font: '500 13px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.task}</span>
                <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.free ? s.worktree.split(/[\\/]/).filter(Boolean).slice(-2).join('/') : s.branch}{s.files ? ` · ${s.files} files changed` : ''}{s.mergedAt ? ` · merged into ${s.mergedInto}` : s.prUrl ? ' · PR open' : ''}</span>
              </span>
              <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.free ? 'Free agents' : s.repoId}</span>
              <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{relTime(s.archivedAt!)} · {reason(s)}</span>
              <span style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{ago(s.lastAccess) === 'now' ? 'just now' : ago(s.lastAccess) + ' ago'}</span>
              <span style={{ font: 'var(--type-data)', color: 'var(--text-2)' }}>{fmtTokens(sessionTokens(s))}</span>
              <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" icon="arrow-counter-clockwise" onClick={() => void restore(s)}>Restore</Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => setUI({ deleting: s.id })}>Delete…</Button>
              </span>
            </div>
          ))}

          {ext.map(({ repoId, x }) => (
            <div key={x.id} className="helm-row-hover" onClick={() => go({ screen: 'external', repoId, id: x.id })} title="Started outside helm. Read-only." style={{ display: 'grid', gridTemplateColumns: col.template, gap: 12, alignItems: 'center', minHeight: 48, padding: '0 12px', borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
              <StatusDot status="idle" />
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <i className="ph ph-eye" style={{ fontSize: 13, color: 'var(--text-3)', flex: 'none' }} />
                <span style={{ font: 'italic 500 13px/1.5 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.title}</span>
                <Badge>External · read-only</Badge>
              </span>
              <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{repoId}</span>
              <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{x.archiveReason === 'age' ? `idle for ${days} days` : 'by you'}</span>
              <span style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{relTime(x.lastModified)}</span>
              <span style={{ font: 'var(--type-data)', color: 'var(--text-3)' }}>{x.size ? (x.size > 1e6 ? (x.size / 1e6).toFixed(0) + ' MB' : Math.max(1, Math.round(x.size / 1e3)) + ' kB') : ''}</span>
              <span style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" variant="secondary" icon="arrow-counter-clockwise" onClick={() => api.archiveExternal(x.id, false).then(() => import('../store').then((m) => m.refreshExternals())).catch(fail('Could not restore'))}>Restore</Button>
              </span>
            </div>
          ))}
          </div>
        </div>
      </div>
    </div>
  );
}
