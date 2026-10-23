import React from 'react';
import type { Session as S, TranscriptEvent, ModelAlias, PermMode, Effort, MessageImage } from '@shared/types';
import { api, platform } from '../api';
import { Cmd, Hl } from '../Hl';
import { highlightBlock, langFromPath, langFromTag } from '../highlight';
import { clock, elapsed, fmtTokens, prettyModel, runningSubagents, STATUS_LABEL, subagentTree, tilde } from '../lib';
import { go, loadTranscript, setUI, toast, useApp, useMoney, useTranscript } from '../store';
import { Avatar, Badge, BranchTag, Button, DiffStat, Grip, IconButton, Meter, Select, StatusDot, Tabs, usePaneWidth } from '../ui';
import { Changes } from './Changes';
import { TranscriptList } from './TranscriptList';
import { CodeView } from './CodeView';

const guard = (p: Promise<any>) => p.catch((e: any) => toast({ tone: 'error', title: 'That did not work', description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') }));
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (platform() === 'darwin' ? e.metaKey : e.ctrlKey);
const MOD = () => (platform() === 'darwin' ? '⌘' : 'Ctrl+');

const label: React.CSSProperties = { font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
const box: React.CSSProperties = { borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' };

function SessionHeader({ s, tab, setTab }: { s: S; tab: string; setTab(t: string): void }) {
  const { fmt } = useMoney();
  const sub = useApp().settings.billing === 'subscription';
  const running = s.status === 'working' || s.status === 'attention';
  const deliverMerge = useApp().settings.deliver === 'merge';
  return (
    <div style={{ flex: 'none', padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Avatar agent name={s.id} size={26} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ font: '600 16px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.task} onDoubleClick={() => setUI({ renaming: s.id })}>{s.customTitle || s.title || s.task}</span>
            <Badge tone={s.status} dot>{STATUS_LABEL[s.status]}</Badge>
            {s.archivedAt ? <Badge>Archived</Badge> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <BranchTag worktree base={s.base.replace(/^origin\//, '')} name={s.branch} />
            <span>{prettyModel(s)}</span><span>·</span><span>started {clock(s.startedAt)}</span><span>·</span><span>{fmtTokens(s.tokens.input + s.tokens.output + s.tokens.cacheRead)} tokens</span>{sub ? null : <><span>·</span><span>{fmt(s.cost)}</span></>}
          </div>
        </div>
        {s.status === 'idle' && /^Stopped/.test(s.step) ? <Button variant="secondary" icon="play" onClick={() => guard(api.resumeSession(s.id))}>Resume</Button> : null}
        {s.status === 'working' ? <Button variant="ghost" icon="pause" onClick={() => guard(api.interrupt(s.id))}>Pause</Button> : null}
        {running ? <Button variant="ghost" icon="stop" onClick={() => guard(api.stopSession(s.id))}>Stop</Button> : null}
        <Button variant="secondary" icon="arrow-square-out" onClick={() => guard(api.openInEditor(s.id))}>Open in editor</Button>
        {s.mergedAt ? <Badge tone="ready">Merged into {s.mergedInto}</Badge> : s.prUrl ? <><Button variant="ghost" icon="git-pull-request" onClick={() => api.openExternal(s.prUrl!)}>View pull request</Button>{prNumber(s.prUrl) ? <Button variant="primary" icon="git-merge" onClick={() => setUI({ mergingPr: { repoId: s.repoId, number: prNumber(s.prUrl)!, sessionId: s.id } })}>Merge pull request</Button> : null}</>
          : s.status === 'ready' ? <Button variant="primary" icon={deliverMerge ? 'git-merge' : 'git-pull-request'} onClick={() => setTab('changes')}>{deliverMerge ? 'Merge changes' : 'Create pull request'}</Button>
          : <Button variant="secondary" icon="git-diff" onClick={() => setTab('changes')}>Review changes</Button>}
      </div>
      <Tabs value={tab} onChange={setTab} style={{ borderBottom: 'none', padding: 0 }} tabs={[
        { value: 'conversation', label: 'Conversation', icon: 'chats-circle' },
        { value: 'code', label: 'Code', icon: 'code' },
        { value: 'changes', label: 'Changes', icon: 'git-diff', count: s.files }
      ]} />
    </div>
  );
}

const subTone = (st: string) => (st === 'working' ? 'working' : st === 'failed' ? 'error' : 'idle');
const subLabel = (st: string) => (st === 'working' ? 'Running' : st === 'failed' ? 'Failed' : st === 'stopped' ? 'Stopped' : 'Done');

function SubagentTree({ s, selected }: { s: S; selected?: string }) {
  const rows = subagentTree(s);
  if (!rows.length) return <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No subagents in this session.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map(({ a, depth }) => (
        <div key={a.id} onClick={() => go({ screen: 'session', id: s.id, tab: 'conversation', sub: a.id })} className="helm-row-hover"
          style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 28, padding: '0 6px 0 ' + (6 + depth * 14) + 'px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: selected === a.id ? 'var(--bg-selected)' : undefined }}>
          <StatusDot status={subTone(a.status)} size={7} />
          <span style={{ flex: 1, minWidth: 0, font: '400 12px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.description}>{a.description}</span>
          <span style={{ font: '400 10.5px/1 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{a.tools} tools · {a.status === 'working' ? elapsed(a.startedAt) : elapsed(a.startedAt, a.endedAt)}</span>
        </div>
      ))}
    </div>
  );
}

function ToolRow({ tool, target, meta }: { tool: string; target: string; meta: string }) {
  const icon = ({ Read: 'file-text', Grep: 'magnifying-glass', Glob: 'folders', Bash: 'terminal', Edit: 'pencil-simple', Write: 'file-plus', WebFetch: 'globe', WebSearch: 'globe' } as any)[tool] || 'wrench';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '16px 56px minmax(0,1fr) auto', gap: 8, alignItems: 'center', height: 26, padding: '0 10px' }}>
      <i className={'ph ph-' + icon} style={{ fontSize: 13, color: 'var(--text-3)' }} />
      <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tool}</span>
      <span style={{ font: '400 12px/1 var(--font-mono)', color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{target}</span>
      <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{meta}</span>
    </div>
  );
}

/** Paragraphs, bullet and numbered lists, and `inline code`. Enough for agent prose. */
function Rich({ text }: { text: string }) {
  const inline = (t: string) => t.split(/(`[^`]+`)/g).map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 2 ? <code key={i} style={{ font: 'var(--type-data)', padding: '1px 4px', borderRadius: 3, background: 'var(--bg-active)' }}>{p.slice(1, -1)}</code> : <React.Fragment key={i}>{p.replace(/\*\*([^*]+)\*\*/g, '$1')}</React.Fragment>));
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let fence: string[] | null = null;
  let fenceTag = '';
  const codeBlock = (lines: string[], tag: string, key: number) => {
    const hb = highlightBlock(lines.join('\n'), langFromTag(tag));
    const st: React.CSSProperties = { margin: 0, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', font: 'var(--type-data)', overflow: 'auto' };
    return hb ? <pre key={key} className="selectable" style={st} dangerouslySetInnerHTML={{ __html: hb.html }} /> : <pre key={key} className="selectable" style={st}>{lines.join('\n')}</pre>;
  };
  const flushPara = () => { if (para.length) { blocks.push(<div key={blocks.length}>{inline(para.join(' '))}</div>); para = []; } };
  const flushList = () => { if (list) { const L = list; blocks.push(React.createElement(L.ordered ? 'ol' : 'ul', { key: blocks.length, style: { margin: 0, paddingLeft: 20, color: 'var(--text-2)' } }, L.items.map((x, i) => <li key={i}>{inline(x)}</li>))); list = null; } };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (fence) { blocks.push(codeBlock(fence, fenceTag, blocks.length)); fence = null; }
      else { flushPara(); flushList(); fence = []; fenceTag = line.trim().slice(3); }
      continue;
    }
    if (fence) { fence.push(line); continue; }
    const m = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (m) { flushPara(); const ordered = !!m[2]; if (list && list.ordered !== ordered) flushList(); list = list || { ordered, items: [] }; list.items.push(m[3]); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim().replace(/^#+\s*/, '')); }
  }
  if (fence) blocks.push(codeBlock(fence, fenceTag, blocks.length));
  flushPara(); flushList();
  return <>{blocks}</>;
}

function TranscriptItemView({ m, s, onDeny }: { m: TranscriptEvent; s: S; onDeny(): void }) {
  const app = useApp();
  if (m.k === 'subagent') return (
    <div style={{ marginLeft: 32, ...box }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 34, padding: '4px 10px' }}>
        <i className="ph ph-tree-structure" style={{ fontSize: 14, color: 'var(--accent-text)' }} />
        <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>Subagent</span>
        <Badge mono>{m.agentType}</Badge>
        <span style={{ font: '500 12.5px/1.2 var(--font-sans)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.description}</span>
        {m.status === 'working' ? <i className="ph ph-circle-notch" style={{ fontSize: 13, color: 'var(--status-working-text)', animation: 'helm-spin .9s linear infinite' }} /> : null}
        <Badge tone={subTone(m.status) as any} dot>{subLabel(m.status)}</Badge>
        <Button size="sm" variant="ghost" iconRight="arrow-right" onClick={() => go({ screen: 'session', id: s.id, tab: 'conversation', sub: m.id })}>Transcript</Button>
      </div>
      {m.summary && m.status !== 'working' ? <div className="selectable" style={{ padding: '8px 12px 10px', borderTop: '1px solid var(--border-subtle)', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{m.summary}</div> : null}
    </div>
  );
  if (m.k === 'user') return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar agent={!!m.from} name={m.from || app.user?.login || 'you'} src={m.from ? undefined : app.user?.avatar || undefined} size={22} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: m.from ? '500 12px/1 var(--font-mono)' : '500 12px/1 var(--font-sans)' }}>{m.from ? m.from + ' → subagent' : app.user?.login || 'you'} {m.t ? <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', marginLeft: 6 }}>{clock(m.t)}</span> : null}</span>
        <div className="selectable" style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
        {m.images?.length ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{m.images.map((im, i) => <img key={i} src={`data:${im.mediaType};base64,${im.data}`} alt={im.name || 'attached image'} title={im.name} style={{ maxWidth: 260, maxHeight: 180, borderRadius: 'var(--radius-md)', boxShadow: 'inset 0 0 0 1px var(--border)', objectFit: 'contain', background: 'var(--bg-editor)' }} />)}</div> : null}
      </div>
    </div>
  );
  if (m.k === 'agent') return (
    <div className="selectable" style={{ paddingLeft: 32, font: '400 13px/1.6 var(--font-sans)', color: 'var(--text-1)', display: 'flex', flexDirection: 'column', gap: 6, wordBreak: 'break-word' }}><Rich text={m.text} /></div>
  );
  if (m.k === 'tools') return <div style={{ marginLeft: 32, ...box, padding: '3px 0' }}>{m.items.map((t, i) => <ToolRow key={i} tool={t[0]} target={t[1]} meta={t[2]} />)}</div>;
  if (m.k === 'edit') return (
    <div style={{ marginLeft: 32, ...box }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <i className="ph ph-pencil-simple" style={{ fontSize: 13, color: 'var(--text-3)' }} />
        <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>Edit</span>
        <span style={{ font: '400 12px/1 var(--font-mono)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.file}</span>
        <DiffStat additions={m.add} deletions={m.del} />
      </div>
      <pre className="selectable" style={{ margin: 0, padding: '4px 0', background: 'var(--bg-editor)', font: '400 12px/1.65 var(--font-mono)', overflow: 'auto' }}>
        {m.lines.map(([t, l], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', background: t === '+' ? 'var(--diff-add-bg)' : t === '-' ? 'var(--diff-del-bg)' : 'transparent', color: t === ' ' ? 'var(--text-2)' : 'var(--text-1)' }}>
            <span style={{ textAlign: 'center', color: t === '+' ? 'var(--diff-add-fg)' : t === '-' ? 'var(--diff-del-fg)' : 'var(--text-3)' }}>{t === '-' ? '−' : t}</span><Hl text={l} lang={langFromPath(m.file)} pad="  " />
          </div>
        ))}
      </pre>
    </div>
  );
  if (m.k === 'bash') return (
    <div style={{ marginLeft: 32, ...box }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', background: 'var(--bg-editor)' }}>
        <i className="ph ph-terminal" style={{ fontSize: 13, color: 'var(--text-3)' }} />
        <span className="selectable" style={{ font: '400 12px/1 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: 'var(--text-3)' }}>$ </span><Hl text={m.cmd} lang="bash" /></span>
        {m.done ? <span style={{ font: '400 12px/1 var(--font-mono)', color: m.ok ? 'var(--diff-add-fg)' : 'var(--diff-del-fg)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.ok && m.out === '✓' ? '✓ done' : m.out}</span>
          : <i className="ph ph-circle-notch" style={{ fontSize: 13, color: 'var(--status-working-text)', animation: 'helm-spin .9s linear infinite' }} />}
        <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{m.meta}</span>
      </div>
    </div>
  );
  if (m.k === 'commit') return (
    <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>
      <i className="ph ph-git-commit" style={{ fontSize: 15, color: 'var(--text-1)' }} />
      Committed <BranchTag kind="commit" name={m.hash} /> <span style={{ color: 'var(--text-1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.msg}</span>
      <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', marginLeft: 'auto' }}>{clock(m.t)}</span>
    </div>
  );
  if (m.k === 'note') return (
    <div style={{ marginLeft: 32, display: 'flex', alignItems: 'flex-start', gap: 8, font: '400 12px/1.45 var(--font-sans)', color: m.tone === 'error' ? 'var(--status-error-text)' : m.tone === 'attention' ? 'var(--status-attention-text)' : 'var(--text-3)' }}>
      <i className={'ph-fill ph-' + (m.tone === 'error' ? 'warning-circle' : 'info')} style={{ fontSize: 14, marginTop: 1 }} /><span className="selectable">{m.text}</span>
    </div>
  );
  const live = !!s && s.ask?.id === (m as any).askId;
  const restarted = live && !!s?.ask?.orphaned;
  const expired = (what: string) => (
    <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-3)', minWidth: 0 }}>
      <i className="ph ph-clock-countdown" style={{ fontSize: 14 }} />No longer waiting: {what}
    </div>
  );
  if (m.k === 'permission') {
    if (!m.resolved && !live) return expired(m.cmd.length > 70 ? m.cmd.slice(0, 70) + '…' : m.cmd);
    if (m.resolved) return (
      <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-3)', minWidth: 0 }}>
        <i className={'ph-fill ph-' + (m.resolved === 'denied' ? 'x-circle' : 'check-circle')} style={{ fontSize: 14, color: m.resolved === 'denied' ? 'var(--status-error)' : 'var(--status-ready)' }} />
        {m.resolved === 'denied' ? 'Denied' : m.resolved === 'always' ? 'Always allowed' : 'Approved'}
        <code style={{ font: 'var(--type-data)', color: 'var(--text-2)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.cmd}</code>
      </div>
    );
    const isCmd = m.tool === 'Bash' || m.tool === 'PowerShell';
    return (
      <div style={{ marginLeft: 32, borderRadius: 'var(--radius-md)', background: 'var(--status-attention-bg)', boxShadow: 'inset 0 0 0 1px var(--status-attention)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 13px/1 var(--font-sans)', color: 'var(--status-attention-text)' }}><i className="ph-fill ph-shield-warning" style={{ fontSize: 15 }} />{isCmd ? 'Permission needed to run a command' : m.tool === 'ExitPlanMode' ? 'Plan ready for approval' : 'Permission needed'}</div>
        <code className="selectable" style={{ font: 'var(--type-code)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{isCmd ? <><span style={{ color: 'var(--text-3)' }}>$ </span><Cmd text={m.cmd} /></> : m.cmd}</code>
        <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>{m.why}</div>
        {restarted ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>helm was restarted while this waited. Approving starts the session again and has the agent run it.</div> : null}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="primary" kbd={MOD() + '↵'} onClick={() => guard(api.resolveAsk(s.id, m.askId, { decision: 'approve' }))}>Approve once</Button>
          {m.pattern ? <Button size="sm" onClick={() => guard(api.resolveAsk(s.id, m.askId, { decision: 'always' }))}>Always allow <span style={{ font: '400 11px var(--font-mono)', color: 'var(--text-3)' }}>{m.pattern}</span></Button> : null}
          <Button size="sm" variant="ghost" onClick={() => { void guard(api.resolveAsk(s.id, m.askId, { decision: 'deny' })); onDeny(); }}>Deny and explain</Button>
        </div>
      </div>
    );
  }
  if (m.k === 'question') {
    const q = m.questions[0];
    if (!m.answered && !live) return expired(q?.question || 'question');
    return (
      <div style={{ marginLeft: 32, borderRadius: 'var(--radius-md)', background: 'var(--status-attention-bg)', boxShadow: 'inset 0 0 0 1px var(--status-attention)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 13px/1 var(--font-sans)', color: 'var(--status-attention-text)' }}><i className="ph-fill ph-question" style={{ fontSize: 15 }} />{q?.header || 'Question from the agent'}</div>
        <div className="selectable" style={{ font: '500 13px/1.45 var(--font-sans)' }}>{q?.question}</div>
        {m.answered ? <div style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-2)' }}>Answered: <b style={{ fontWeight: 500, color: 'var(--text-1)' }}>{m.answered}</b></div> : <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(q?.options || []).map((o) => (
              <button key={o.label} type="button" onClick={() => guard(api.resolveAsk(s.id, m.askId, { answers: { [q.question]: o.label } }))}
                style={{ textAlign: 'left', padding: '7px 10px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ font: '500 13px/1.2 var(--font-sans)' }}>{o.label}</span>
                {o.description ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{o.description}</span> : null}
              </button>
            ))}
          </div>
          <div style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>Or type your own answer below.</div>
        </>}
      </div>
    );
  }
  return null;
}

/** Re-renders only when its event changes, or the pending request it may be showing does. */
export const TranscriptItem = React.memo(TranscriptItemView, (a, b) => a.m === b.m && a.s?.ask?.id === b.s?.ask?.id && a.s?.ask?.orphaned === b.s?.ask?.orphaned);

const prNumber = (url?: string) => { const m = /\/pull\/(\d+)/.exec(url || ''); return m ? +m[1] : null; };
const gone: React.CSSProperties = { font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)', textAlign: 'center', display: 'grid', placeItems: 'center' };

// Drafts and sent messages are kept per session for as long as helm is open, so switching away never loses what you were typing
// and the up arrow can bring back the last thing you said.
const drafts = new Map<string, string>();
const sent = new Map<string, string[]>();
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
type Draft = MessageImage & { id: number; url: string; bytes: number };
let imageSeq = 0;

const readImage = (f: File): Promise<Draft> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error('Could not read ' + (f.name || 'the image')));
  r.onload = () => {
    const url = String(r.result);
    resolve({ id: ++imageSeq, mediaType: f.type as any, data: url.slice(url.indexOf(',') + 1), name: f.name && f.name !== 'image.png' ? f.name : `image-${imageSeq}.${f.type.split('/')[1]}`, url, bytes: f.size });
  };
  r.readAsDataURL(f);
});

const EFFORTS: { value: string; label: string }[] = [
  { value: 'default', label: 'Default effort' }, { value: 'low', label: 'Effort: Low' }, { value: 'medium', label: 'Effort: Medium' },
  { value: 'high', label: 'Effort: High' }, { value: 'xhigh', label: 'Effort: Extra high' }, { value: 'max', label: 'Effort: Max' }
];

/** Files whose path contains the letters you typed, in order, best matches first. */
function matchFiles(files: string[], q: string): string[] {
  const needle = q.toLowerCase();
  if (!needle) return files.slice(0, 8);
  const scored: [number, string][] = [];
  for (const f of files) {
    const l = f.toLowerCase();
    const base = l.slice(l.lastIndexOf('/') + 1);
    let score = -1;
    if (base.startsWith(needle)) score = 0;
    else if (base.includes(needle)) score = 1;
    else if (l.includes(needle)) score = 2;
    else {
      let i = 0;
      for (const ch of l) if (ch === needle[i]) i++;
      if (i === needle.length) score = 3;
    }
    if (score >= 0) scored.push([score * 1000 + f.length, f]);
  }
  return scored.sort((x, y) => x[0] - y[0]).slice(0, 8).map((x) => x[1]);
}

function Composer({ s, inputRef }: { s: S; inputRef: React.RefObject<HTMLTextAreaElement> }) {
  const [text, setTextState] = React.useState(drafts.get(s.id) || '');
  const [images, setImages] = React.useState<Draft[]>([]);
  const [focused, setFocused] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [mention, setMention] = React.useState<{ at: number; q: string } | null>(null);
  const [hi, setHi] = React.useState(0);
  const files = React.useRef<string[] | null>(null);
  const histPos = React.useRef(-1);
  const picker = React.useRef<HTMLInputElement>(null);
  const working = s.status === 'working';
  const setText = (t: string) => { drafts.set(s.id, t); setTextState(t); };

  React.useEffect(() => { setTextState(drafts.get(s.id) || ''); setImages([]); setMention(null); histPos.current = -1; files.current = null; }, [s.id]);
  // Grow with the text, up to about nine lines, then scroll.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t && !images.length) return;
    sent.set(s.id, [...(sent.get(s.id) || []), t].slice(-50));
    histPos.current = -1;
    const pics = images.map(({ mediaType, data, name }) => ({ mediaType, data, name }));
    setText(''); setImages([]); setMention(null);
    void guard(api.sendMessage(s.id, t, pics.length ? pics : undefined));
  };

  const addImages = async (list: File[]) => {
    const ok = list.filter((f) => IMAGE_TYPES.includes(f.type));
    if (list.length && !ok.length) { toast({ tone: 'neutral', title: 'Only PNG, JPEG, GIF and WebP images can be attached' }); return; }
    const room = MAX_IMAGES - images.length;
    if (ok.length > room) toast({ tone: 'neutral', title: `At most ${MAX_IMAGES} images per message` });
    const big = ok.filter((f) => f.size > MAX_IMAGE_BYTES);
    if (big.length) toast({ tone: 'neutral', title: 'Image too large', description: `${big[0].name || 'It'} is over 5 MB.` });
    const take = ok.filter((f) => f.size <= MAX_IMAGE_BYTES).slice(0, Math.max(0, room));
    try { const drafts2 = await Promise.all(take.map(readImage)); setImages((cur) => [...cur, ...drafts2]); } catch (e: any) { toast({ tone: 'error', title: 'Could not attach', description: String(e?.message || e) }); }
  };

  // The @word under the caret, if any: it opens the file list.
  const track = (value: string, caret: number) => {
    const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!m) { setMention(null); return; }
    setMention({ at: caret - m[2].length - 1, q: m[2] });
    setHi(0);
    if (!files.current) { files.current = []; api.listFiles(s.id).then((l) => { files.current = l; setMention((x) => (x ? { ...x } : x)); }).catch(() => { files.current = null; }); }
  };
  const matches = mention ? matchFiles(files.current || [], mention.q) : [];
  const pick = (path: string) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el ? el.selectionStart : text.length;
    const next = text.slice(0, mention.at) + '@' + path + ' ' + text.slice(caret);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => { el?.focus(); const p = mention.at + path.length + 2; el?.setSelectionRange(p, p); });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[hi]); return; }
    }
    if (mention && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setMention(null); return; }
    if (e.key === 'Enter' && mod(e)) { e.preventDefault(); send(); return; }
    // Up and down walk through what you sent before, when the caret is at the very start or end of the text.
    const past = sent.get(s.id) || [];
    const el = e.currentTarget;
    if (e.key === 'ArrowUp' && past.length && el.selectionStart === 0 && el.selectionEnd === 0 && (text === '' || histPos.current >= 0)) {
      e.preventDefault();
      histPos.current = Math.min(histPos.current + 1, past.length - 1);
      setText(past[past.length - 1 - histPos.current]);
    } else if (e.key === 'ArrowDown' && histPos.current >= 0 && el.selectionStart === text.length) {
      e.preventDefault();
      histPos.current -= 1;
      setText(histPos.current < 0 ? '' : past[past.length - 1 - histPos.current]);
    }
  };

  const placeholder = s.ask?.type === 'question' ? 'Type your answer' : s.ask ? 'Tell the agent what to do instead, or approve above' : working ? 'Add guidance while it works, or press Esc to interrupt' : 'Reply to ' + (s.customTitle || s.title || s.id) + '. @ mentions a file, and you can paste or drop images';
  const ctxPct = Math.round((s.ctx / 200000) * 100);
  return (
    <div style={{ flex: 'none', padding: '0 20px 16px' }}>
      <div
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void addImages([...e.dataTransfer.files]); } setOver(false); }}
        style={{ position: 'relative', maxWidth: 820, margin: '0 auto', borderRadius: 'var(--radius-lg)', background: 'var(--bg-input)', transition: 'box-shadow .12s',
          boxShadow: over ? 'var(--ring-focus), inset 0 0 0 1px var(--accent)' : focused ? 'var(--ring-focus), inset 0 0 0 1px var(--accent)' : 'inset 0 0 0 1px var(--border-strong)' }}>
        {mention && matches.length ? (
          <div role="listbox" style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', boxShadow: 'var(--shadow-popover, 0 8px 24px rgba(0,0,0,.4)), inset 0 0 0 1px var(--border-strong)', padding: 4, zIndex: 20, maxHeight: 260, overflow: 'auto' }}>
            {matches.map((f, i) => {
              const cut = f.lastIndexOf('/');
              return (
                <div key={f} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); pick(f); }} onMouseEnter={() => setHi(i)}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: i === hi ? 'var(--bg-selected, var(--bg-hover))' : undefined, minWidth: 0 }}>
                  <i className="ph ph-file" style={{ fontSize: 13, color: 'var(--text-3)', alignSelf: 'center' }} />
                  <span style={{ font: '500 12.5px/1.2 var(--font-mono)', color: 'var(--text-1)', whiteSpace: 'nowrap' }}>{f.slice(cut + 1)}</span>
                  {cut >= 0 ? <span style={{ font: '400 11.5px/1.2 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left', minWidth: 0 }}>{f.slice(0, cut)}</span> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {images.length ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 8px 0' }}>
            {images.map((im) => (
              <div key={im.id} title={im.name} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 22px 0 4px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
                <img src={im.url} alt="" style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 3 }} />
                <span style={{ font: '500 11.5px/1 var(--font-sans)', color: 'var(--text-1)', maxWidth: 150, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{im.name}</span>
                <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{im.bytes > 1e6 ? (im.bytes / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(im.bytes / 1e3)) + ' kB'}</span>
                <span role="button" aria-label="Remove image" onClick={() => setImages((c) => c.filter((x) => x.id !== im.id))} style={{ position: 'absolute', right: 5, top: 0, bottom: 0, display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'var(--text-3)' }}><i className="ph ph-x" style={{ fontSize: 11 }} /></span>
              </div>
            ))}
          </div>
        ) : null}
        <textarea ref={inputRef} value={text} placeholder={placeholder} rows={2}
          onChange={(e) => { setText(e.target.value); histPos.current = -1; track(e.target.value, e.target.selectionStart); }}
          onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') track(e.currentTarget.value, e.currentTarget.selectionStart); }}
          onClick={(e) => track(e.currentTarget.value, e.currentTarget.selectionStart)}
          onPaste={(e) => { const f = [...e.clipboardData.files].filter((x) => x.type.startsWith('image/')); if (f.length) { e.preventDefault(); void addImages(f); } }}
          onKeyDown={onKeyDown}
          style={{ display: 'block', width: '100%', boxSizing: 'border-box', resize: 'none', border: 'none', outline: 'none', boxShadow: 'none', background: 'transparent', color: 'var(--text-1)', font: '400 13px/1.5 var(--font-sans)', padding: '10px 12px 4px', maxHeight: 200 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 6px 8px' }}>
          <input ref={picker} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={(e) => { void addImages([...(e.target.files || [])]); e.target.value = ''; }} />
          <IconButton icon="at" label="Mention a file" size="sm" onClick={() => { const el = inputRef.current; const c = el ? el.selectionStart : text.length; const pre = text.slice(0, c); const lead = pre && !/\s$/.test(pre) ? ' ' : ''; setText(pre + lead + '@' + text.slice(c)); requestAnimationFrame(() => { el?.focus(); const p = c + lead.length + 1; el?.setSelectionRange(p, p); track(el!.value, p); }); }} />
          <IconButton icon="paperclip" label="Attach an image" size="sm" onClick={() => picker.current?.click()} />
          <Select size="sm" value={s.model} onChange={(e: any) => guard(api.setSessionModel(s.id, e.target.value as ModelAlias))} options={[{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }]} />
          <Select size="sm" value={s.effort || 'default'} onChange={(e: any) => guard(api.setSessionEffort(s.id, e.target.value === 'default' ? null : (e.target.value as Effort)))} options={EFFORTS} />
          <Select size="sm" value={s.permMode} onChange={(e: any) => guard(api.setSessionPermMode(s.id, e.target.value as PermMode))} options={[{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits' }, { value: 'plan', label: 'Plan only' }]} />
          <span style={{ flex: 1 }} />
          {s.ctx ? <span title={`Context window: ${fmtTokens(s.ctx)} of 200k tokens in use`} style={{ font: '400 11.5px/1 var(--font-mono)', color: ctxPct >= 75 ? 'var(--status-attention-text)' : 'var(--text-3)', whiteSpace: 'nowrap' }}>{ctxPct}% context</span> : null}
          {working ? <Button size="sm" variant="ghost" kbd="Esc" onClick={() => guard(api.interrupt(s.id))}>Interrupt</Button> : null}
          <Button size="sm" variant="primary" icon="paper-plane-right" kbd={MOD() + '↵'} disabled={!text.trim() && !images.length} onClick={send}>Send</Button>
        </div>
      </div>
    </div>
  );
}

function UsagePanel({ s }: { s: S }) {
  const app = useApp();
  const { fmt } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const [width, grip, resetWidth] = usePaneWidth('usage-panel', 300, 240, 560, -1);
  const limit = s.maxSubagents ?? app.settings.maxSubagentsSession;
  const running = runningSubagents(s);
  const n = (v: string, l: string) => <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ font: '500 15px/1 var(--font-mono)' }}>{v}</span><span style={{ font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>{l}</span></div>;
  const files = Object.entries(s.filesTouched);
  return (
    <aside style={{ position: 'relative', width, flex: 'none', borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg-panel)' }}>
      <Grip edge="left" onMouseDown={grip} onDoubleClick={resetWidth} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={label}>Usage</span>
        <Meter label="Context window" detail={fmtTokens(s.ctx) + ' / 200k'} value={s.ctx} max={200000} warnAt={0.75} />
        {sub ? null : <Meter label="Session budget" detail={fmt(s.cost) + ' / ' + fmt(s.budget, true)} value={s.cost} max={s.budget} warnAt={app.settings.warnAt / 100} />}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 }}>
          {n(fmtTokens(s.tokens.input), 'Input')}{n(fmtTokens(s.tokens.output), 'Output')}{n(fmtTokens(s.tokens.cacheRead), 'Cache read')}{sub ? n(String(s.subagents.length), 'Subagents') : n(fmt(s.cost), 'Cost so far')}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...label, flex: 1, whiteSpace: 'nowrap' }}>Subagents · {running} / {limit}</span>
          <Select size="sm" value={s.maxSubagents == null ? 'default' : String(s.maxSubagents)} onChange={(e: any) => guard(api.setSessionMaxSubagents(s.id, e.target.value === 'default' ? null : +e.target.value))}
            options={[{ value: 'default', label: 'Default (' + app.settings.maxSubagentsSession + ')' }, ...[0, 1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 0 ? 'Off' : 'Up to ' + n }))]} />
        </div>
        <SubagentTree s={s} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Files touched · {files.length}</span>
        {files.length === 0 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No changes yet.</span> : null}
        {files.slice(0, 40).map(([p, v]) => (
          <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => go({ screen: 'session', id: s.id, tab: 'changes' })}>
            <span style={{ flex: 1, minWidth: 0, font: '400 11.5px/1.2 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left' }}>{p}</span>
            <DiffStat additions={v.add} deletions={v.del} blocks={false} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={label}>Worktree</span>
        <span className="selectable" style={{ font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-2)', wordBreak: 'break-all' }}>{tilde(s.worktree, app.home)}</span>
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Isolated from your main checkout.{s.removeAfterMerge ? ' Removed after the PR merges.' : ''}</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button size="sm" variant="ghost" icon={s.archivedAt ? 'arrow-counter-clockwise' : 'archive'} disabled={!s.archivedAt && (s.status === 'working' || s.status === 'attention')} onClick={() => guard(api.archiveSession(s.id, !s.archivedAt))}>{s.archivedAt ? 'Restore' : 'Archive'}</Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={() => setUI({ deleting: s.id })}>Delete session…</Button>
        </div>
      </div>
    </aside>
  );
}

function SubagentView({ s, subId }: { s: S; subId: string }) {
  const a = s.subagents.find((x) => x.id === subId);
  const key = `${s.id}~${subId}`;
  const items = useTranscript(key);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);
  const [width, grip, resetWidth] = usePaneWidth('usage-panel', 300, 240, 560, -1);
  React.useEffect(() => { void loadTranscript(key); }, [key]);
  // Claude Code writes a subagent's own messages to disk lazily, so ask for a fresh read while looking at one.
  const working = a?.status === 'working';
  React.useEffect(() => {
    void api.refreshSubagent(s.id, subId);
    if (!working) return;
    const t = setInterval(() => void api.refreshSubagent(s.id, subId), 4000);
    return () => clearInterval(t);
  }, [s.id, subId, working]);
  React.useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items]);
  if (!a) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This subagent is no longer in the session.</div>;
  const parent = a.parentId ? s.subagents.find((x) => x.id === a.parentId) : undefined;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 'none', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Button size="sm" variant="ghost" icon="arrow-left" onClick={() => (parent ? go({ screen: 'session', id: s.id, tab: 'conversation', sub: parent.id }) : go({ screen: 'session', id: s.id, tab: 'conversation' }))}>{parent ? parent.description : s.id}</Button>
          <i className="ph ph-tree-structure" style={{ fontSize: 18, color: 'var(--accent-text)' }} />
          <span style={{ font: '600 16px/1.2 var(--font-sans)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}</span>
          <Badge mono>{a.agentType}</Badge>
          <Badge tone={subTone(a.status) as any} dot>{subLabel(a.status)}</Badge>
        </div>
        <div style={{ display: 'flex', gap: 10, font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)' }}>
          <span>started {clock(a.startedAt)}</span><span>·</span><span>{a.status === 'working' ? elapsed(a.startedAt) : elapsed(a.startedAt, a.endedAt)}</span><span>·</span><span>{a.tools} tool calls</span><span>·</span><span>{fmtTokens(a.tokens)} tokens</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TranscriptList items={items || []} renderItem={(m) => <TranscriptItem m={m} s={s} onDeny={() => undefined} />}
            header={!items ? <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading transcript…</span> : null}
            footer={<>
              {a.status === 'working' ? <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--status-working-text)' }}><i className="ph ph-circle-notch" style={{ fontSize: 14, animation: 'helm-spin .9s linear infinite' }} />Working</div> : null}
              <div style={{ marginLeft: 32, font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>This transcript is read-only. Message the parent agent from the session's conversation.</div>
            </>} />
        </div>
        <aside style={{ position: 'relative', width, flex: 'none', borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 16, background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Grip edge="left" onMouseDown={grip} onDoubleClick={resetWidth} />
          <span style={label}>All subagents</span>
          <SubagentTree s={s} selected={subId} />
        </aside>
      </div>
    </div>
  );
}

export function Session({ id, tab, setTab, themeKey, sub }: { id: string; tab: string; setTab(t: string): void; themeKey: 'dark' | 'light'; sub?: string }) {
  const app = useApp();
  const s = app.sessions.find((x) => x.id === id);
  const items = useTranscript(id);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  React.useEffect(() => { void loadTranscript(id); }, [id]);
  React.useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items, tab, s?.step]);

  React.useEffect(() => {
    if (!s) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && s.status === 'working') { void api.interrupt(s.id); }
      if (e.key === 'Enter' && mod(e) && s.ask?.type === 'approve' && !(e.target as HTMLTextAreaElement).value) { e.preventDefault(); void guard(api.resolveAsk(s.id, s.ask.id, { decision: 'approve' })); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s?.status, s?.ask?.id, s?.id]);

  if (!s) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>This session no longer exists.</div>;

  let body: React.ReactNode;
  if (sub) body = <SubagentView s={s} subId={sub} />;
  else if (s.worktreeGone && (tab === 'code' || tab === 'changes')) body = <div style={{ ...gone, flex: 1 }}>The worktree was removed after this was merged{s.mergedInto ? ` into ${s.mergedInto}` : ''}, so there is no code to browse here. The conversation is kept.</div>;
  else if (tab === 'code') body = <CodeView wsId={s.id} session={s} branch={s.branch} themeKey={themeKey} />;
  else if (tab === 'changes') body = <Changes s={s} />;
  else body = (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, minHeight: 0 }}>
          <TranscriptList items={items || []} renderItem={(m) => <TranscriptItem m={m} s={s} onDeny={() => input.current?.focus()} />}
            header={!items ? <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading conversation…</span> : null}
            footer={<>
              {s.status === 'working' ? (
                <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--status-working-text)' }}>
                  <i className="ph ph-circle-notch" style={{ fontSize: 14, animation: 'helm-spin .9s linear infinite' }} />{s.step}
                </div>
              ) : null}
              {s.status === 'idle' && s.step ? <div style={{ marginLeft: 32, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>{s.step}</div> : null}
            </>} />
        </div>
        {s.worktreeGone ? <div style={{ ...gone, padding: '0 20px 16px' }}>Merged{s.mergedInto ? ` into ${s.mergedInto}` : ''} and archived. The worktree was removed, so this session cannot be continued.</div> : <Composer s={s} inputRef={input} />}
      </div>
      <UsagePanel s={s} />
    </div>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <SessionHeader s={s} tab={tab} setTab={setTab} />
      {body}
    </div>
  );
}
