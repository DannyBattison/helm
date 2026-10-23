import React from 'react';
import type { Session as S, TranscriptEvent, ModelAlias, PermMode } from '@shared/types';
import { api, platform } from '../api';
import { clock, fmtTokens, money, prettyModel, STATUS_LABEL, tilde } from '../lib';
import { go, loadTranscript, toast, useApp, useTranscript } from '../store';
import { Avatar, Badge, BranchTag, Button, DiffStat, IconButton, Meter, Select, Tabs } from '../ui';
import { Changes } from './Changes';
import { CodeView } from './CodeView';

const guard = (p: Promise<any>) => p.catch((e: any) => toast({ tone: 'error', title: 'That did not work', description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') }));
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (platform() === 'darwin' ? e.metaKey : e.ctrlKey);
const MOD = () => (platform() === 'darwin' ? '⌘' : 'Ctrl+');

const label: React.CSSProperties = { font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' };
const box: React.CSSProperties = { borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', overflow: 'hidden' };

function SessionHeader({ s, tab, setTab }: { s: S; tab: string; setTab(t: string): void }) {
  const running = s.status === 'working' || s.status === 'attention';
  return (
    <div style={{ flex: 'none', padding: '14px 20px 0', display: 'flex', flexDirection: 'column', gap: 12, borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Avatar agent name={s.id} size={26} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ font: '600 16px/1.2 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.task}</span>
            <Badge tone={s.status} dot>{STATUS_LABEL[s.status]}</Badge>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <BranchTag worktree base={s.base.replace(/^origin\//, '')} name={s.branch} />
            <span>{prettyModel(s)}</span><span>·</span><span>started {clock(s.startedAt)}</span><span>·</span><span>{fmtTokens(s.tokens.input + s.tokens.output + s.tokens.cacheRead)} tokens</span><span>·</span><span>{money(s.cost)}</span>
          </div>
        </div>
        {s.status === 'working' ? <Button variant="ghost" icon="pause" onClick={() => guard(api.interrupt(s.id))}>Pause</Button> : null}
        {running ? <Button variant="ghost" icon="stop" onClick={() => guard(api.stopSession(s.id))}>Stop</Button> : null}
        <Button variant="secondary" icon="arrow-square-out" onClick={() => guard(api.openInEditor(s.id))}>Open in editor</Button>
        {s.prUrl ? <Button variant="secondary" icon="git-pull-request" onClick={() => api.openExternal(s.prUrl!)}>View pull request</Button>
          : s.status === 'ready' ? <Button variant="primary" icon="git-pull-request" onClick={() => setTab('changes')}>Create pull request</Button>
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
  const flushPara = () => { if (para.length) { blocks.push(<div key={blocks.length}>{inline(para.join(' '))}</div>); para = []; } };
  const flushList = () => { if (list) { const L = list; blocks.push(React.createElement(L.ordered ? 'ol' : 'ul', { key: blocks.length, style: { margin: 0, paddingLeft: 20, color: 'var(--text-2)' } }, L.items.map((x, i) => <li key={i}>{inline(x)}</li>))); list = null; } };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (fence) { blocks.push(<pre key={blocks.length} className="selectable" style={{ margin: 0, padding: '8px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', font: 'var(--type-data)', overflow: 'auto' }}>{fence.join('\n')}</pre>); fence = null; }
      else { flushPara(); flushList(); fence = []; }
      continue;
    }
    if (fence) { fence.push(line); continue; }
    const m = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (m) { flushPara(); const ordered = !!m[2]; if (list && list.ordered !== ordered) flushList(); list = list || { ordered, items: [] }; list.items.push(m[3]); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line.trim().replace(/^#+\s*/, '')); }
  }
  if (fence) blocks.push(<pre key={blocks.length} style={{ margin: 0 }}>{fence.join('\n')}</pre>);
  flushPara(); flushList();
  return <>{blocks}</>;
}

function TranscriptItem({ m, s, onDeny }: { m: TranscriptEvent; s: S; onDeny(): void }) {
  const app = useApp();
  if (m.k === 'user') return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar name={app.user?.login || 'you'} src={app.user?.avatar || undefined} size={22} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ font: '500 12px/1 var(--font-sans)' }}>{app.user?.login || 'you'} <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', marginLeft: 6 }}>{clock(m.t)}</span></span>
        <div className="selectable" style={{ font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
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
            <span style={{ textAlign: 'center', color: t === '+' ? 'var(--diff-add-fg)' : t === '-' ? 'var(--diff-del-fg)' : 'var(--text-3)' }}>{t === '-' ? '−' : t}</span><span>{'  ' + l}</span>
          </div>
        ))}
      </pre>
    </div>
  );
  if (m.k === 'bash') return (
    <div style={{ marginLeft: 32, ...box }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 10px', background: 'var(--bg-editor)' }}>
        <i className="ph ph-terminal" style={{ fontSize: 13, color: 'var(--text-3)' }} />
        <span className="selectable" style={{ font: '400 12px/1 var(--font-mono)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><span style={{ color: 'var(--text-3)' }}>$ </span>{m.cmd}</span>
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
  if (m.k === 'permission') {
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
        <code className="selectable" style={{ font: 'var(--type-code)', padding: '6px 10px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-editor)', color: 'var(--text-1)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{isCmd ? '$ ' : ''}{m.cmd}</code>
        <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>{m.why}</div>
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

function Composer({ s, inputRef }: { s: S; inputRef: React.RefObject<HTMLTextAreaElement> }) {
  const [text, setText] = React.useState('');
  const working = s.status === 'working';
  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    void guard(api.sendMessage(s.id, t));
  };
  const placeholder = s.ask?.type === 'question' ? 'Type your answer' : s.ask ? 'Tell the agent what to do instead, or approve above' : working ? 'Add guidance while it works, or press Esc to interrupt' : 'Reply to ' + s.id;
  return (
    <div style={{ flex: 'none', padding: '0 20px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', borderRadius: 'var(--radius-lg)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }}>
        <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && (mod(e) || (!e.shiftKey && !e.nativeEvent.isComposing && false))) { e.preventDefault(); send(); } }}
          style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', font: '400 13px/1.5 var(--font-sans)', padding: '10px 12px 4px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 6px 8px' }}>
          <IconButton icon="at" label="Mention a file" size="sm" onClick={() => { setText((t) => t + '@'); inputRef.current?.focus(); }} />
          <Select size="sm" value={s.model} onChange={(e) => guard(api.setSessionModel(s.id, e.target.value as ModelAlias))} options={[{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }]} />
          <Select size="sm" value={s.permMode} onChange={(e) => guard(api.setSessionPermMode(s.id, e.target.value as PermMode))} options={[{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits' }, { value: 'plan', label: 'Plan only' }]} />
          <span style={{ flex: 1 }} />
          {working ? <Button size="sm" variant="ghost" kbd="Esc" onClick={() => guard(api.interrupt(s.id))}>Interrupt</Button> : null}
          <Button size="sm" variant="primary" icon="paper-plane-right" kbd={MOD() + '↵'} disabled={!text.trim()} onClick={send}>Send</Button>
        </div>
      </div>
    </div>
  );
}

function UsagePanel({ s }: { s: S }) {
  const app = useApp();
  const n = (v: string, l: string) => <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ font: '500 15px/1 var(--font-mono)' }}>{v}</span><span style={{ font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>{l}</span></div>;
  const files = Object.entries(s.filesTouched);
  return (
    <aside style={{ width: 300, flex: 'none', borderLeft: '1px solid var(--border)', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg-panel)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span style={label}>Usage</span>
        <Meter label="Context window" detail={fmtTokens(s.ctx) + ' / 200k'} value={s.ctx} max={200000} warnAt={0.75} />
        <Meter label="Session budget" detail={money(s.cost) + ' / $' + s.budget} value={s.cost} max={s.budget} warnAt={app.settings.warnAt / 100} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 4 }}>
          {n(fmtTokens(s.tokens.input), 'Input')}{n(fmtTokens(s.tokens.output), 'Output')}{n(fmtTokens(s.tokens.cacheRead), 'Cache read')}{n(money(s.cost), 'Cost so far')}
        </div>
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
          <Button size="sm" variant="ghost" icon="trash" onClick={() => { if (confirm(`Delete session ${s.id} and remove its worktree? Unpushed commits on ${s.branch} are lost.`)) { void guard(api.deleteSession(s.id, true)); go({ screen: 'overview' }); } }}>Delete session</Button>
        </div>
      </div>
    </aside>
  );
}

export function Session({ id, tab, setTab, themeKey }: { id: string; tab: string; setTab(t: string): void; themeKey: 'dark' | 'light' }) {
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
  if (tab === 'code') body = <CodeView s={s} themeKey={themeKey} />;
  else if (tab === 'changes') body = <Changes s={s} />;
  else body = (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 20px 12px' }}>
          <div style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!items ? <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading conversation…</span> : null}
            {(items || []).map((m, i) => <TranscriptItem key={i} m={m} s={s} onDeny={() => input.current?.focus()} />)}
            {s.status === 'working' ? (
              <div style={{ marginLeft: 32, display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--status-working-text)' }}>
                <i className="ph ph-circle-notch" style={{ fontSize: 14, animation: 'helm-spin .9s linear infinite' }} />{s.step}
              </div>
            ) : null}
            {s.status === 'idle' && s.step ? <div style={{ marginLeft: 32, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>{s.step}</div> : null}
          </div>
        </div>
        <Composer s={s} inputRef={input} />
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
