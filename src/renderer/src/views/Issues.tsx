import React from 'react';
import type { Issue } from '@shared/types';
import { api } from '../api';
import { relTime } from '../lib';
import { setUI, toast, useApp } from '../store';
import { Badge, Button, Input } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');

/** Open issues of a repository. Starting a session on one puts the issue and its discussion into the task. */
export function Issues({ repoId }: { repoId: string }) {
  const app = useApp();
  const [issues, setIssues] = React.useState<Issue[] | null>(null);
  const [err, setErr] = React.useState('');
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(0);
  React.useEffect(() => { setIssues(null); setErr(''); api.repoIssues(repoId).then(setIssues).catch((e) => { setErr(errText(e)); setIssues([]); }); }, [repoId]);

  const start = async (i: Issue) => {
    setBusy(i.number);
    try {
      const t = await api.issueTask(repoId, i.number);
      setUI({ newSession: { repoId, task: t.task, source: { kind: 'issue', number: i.number, url: t.url, title: t.title } } });
    } catch (e) { toast({ tone: 'error', title: 'Could not read the issue', description: errText(e) }); } finally { setBusy(0); }
  };
  const mine = (n: number) => app.sessions.filter((s) => s.repoId === repoId && s.source?.kind === 'issue' && s.source.number === n && !s.archivedAt);
  const shown = (issues || []).filter((i) => !q.trim() || (i.title + ' ' + i.labels.join(' ') + ' #' + i.number).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '10px 20px 16px' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <Input icon="magnifying-glass" placeholder="Filter issues" value={q} onChange={(e: any) => setQ(e.target.value)} style={{ width: 280 }} />
      </div>
      {issues == null ? <span style={{ font: '400 12.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading issues…</span> : null}
      {err ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</div> : null}
      {issues && !err && shown.length === 0 ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{issues.length ? 'No issue matches.' : 'No open issues.'}</div> : null}
      {shown.map((i) => {
        const running = mine(i.number);
        return (
          <div key={i.number} className="helm-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, padding: '6px 4px', borderTop: '1px solid var(--border-subtle)' }}>
            <i className="ph ph-circle-dashed" style={{ fontSize: 15, color: 'var(--status-ready)' }} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ font: '500 13px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }} onClick={() => void api.openExternal(i.url)}>{i.title}</span>
              <span style={{ display: 'flex', gap: 6, alignItems: 'center', font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>
                #{i.number} · {i.author} · {relTime(Date.parse(i.updated))}{i.comments ? ` · ${i.comments} comments` : ''}
                {i.labels.slice(0, 4).map((l) => <Badge key={l}>{l}</Badge>)}
              </span>
            </div>
            {running.length ? <Badge tone="working" dot>{running.length} {running.length === 1 ? 'session' : 'sessions'}</Badge> : null}
            <Button size="sm" variant="secondary" icon="play" loading={busy === i.number} onClick={() => void start(i)}>Start session</Button>
          </div>
        );
      })}
    </div>
  );
}
