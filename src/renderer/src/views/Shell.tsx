import React from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { api, on, platform } from '../api';
import glyph from '../assets/helm-glyph-violet.svg';
import { elapsed, reposWithSessions, totals } from '../lib';
import { go, setUI, useApp, useUI, useTranscript, type Route } from '../store';
import { Avatar, Badge, Breadcrumbs, IconButton, Kbd, Meter, TreeItem } from '../ui';

const mac = () => platform() === 'darwin';

function SectionLabel({ children, action }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 4px 0 10px', marginTop: 10 }}>
      <span style={{ flex: 1, font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{children}</span>
      {action}
    </div>
  );
}

export function Sidebar() {
  const app = useApp();
  const route = useUI((u) => u.route);
  const [closed, setClosed] = React.useState<Record<string, boolean>>({});
  const t = totals(app);
  return (
    <aside style={{ width: 'var(--sidebar-w)', flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
      <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 ' + (mac() ? 78 : 14) + 'px' }}>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src={glyph} width="16" height="16" alt="" />
          <span style={{ font: '600 13px/1 var(--font-mono)', letterSpacing: '-0.02em' }}>helm</span>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 6px 8px' }}>
        <TreeItem icon="squares-four" label="Overview" selected={route.screen === 'overview' && !(route as any).filter} onClick={() => go({ screen: 'overview' })} />
        <TreeItem icon="bell-ringing" label="Needs you" selected={route.screen === 'overview' && (route as any).filter === 'attention'} onClick={() => go({ screen: 'overview', filter: 'attention' })}
          trailing={t.attention ? <Badge tone="attention" mono>{t.attention}</Badge> : null} />
        <TreeItem icon="pulse" label="Activity" selected={route.screen === 'activity'} onClick={() => go({ screen: 'activity' })} />
        <SectionLabel action={<IconButton icon="plus" label="Add repository" size="sm" onClick={() => setUI({ adding: true })} />}>Repositories</SectionLabel>
        {app.repos.length === 0 ? <div style={{ padding: '4px 10px 6px', font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No repositories yet. Use + to add one from GitHub.</div> : null}
        {reposWithSessions(app).map(({ repo: r, sessions }) => {
          const open = !closed[r.id];
          return (
            <div key={r.id}>
              <TreeItem icon="book-bookmark" expandable={sessions.length > 0} expanded={open}
                label={<span><span style={{ color: 'var(--text-3)' }}>{r.owner}/</span>{r.name}</span>}
                selected={route.screen === 'repo' && route.id === r.id} meta={sessions.length || null}
                onClick={() => { if (route.screen === 'repo' && route.id === r.id) setClosed({ ...closed, [r.id]: open }); else go({ screen: 'repo', id: r.id }); }} />
              {open ? sessions.map((s) => (
                <TreeItem key={s.id} depth={1} status={s.status} label={s.id} meta={elapsed(s.startedAt, s.endedAt)}
                  selected={route.screen === 'session' && route.id === s.id}
                  onClick={() => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' })} />
              )) : null}
              {sessions.length === 0 ? <div style={{ padding: '4px 0 6px 42px', font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-3)' }}>No sessions</div> : null}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 'none', padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Meter label="This week" detail={'$' + t.spent.toFixed(2) + ' / $' + t.cap} value={t.spent} max={t.cap} warnAt={app.settings.warnAt / 100} />
        <TreeItem icon="gear-six" label="Settings" selected={route.screen === 'settings'} onClick={() => go({ screen: 'settings' })} style={{ margin: '0 -6px' }} />
      </div>
    </aside>
  );
}

export function TitleBar({ crumbs, theme, setTheme }: { crumbs: any[]; theme: 'dark' | 'light'; setTheme(t: 'dark' | 'light'): void }) {
  const app = useApp();
  const need = app.sessions.filter((s) => s.status === 'attention').length;
  return (
    <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 ' + (mac() ? 10 : 150) + 'px 0 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-app)' }}>
      <div style={{ flex: 1, minWidth: 0 }}><Breadcrumbs items={crumbs || []} /></div>
      <button type="button" onClick={() => setUI({ palette: true })} style={{ width: 340, height: 26, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 10px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-3)', font: '400 12px/1 var(--font-sans)', cursor: 'pointer' }}>
        <i className="ph ph-magnifying-glass" style={{ fontSize: 13 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search sessions, files and commits</span>
        <Kbd keys={[mac() ? '⌘' : 'Ctrl', 'K']} />
      </button>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        <IconButton icon="bell" label="Needs you" badge={need > 0} onClick={() => go({ screen: 'overview', filter: 'attention' })} />
        <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
        <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
        <Avatar name={app.user?.login || '?'} src={app.user?.avatar || undefined} size={22} />
      </div>
    </div>
  );
}

export function StatusBar() {
  const app = useApp();
  const term = useUI((u) => u.term);
  const t = totals(app);
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 8px', color: 'var(--text-3)' };
  const dot = (c: string) => <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-' + c + ')' }} />;
  const tok = t.tokens >= 1e6 ? (t.tokens / 1e6).toFixed(2) + 'M' : t.tokens >= 1e3 ? Math.round(t.tokens / 1e3) + 'k' : String(t.tokens);
  return (
    <div style={{ height: 'var(--statusbar-h)', flex: 'none', display: 'flex', alignItems: 'center', padding: '0 6px', borderTop: '1px solid var(--border)', background: 'var(--bg-sidebar)', font: '400 11px/1 var(--font-mono)' }}>
      <span style={item}>{dot('working')}{t.working} working</span>
      <span style={item}>{dot('attention')}{t.attention} need you</span>
      <span style={item}>{dot('ready')}{t.ready} ready</span>
      <span style={{ flex: 1 }} />
      <span style={item}>{tok} tokens today</span>
      <span style={item} title={app.claudeVersion ? 'Claude Code CLI found' : 'Using the Claude Code bundled with helm'}><i className="ph ph-plugs-connected" style={{ fontSize: 12 }} />{app.claudeVersion ? 'claude ' + app.claudeVersion : 'claude (bundled)'}</span>
      <span style={{ ...item, cursor: 'pointer', color: term ? 'var(--text-1)' : 'var(--text-3)' }} onClick={() => setUI({ term: !term })}><i className="ph ph-terminal-window" style={{ fontSize: 12 }} />Terminal ⌃`</span>
    </div>
  );
}

function cssVar(n: string) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

/** A real shell in a pty, rooted in the session's worktree when there is one. */
export function XTerm({ sessionId, themeKey }: { sessionId: string | null; themeKey: string }) {
  const el = React.useRef<HTMLDivElement>(null);
  const term = React.useRef<Terminal | null>(null);
  React.useEffect(() => {
    const t = new Terminal({ fontFamily: 'Monaspace Neon, monospace', fontSize: 12, lineHeight: 1.4, cursorBlink: true, allowProposedApi: true, theme: {} });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(el.current!);
    term.current = t;
    let id: string | null = null;
    let dead = false;
    const doFit = () => { try { fit.fit(); if (id) void api.termResize(id, t.cols, t.rows); } catch { /* hidden */ } };
    doFit();
    api.termOpen(sessionId, t.cols, t.rows).then((tid) => {
      if (dead) { void api.termClose(tid); return; }
      id = tid;
      t.onData((d) => void api.termWrite(tid, d));
      doFit();
    });
    const offD = on('termData', (p) => { if (p.id === id) t.write(p.data); });
    const offE = on('termExit', (p) => { if (p.id === id) t.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n'); });
    const ro = new ResizeObserver(doFit);
    ro.observe(el.current!);
    return () => { dead = true; offD(); offE(); ro.disconnect(); if (id) void api.termClose(id); t.dispose(); };
  }, [sessionId]);
  React.useEffect(() => {
    if (!term.current) return;
    term.current.options.theme = { background: cssVar('--bg-editor'), foreground: cssVar('--text-1'), cursor: cssVar('--text-2'), selectionBackground: cssVar('--accent-muted') };
  }, [themeKey]);
  return <div ref={el} style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: 'var(--bg-editor)' }} />;
}

export function TerminalDrawer({ height = 210, onClose, sessionId, themeKey }: { height?: number; onClose(): void; sessionId: string | null; themeKey: string }) {
  const [tab, setTab] = React.useState<'shell' | 'agent'>('shell');
  const tr = useTranscript(sessionId || '') || [];
  const bash = tr.filter((e) => e.k === 'bash') as any[];
  const tabStyle = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 10px', cursor: 'pointer', font: '400 11.5px/1 var(--font-mono)', color: on ? 'var(--text-1)' : 'var(--text-3)', boxShadow: on ? 'inset 0 -1px 0 var(--accent)' : 'none' });
  return (
    <div style={{ height, flex: 'none', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', background: 'var(--bg-editor)' }}>
      <div style={{ height: 30, flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px 0 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={tabStyle(tab === 'shell')} onClick={() => setTab('shell')}><i className="ph ph-terminal-window" style={{ fontSize: 13 }} />{sessionId ? 'shell · ' + sessionId : 'shell'}</span>
        {sessionId ? <span style={tabStyle(tab === 'agent')} onClick={() => setTab('agent')}><i className="ph ph-robot" style={{ fontSize: 13 }} />agent output</span> : null}
        <span style={{ flex: 1 }} />
        <IconButton icon="caret-down" label="Minimise" size="sm" onClick={onClose} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: tab === 'shell' ? 'flex' : 'none' }}><XTerm sessionId={sessionId} themeKey={themeKey} /></div>
      {tab === 'agent' ? (
        <pre className="selectable" style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: '8px 14px', font: '400 12px/1.6 var(--font-mono)', color: 'var(--text-2)' }}>
          {bash.length === 0 ? <div style={{ color: 'var(--text-3)' }}>The agent has not run any commands yet.</div> : null}
          {bash.map((b, i) => (
            <div key={i}><span style={{ color: 'var(--text-3)' }}>$ </span><span style={{ color: 'var(--text-1)' }}>{b.cmd}</span>
              {b.done ? <div style={{ color: b.ok ? 'var(--diff-add-fg)' : 'var(--diff-del-fg)' }}>{b.out} <span style={{ color: 'var(--text-3)' }}>{b.meta}</span></div> : <div style={{ color: 'var(--status-working-text)' }}>running…</div>}</div>
          ))}
        </pre>
      ) : null}
    </div>
  );
}

export type { Route };
