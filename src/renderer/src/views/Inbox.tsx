import React from 'react';
import { inbox, keyAction, type InboxItem, type InboxKind } from '@shared/inbox';
import { sessionTitle } from '@shared/types';
import { api } from '../api';
import { ago } from '../lib';
import { go, toast, useApp, useMoney } from '../store';
import { Badge, Button, Kbd, Meter, StatusDot } from '../ui';
import { PlanMeters } from './Shell';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const KIND: Record<InboxKind, { label: string; icon: string; tone: string }> = {
  approve: { label: 'Approval', icon: 'shield-warning', tone: 'attention' },
  question: { label: 'Question', icon: 'question', tone: 'attention' },
  budget: { label: 'Limit reached', icon: 'gauge', tone: 'attention' },
  error: { label: 'Failed', icon: 'x-circle', tone: 'error' },
  stuck: { label: 'Looks stuck', icon: 'warning', tone: 'attention' },
  ready: { label: 'Ready for review', icon: 'git-diff', tone: 'ready' },
  queued: { label: 'Queued', icon: 'hourglass', tone: 'idle' }
};

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}><Kbd keys={k} />{children}</span>;
}

export function Inbox() {
  const app = useApp();
  const { fmt, sym, from } = useMoney();
  const items = React.useMemo(() => inbox(app.sessions), [app.sessions]);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');
  const idx = Math.max(0, items.findIndex((i) => i.session.id === selId));
  const cur: InboxItem | undefined = items[idx];
  const noteRef = React.useRef<HTMLInputElement>(null);
  // Keep the selection on the same session when the list changes; when it is gone, the next one slides into its place.
  const lastIdx = React.useRef(0);
  React.useEffect(() => { if (cur && cur.session.id !== selId) setSelId(cur.session.id); lastIdx.current = idx; }, [cur?.session.id]);
  React.useEffect(() => { setNote(''); }, [cur?.session.id]);

  const act = React.useCallback(async (item: InboxItem, a: NonNullable<ReturnType<typeof keyAction>>, text?: string) => {
    const s = item.session;
    try {
      switch (a.do) {
        case 'approve': await api.resolveAsk(s.id, s.ask!.id, { decision: 'approve' }); break;
        case 'always': await api.resolveAsk(s.id, s.ask!.id, { decision: 'always' }); break;
        case 'deny': await api.resolveAsk(s.id, s.ask!.id, { decision: 'deny', text }); break;
        case 'answer': { const q = s.ask!.questions![0]; await api.resolveAsk(s.id, s.ask!.id, { answers: { [q.question]: q.options[a.option].label } }); break; }
        case 'continue': await api.resolveAsk(s.id, s.ask!.id, { addBudget: s.ask!.scope === 'plan' ? 0 : from(5) }); break;
        case 'resume': await api.resumeSession(s.id); break;
        case 'start': await api.startQueued(s.id); break;
        case 'open': go({ screen: 'session', id: s.id, tab: item.kind === 'ready' ? 'changes' : 'conversation' }); break;
      }
    } catch (e) { toast({ tone: 'error', title: 'That did not work', description: errText(e) }); }
  }, [from]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); const n = items[Math.min(items.length - 1, idx + 1)]; if (n) setSelId(n.session.id); return; }
      if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); const n = items[Math.max(0, idx - 1)]; if (n) setSelId(n.session.id); return; }
      if (e.key === 'n' && cur?.kind === 'approve') { e.preventDefault(); noteRef.current?.focus(); return; }
      if (!cur) return;
      const a = keyAction(cur, e.key);
      if (a) { e.preventDefault(); void act(cur, a); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, idx, cur, act]);

  const blocked = items.filter((i) => i.kind === 'approve' || i.kind === 'question' || i.kind === 'budget').length;
  const s = cur?.session;
  const a = s?.ask;
  const q = a?.questions?.[0];
  return (
    <div className="helm-split" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div className="helm-list" style={{ width: 340, flex: 'none', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)' }}>
        <div style={{ padding: '16px 16px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, font: '600 18px/1.2 var(--font-sans)', letterSpacing: 'var(--tracking-tight)' }}>Inbox</h1>
          <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{items.length === 0 ? 'Nothing is waiting on you.' : `${blocked} ${blocked === 1 ? 'agent is' : 'agents are'} blocked on you · ${items.length} in all`}</span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 6px 8px' }}>
          {items.map((it) => {
            const on = it.session.id === s?.id;
            const k = KIND[it.kind];
            return (
              <div key={it.session.id} onClick={() => setSelId(it.session.id)} className="helm-row-hover" style={{ display: 'flex', gap: 10, padding: '9px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: on ? 'var(--bg-selected)' : undefined, boxShadow: on ? 'inset 2px 0 0 var(--accent)' : undefined }}>
                <i className={'ph ph-' + k.icon} style={{ fontSize: 15, marginTop: 1, color: `var(--status-${k.tone === 'idle' ? 'idle' : k.tone}-text)` }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ font: '500 12.5px/1.25 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sessionTitle(it.session)}</span>
                  <span style={{ font: '400 11.5px/1.3 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label} · {it.session.free ? 'free agent' : it.session.repoId.split('/')[1]} · {ago(it.since)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
          <Hint k="j / k">move</Hint><Hint k="a">approve</Hint><Hint k="A">always</Hint><Hint k="d">deny</Hint><Hint k="1-9">answer</Hint><Hint k="↵">open</Hint>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        {!cur || !s ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <i className="ph ph-check-circle" style={{ fontSize: 30, color: 'var(--status-ready)' }} />
              <span style={{ font: '500 14px/1.3 var(--font-sans)' }}>Inbox zero</span>
              <span style={{ font: '400 12.5px/1.45 var(--font-sans)', color: 'var(--text-3)', maxWidth: 320 }}>Approvals, questions, failures and finished work show up here, oldest first, so you can clear them from the keyboard.</span>
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: 760, padding: '22px 28px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot status={s.status} />
              <span style={{ font: '600 16px/1.2 var(--font-sans)', flex: 1, minWidth: 0 }}>{sessionTitle(s)}</span>
              <Badge tone={KIND[cur.kind].tone as any} icon={KIND[cur.kind].icon}>{KIND[cur.kind].label}</Badge>
            </div>
            <span style={{ font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>{s.free ? 'Free agent' : s.repoId} · {s.free ? s.worktree : s.branch} · waiting {ago(cur.since)}</span>

            {cur.kind === 'approve' && a ? <>
              <div style={{ font: '600 14px/1.4 var(--font-sans)' }}>{a.head}</div>
              {a.command ? <pre className="selectable" style={{ margin: 0, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border)', font: '400 12.5px/1.55 var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{a.command}</pre> : null}
              {a.note ? <div style={{ font: '400 12.5px/1.55 var(--font-sans)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{a.note}</div> : null}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Button variant="primary" kbd="a" onClick={() => void act(cur, { do: 'approve' })}>Approve once</Button>
                {a.pattern ? <Button kbd="⇧A" onClick={() => void act(cur, { do: 'always' })}>Always allow <code style={{ font: 'var(--type-data)', marginLeft: 4 }}>{a.pattern}</code></Button> : null}
                <Button variant="ghost" kbd="d" onClick={() => void act(cur, { do: 'deny' })}>Deny</Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Deny and tell the agent what to do instead (press n)"
                  onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) { void act(cur, { do: 'deny' }, note.trim()); setNote(''); } if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
                  style={{ flex: 1, height: 30, border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12.5px/1 var(--font-sans)', padding: '0 10px' }} />
              </div>
            </> : null}

            {cur.kind === 'question' && a ? <>
              {a.questions?.map((qq, qi) => (
                <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {qq.header ? <span style={{ font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{qq.header}</span> : null}
                  <div style={{ font: '600 14px/1.4 var(--font-sans)' }}>{qq.question}</div>
                  {qq.options.map((o, oi) => (
                    <button key={o.label} type="button" disabled={(a.questions?.length ?? 0) !== 1} onClick={() => void act(cur, { do: 'answer', option: oi })} className="helm-row-hover"
                      style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderRadius: 'var(--radius-md)', border: 'none', cursor: (a.questions?.length ?? 0) === 1 ? 'pointer' : 'default', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)' }}>
                      <Kbd keys={String(oi + 1)} />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ font: '500 13px/1.3 var(--font-sans)' }}>{o.label}</span>{o.description ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{o.description}</span> : null}</span>
                    </button>
                  ))}
                </div>
              ))}
              {(a.questions?.length ?? 0) > 1 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>There are several questions: open the session to answer them together.</span> : null}
              {q && (a.questions?.length ?? 0) === 1 ? null : null}
            </> : null}

            {cur.kind === 'budget' && a ? <>
              <div style={{ font: '600 14px/1.4 var(--font-sans)' }}>{a.head}</div>
              {a.scope === 'plan' ? <PlanMeters /> : <Meter value={s.cost} max={s.budget} label="Session budget" detail={fmt(s.cost) + ' / ' + fmt(s.budget)} />}
              {a.note ? <div style={{ font: '400 12.5px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>{a.note}</div> : null}
              <div><Button variant="primary" kbd="a" onClick={() => void act(cur, { do: 'continue' })}>{a.scope === 'plan' ? 'Continue anyway' : `Add ${sym}5 and resume`}</Button></div>
            </> : null}

            {cur.kind === 'error' ? <>
              <div style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--status-error-text)', whiteSpace: 'pre-wrap' }}>{s.error || s.step}</div>
              <div style={{ display: 'flex', gap: 8 }}><Button variant="primary" icon="play" kbd="r" onClick={() => void act(cur, { do: 'resume' })}>Resume</Button></div>
            </> : null}

            {cur.kind === 'stuck' ? <div style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>{s.stuck}. It may be going round in circles: pause it and tell it what to try instead.
              <div style={{ marginTop: 8 }}><Button icon="pause" onClick={() => void api.interrupt(s.id)}>Pause</Button></div></div> : null}

            {cur.kind === 'ready' ? <div style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>{s.step}. {s.add + s.del ? `+${s.add} −${s.del} across ${s.files} files.` : ''}{s.review?.state === 'done' ? ` Reviewed: ${s.review.findings.filter((f) => f.severity === 'blocker').length} blockers.` : ''}</div> : null}

            {cur.kind === 'queued' ? <>
              <div style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>{s.step}</div>
              <div style={{ display: 'flex', gap: 8 }}><Button variant="primary" icon="play" kbd="s" onClick={() => void act(cur, { do: 'start' })}>Start now</Button><Button variant="ghost" onClick={() => void api.cancelQueued(s.id)}>Take out of the queue</Button></div>
            </> : null}

            <div style={{ marginTop: 6 }}><Button variant="secondary" icon="arrow-square-out" kbd="↵" onClick={() => void act(cur, { do: 'open' })}>Open session</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}
