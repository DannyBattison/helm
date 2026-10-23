import { sessionTitle } from '@shared/types';
import React from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { api, on, platform } from '../api';
import { fontStack } from '../fonts';
import glyph from '../assets/helm-glyph-violet.svg';
import { ago, elapsed, fmtTokens, lifetimeTokens, livePlan, reposWithSessions, runningSubagents, subagentTree, totals, untilReset } from '../lib';
import { go, refreshExternals, setUI, toast, useApp, useMoney, useUI, useTranscript, type Route } from '../store';
import { Avatar, Badge, Breadcrumbs, ContextMenu, Grip, IconButton, Kbd, Meter, TreeItem, usePaneWidth, type MenuItem } from '../ui';

const mac = () => platform() === 'darwin';

function SectionLabel({ children, action }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 4px 0 10px', marginTop: 10 }}>
      <span style={{ flex: 1, font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{children}</span>
      {action}
    </div>
  );
}

export function PlanMeters() {
  const app = useApp();
  const { fmt } = useMoney();
  const p = livePlan(app);
  const warn = app.settings.warnAt / 100;
  if (app.settings.billing === 'api') {
    const t = totals(app);
    return <Meter label="This week" detail={fmt(t.spent) + ' / ' + fmt(t.cap, true)} value={t.spent} max={t.cap} warnAt={warn} />;
  }
  const row = (label: string, w?: { util: number; resetsAt: number }) =>
    w ? <Meter label={label} detail={`${Math.round(w.util * 100)}% · resets ${untilReset(w.resetsAt)}`} value={w.util} max={1} warnAt={warn} />
      : <Meter label={label} detail="no data yet" value={0} max={1} />;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} title="Claude plan usage, as reported by Claude Code">
      {row('5-hour', p.fiveHour)}
      {row('Weekly', p.weekly)}
    </div>
  );
}

export function Sidebar() {
  const app = useApp();
  const route = useUI((u) => u.route);
  const [closed, setClosed] = React.useState<Record<string, boolean>>({});
  const [subsClosed, setSubsClosed] = React.useState<Record<string, boolean>>({});
  const [width, grip, resetWidth] = usePaneWidth('sidebar', 240, 180, 440);
  const t = totals(app);
  const externals = useUI((u) => u.externals);
  const showArchived = useUI((u) => u.showArchived);
  const archivedCount = app.sessions.filter((x) => x.archivedAt).length + Object.values(externals).reduce((n, l) => n + l.filter((x) => x.archived).length, 0);
  const extList = (id: string) => (externals[id] || []).filter((x) => showArchived || !x.archived);
  const toggleArchived = () => { try { localStorage.setItem('helm-show-archived', showArchived ? '0' : '1'); } catch { /* storage unavailable */ } setUI({ showArchived: !showArchived }); };
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const sessionMenu = (e: React.MouseEvent, s: (typeof app.sessions)[number]) => {
    e.preventDefault();
    e.stopPropagation();
    const running = s.status === 'working' || s.status === 'attention';
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open conversation', icon: 'chats-circle', onClick: () => go({ screen: 'session', id: s.id, tab: 'conversation' }) },
      { label: 'Open code', icon: 'code', onClick: () => go({ screen: 'session', id: s.id, tab: 'code' }) },
      { label: s.files ? `Review changes (${s.files})` : 'Review changes', icon: 'git-diff', onClick: () => go({ screen: 'session', id: s.id, tab: 'changes' }) },
      { label: 'Copy branch name', icon: 'copy', separator: true, onClick: () => void api.copyText(s.branch) },
      { label: 'Rename…', icon: 'pencil-simple', onClick: () => setUI({ renaming: s.id }) },
      { label: 'Stop session', icon: 'stop', disabled: !running, onClick: () => void api.stopSession(s.id) },
      { label: s.archivedAt ? 'Restore from archive' : running ? 'Archive (stop it first)' : 'Archive session', icon: s.archivedAt ? 'arrow-counter-clockwise' : 'archive', disabled: !s.archivedAt && running, onClick: () => { api.archiveSession(s.id, !s.archivedAt).catch((err) => toast({ tone: 'error', title: 'Could not archive', description: String(err?.message || err).replace(/^Error invoking remote method \'\w+\': Error: /, '') })); } },
      { label: 'Delete session…', icon: 'trash', danger: true, separator: true, onClick: () => setUI({ deleting: s.id }) }
    ] });
  };
  const externalMenu = (e: React.MouseEvent, repoId: string, x: (typeof externals)[string][number]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'Open transcript', icon: 'eye', onClick: () => go({ screen: 'external', repoId, id: x.id }) },
      { label: 'Copy session id', icon: 'copy', onClick: () => void api.copyText(x.id) },
      { label: x.archived ? 'Restore from archive' : 'Archive', icon: x.archived ? 'arrow-counter-clockwise' : 'archive', separator: true, onClick: () => { api.archiveExternal(x.id, !x.archived).then(() => refreshExternals()); } }
    ] });
  };
  const repoMenu = (e: React.MouseEvent, r: (typeof app.repos)[number]) => {
    e.preventDefault();
    e.stopPropagation();
    const editor = app.settings.openIn;
    const fail = (title: string) => (err: any) => toast({ tone: 'error', title, description: String(err?.message || err).replace(/^Error invoking remote method '\w+': Error: /, '') });
    setMenu({ x: e.clientX, y: e.clientY, items: [
      { label: 'New session', icon: 'plus', onClick: () => setUI({ newSession: { repoId: r.id } }) },
      { label: 'History', icon: 'git-commit', separator: true, onClick: () => go({ screen: 'repo', id: r.id, tab: 'history' }) },
      { label: 'Code', icon: 'code', onClick: () => go({ screen: 'repo', id: r.id, tab: 'code' }) },
      { label: 'Branches & worktrees', icon: 'tree-structure', onClick: () => go({ screen: 'repo', id: r.id, tab: 'worktrees' }) },
      { label: 'Pull requests', icon: 'git-pull-request', onClick: () => go({ screen: 'repo', id: r.id, tab: 'prs' }) },
      { label: 'Fetch from GitHub', icon: 'arrows-clockwise', separator: true, onClick: () => { api.fetchRepo(r.id).then(() => toast({ tone: 'ready', title: 'Fetched', description: r.id })).catch(fail('Fetch failed')); } },
      { label: 'Open on GitHub', icon: 'github-logo', onClick: () => void api.openExternal(`https://github.com/${r.id}`) },
      { label: editor === 'helm' ? 'Open code in helm' : `Open in ${editor}`, icon: 'arrow-square-out', separator: true, onClick: () => { api.openRepoInEditor(r.id).catch(fail('Could not open the editor')); } },
      { label: 'Show in file manager', icon: 'folder-open', onClick: () => { api.openFolder(r.localPath).catch(fail('Could not open the folder')); } },
      { label: 'Copy path', icon: 'copy', onClick: () => void api.copyText(r.localPath) },
      { label: 'Copy GitHub URL', icon: 'link', onClick: () => void api.copyText(`https://github.com/${r.id}`) },
      { label: 'Remove from helm…', icon: 'trash', danger: true, separator: true, onClick: () => setUI({ removingRepo: r.id }) }
    ] });
  };
  // Reordering: repositories among themselves, and sessions within their repository. Subagents are never dragged on their own.
  const drag = React.useRef<{ kind: 'repo' | 'session'; id: string; repoId?: string } | null>(null);
  const [over, setOver] = React.useState<{ key: string; pos: 'before' | 'after' } | null>(null);
  const dnd = (kind: 'repo' | 'session', id: string, repoId?: string) => ({
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => { drag.current = { kind, id, repoId }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); e.stopPropagation(); },
    onDragEnd: () => { drag.current = null; setOver(null); }
  });
  const target = (kind: 'repo' | 'session', id: string, repoId?: string) => ({
    onDragOver: (e: React.DragEvent) => {
      const d = drag.current;
      if (!d || d.kind !== kind || d.repoId !== repoId) return;
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
      setOver((cur) => (cur && cur.key === id && cur.pos === pos ? cur : { key: id, pos }));
    },
    onDrop: (e: React.DragEvent) => {
      const d = drag.current;
      if (!d || d.kind !== kind || d.repoId !== repoId || d.id === id) { setOver(null); return; }
      e.preventDefault();
      e.stopPropagation();
      const ids = (kind === 'repo' ? app.repos.map((r) => r.id) : app.sessions.filter((s) => s.repoId === repoId).map((s) => s.id)).filter((x) => x !== d.id);
      const at = ids.indexOf(id) + (over?.pos === 'after' ? 1 : 0);
      ids.splice(at, 0, d.id);
      void (kind === 'repo' ? api.reorderRepos(ids) : api.reorderSessions(repoId!, ids));
      drag.current = null;
      setOver(null);
    }
  });
  const line = (id: string): React.CSSProperties => (over?.key === id ? { boxShadow: over.pos === 'before' ? 'inset 0 2px 0 var(--accent)' : 'inset 0 -2px 0 var(--accent)', borderRadius: 3 } : {});
  const subStatus = (st: string) => (st === 'working' ? 'working' : st === 'failed' ? 'error' : 'idle');
  return (
    <aside style={{ position: 'relative', width, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
      <Grip onMouseDown={grip} onDoubleClick={resetWidth} />
      <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px 0 ' + (mac() ? 78 : 14) + 'px' }}>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src={glyph} width="22" height="22" alt="" />
          <span style={{ font: '600 14px/1 var(--font-mono)', letterSpacing: '-0.02em', position: 'relative', top: '0.14em' }}>helm</span>
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 6px 8px' }}>
        <TreeItem icon="squares-four" label="Overview" selected={route.screen === 'overview' && !(route as any).filter} onClick={() => go({ screen: 'overview' })} />
        <TreeItem icon="bell-ringing" label="Needs you" selected={route.screen === 'overview' && (route as any).filter === 'attention'} onClick={() => go({ screen: 'overview', filter: 'attention' })}
          trailing={t.attention ? <Badge tone="attention" mono>{t.attention}</Badge> : null} />
        <TreeItem icon="pulse" label="Activity" selected={route.screen === 'activity'} onClick={() => go({ screen: 'activity' })} />
        <TreeItem icon="archive" label="Archive" selected={route.screen === 'archive'} onClick={() => go({ screen: 'archive' })} trailing={archivedCount ? <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{archivedCount}</span> : null} />
        <SectionLabel action={<><IconButton icon="archive" label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'} size="sm" active={showArchived} onClick={toggleArchived} /><IconButton icon="plus" label="Add repository" size="sm" onClick={() => setUI({ adding: true })} /></>}>Repositories</SectionLabel>
        {app.repos.length === 0 ? <div style={{ padding: '4px 10px 6px', font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>No repositories yet. Use + to add one from GitHub.</div> : null}
        {reposWithSessions(app, showArchived).map(({ repo: r, sessions }) => {
          const open = !closed[r.id];
          return (
            <div key={r.id} {...target('repo', r.id)} style={line(r.id)}>
              <div {...dnd('repo', r.id)} onContextMenu={(e) => repoMenu(e, r)}>
              <TreeItem icon="book-bookmark" expandable={sessions.length > 0} expanded={open}
                label={<span><span style={{ color: 'var(--text-3)' }}>{r.owner}/</span>{r.name}</span>}
                selected={route.screen === 'repo' && route.id === r.id} meta={sessions.length || null}
                trailing={lifetimeTokens(app.lifetime[r.id]) ? <span title={`${lifetimeTokens(app.lifetime[r.id]).toLocaleString()} tokens used in ${r.name} over its lifetime, including deleted sessions`} style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', flex: 'none', marginLeft: 6 }}>{fmtTokens(lifetimeTokens(app.lifetime[r.id]))}</span> : null}
                onClick={() => { if (route.screen === 'repo' && route.id === r.id) setClosed({ ...closed, [r.id]: open }); else go({ screen: 'repo', id: r.id }); }} />
              </div>
              {open ? sessions.map((s) => {
                const tree = subagentTree(s);
                const running = runningSubagents(s);
                const subsOpen = !subsClosed[s.id];
                return (
                  <div key={s.id} {...target('session', s.id, r.id)} style={line(s.id)}>
                    <div {...dnd('session', s.id, r.id)} onContextMenu={(e) => sessionMenu(e, s)}>
                    <TreeItem depth={1} status={s.status} label={sessionTitle(s)} expandable={tree.length > 0} expanded={subsOpen} style={s.archivedAt ? { opacity: 0.6 } : undefined} trailing={s.archivedAt ? <i className="ph ph-archive" title="Archived" style={{ fontSize: 12, color: 'var(--text-3)' }} /> : null}
                      meta={running ? <span style={{ color: 'var(--status-working-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-tree-structure" style={{ fontSize: 11 }} />{running}</span> : elapsed(s.startedAt, s.endedAt)}
                      selected={route.screen === 'session' && route.id === s.id && !route.sub}
                      onClick={() => {
                        const here = route.screen === 'session' && route.id === s.id && !route.sub;
                        if (here && tree.length) setSubsClosed({ ...subsClosed, [s.id]: subsOpen });
                        else go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' });
                      }} />
                    </div>
                    {subsOpen ? tree.map(({ a, depth }) => (
                      <TreeItem key={a.id} depth={2 + depth} status={subStatus(a.status)} label={a.description} meta={a.tools + ' tools'}
                        selected={route.screen === 'session' && route.id === s.id && route.sub === a.id}
                        onClick={() => go({ screen: 'session', id: s.id, tab: 'conversation', sub: a.id })} />
                    )) : null}
                  </div>
                );
              }) : null}
              {open ? (() => {
                // Sessions started outside helm: read-only. Live ones and the latest few; the rest are in the repository's tab.
                const all = extList(r.id);
                const shown = all.filter((x, i) => x.active || i < 4);
                return <>
                  {shown.map((x) => (
                    <div key={x.id} onContextMenu={(e) => externalMenu(e, r.id, x)} style={x.archived ? { opacity: 0.6 } : undefined}><TreeItem depth={1} status={x.active ? 'working' : 'idle'}
                      label={<span style={{ fontStyle: 'italic' }} title={`${x.title}\nStarted outside helm. Read-only.`}>{x.title}</span>}
                      meta={x.active ? 'live' : ago(x.lastModified)}
                      trailing={<i className="ph ph-eye" title="Read-only: started outside helm" style={{ fontSize: 12, color: 'var(--text-3)' }} />}
                      selected={route.screen === 'external' && route.id === x.id}
                      onClick={() => go({ screen: 'external', repoId: r.id, id: x.id })} /></div>
                  ))}
                  {all.length > shown.length ? <div onClick={() => go({ screen: 'repo', id: r.id, tab: 'external' })} className="helm-row-hover" style={{ padding: '4px 8px 6px 40px', font: '400 11.5px/1.3 var(--font-sans)', color: 'var(--text-3)', cursor: 'pointer', borderRadius: 4 }}>{all.length - shown.length} more external</div> : null}
                </>;
              })() : null}
              {sessions.length === 0 && !extList(r.id).length ? <div style={{ padding: '4px 0 6px 42px', font: '400 12px/1.3 var(--font-sans)', color: 'var(--text-3)' }}>No sessions</div> : null}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 'none', padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PlanMeters />
        <TreeItem icon="gear-six" label="Settings" selected={route.screen === 'settings'} onClick={() => go({ screen: 'settings' })} style={{ margin: '0 -6px' }} />
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
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
        <span style={{ flex: 1, textAlign: 'left' }}>Search sessions and repositories</span>
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
  const extLive = useUI((u) => Object.values(u.externals).reduce((n, l) => n + l.filter((x) => x.active).length, 0));
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 8px', color: 'var(--text-3)' };
  const dot = (c: string) => <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-' + c + ')' }} />;
  const tok = t.tokens >= 1e6 ? (t.tokens / 1e6).toFixed(2) + 'M' : t.tokens >= 1e3 ? Math.round(t.tokens / 1e3) + 'k' : String(t.tokens);
  return (
    <div style={{ height: 'var(--statusbar-h)', flex: 'none', display: 'flex', alignItems: 'center', padding: '0 6px', borderTop: '1px solid var(--border)', background: 'var(--bg-sidebar)', font: '400 11px/1 var(--font-mono)' }}>
      <span style={item}>{dot('working')}{t.working} working</span>
      <span style={item}>{dot('attention')}{t.attention} need you</span>
      <span style={item}>{dot('ready')}{t.ready} ready</span>
      {extLive ? <span style={item} title="Claude Code sessions running outside helm. Read-only."><i className="ph ph-eye" style={{ fontSize: 12 }} />{extLive} external live</span> : null}
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
  const font = useApp().settings.editorFont;
  const el = React.useRef<HTMLDivElement>(null);
  const term = React.useRef<Terminal | null>(null);
  React.useEffect(() => {
    const t = new Terminal({ fontFamily: fontStack(font), fontSize: 12, lineHeight: 1.4, cursorBlink: true, allowProposedApi: true, theme: {} });
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
    if (term.current) { term.current.options.fontFamily = fontStack(font); }
  }, [font]);
  React.useEffect(() => {
    // Parent effects set data-theme after this one runs, so read the tokens on the next tick.
    const t = setTimeout(() => {
      if (!term.current) return;
      term.current.options.theme = { background: cssVar('--bg-editor'), foreground: cssVar('--text-1'), cursor: cssVar('--text-2'), selectionBackground: cssVar('--accent-muted') };
    }, 0);
    return () => clearTimeout(t);
  }, [themeKey, sessionId]);
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
        <span style={tabStyle(tab === 'shell')} onClick={() => setTab('shell')}><i className="ph ph-terminal-window" style={{ fontSize: 13 }} />{sessionId && !sessionId.startsWith('repo:') ? 'shell · ' + sessionId : 'shell'}</span>
        {sessionId && !sessionId.startsWith('repo:') ? <span style={tabStyle(tab === 'agent')} onClick={() => setTab('agent')}><i className="ph ph-robot" style={{ fontSize: 13 }} />agent output</span> : null}
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
