import { inbox } from '@shared/inbox';
import { sessionTitle } from '@shared/types';
import React from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, on, platform, windowControls } from '../api';
import { fontStack } from '../fonts';
import glyph from '../assets/helm-glyph-violet.svg';
import { ago, elapsed, fmtTokens, isFreeGroup, lifetimeTokens, livePlan, reposWithSessions, runningSubagents, subagentTree, totals, untilReset } from '../lib';
import { getUI, go, haltAll, isResumable, refreshExternals, resumeAll, setUI, toast, useApp, useMoney, useUI, useTranscript, type Route } from '../store';
import { InboxPreview } from './InboxPreview';
import { useShortcutKeys } from '../shortcuts';
import { Avatar, Badge, Breadcrumbs, ContextMenu, Grip, Hint, IconButton, Kbd, Meter, TreeItem, useNarrow, usePaneWidth, type MenuItem } from '../ui';

const mac = () => platform() === 'darwin';

function SectionLabel({ children, action }: any) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 26, padding: '0 4px 0 10px', marginTop: 10 }}>
      <span style={{ flex: 1, font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{children}</span>
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

/** `drawer`: shown over the content on a phone. It fills the drawer, has a close button, and cannot be resized or dragged. */
export function Sidebar({ drawer = false }: { drawer?: boolean }) {
  const app = useApp();
  const working = app.sessions.filter((s) => s.status === 'working').length;
  const paused = app.sessions.filter(isResumable).length;
  const route = useUI((u) => u.route);
  const [closed, setClosed] = React.useState<Record<string, boolean>>({});
  const [subsClosed, setSubsClosed] = React.useState<Record<string, boolean>>({});
  const [subsShown, setSubsShown] = React.useState<Record<string, boolean>>({});
  const [width, grip, resetWidth] = usePaneWidth('sidebar', 240, 180, 440);
  const t = totals(app);
  const inboxCount = inbox(app.sessions).filter((i) => i.kind !== 'queued' && i.kind !== 'stuck' && i.kind !== 'artifact').length;
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
      { label: s.free ? 'Copy folder path' : 'Copy branch name', icon: 'copy', separator: true, onClick: () => void api.copyText(s.free ? s.worktree : s.branch) },
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
  const dnd = (kind: 'repo' | 'session', id: string, repoId?: string) => drawer ? {} : ({
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
    <aside className={drawer ? "helm-drawer" : undefined} style={{ position: 'relative', width: drawer ? '100%' : width, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--bg-sidebar)', borderRight: '1px solid var(--border)' }}>
      {drawer ? null : <Grip onMouseDown={grip} onDoubleClick={resetWidth} />}
      <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: drawer ? '0 6px 0 14px' : '0 14px 0 ' + (windowControls() === 'left' ? 78 : 14) + 'px' }}>
        <span style={{ marginLeft: drawer ? 0 : 'auto', marginRight: drawer || windowControls() === 'left' ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <img src={glyph} width="22" height="22" alt="" />
          <span style={{ font: '600 14px/1.5 var(--font-mono)', letterSpacing: '-0.02em', position: 'relative', top: '0.14em' }}>helm</span>
        </span>
        {drawer ? <><span style={{ flex: 1 }} /><IconButton icon="x" label="Close menu" onClick={() => setUI({ drawer: false })} /></> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '4px 6px 8px' }}>
        <TreeItem icon="squares-four" label="Overview" selected={route.screen === 'overview' && !(route as any).filter} onClick={() => go({ screen: 'overview' })} />
        <TreeItem icon="tray" label="Inbox" selected={route.screen === 'inbox'} onClick={() => go({ screen: 'inbox' })}
          trailing={inboxCount ? <Badge tone="attention" mono>{inboxCount}</Badge> : null} />
        <TreeItem icon="pulse" label="Activity" selected={route.screen === 'activity'} onClick={() => go({ screen: 'activity' })} />
        <TreeItem icon="chart-line-up" label="Reports" selected={route.screen === 'reports'} onClick={() => go({ screen: 'reports' })} />
        <TreeItem icon="archive" label="Archive" selected={route.screen === 'archive'} onClick={() => go({ screen: 'archive' })} trailing={archivedCount ? <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{archivedCount}</span> : null} />
        <SectionLabel action={<><IconButton icon="archive" label={showArchived ? 'Hide archived sessions' : 'Show archived sessions'} size="sm" active={showArchived} onClick={toggleArchived} /><Hint id="add-repo" side="right" title="Add a repository" text="Start here: pick a GitHub repository for agents to work in."><IconButton icon="plus" label="Add repository" size="sm" onClick={() => setUI({ adding: true })} /></Hint></>}>Repositories</SectionLabel>
        {app.repos.length === 0 ? <div style={{ padding: '4px 10px 6px', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No repositories yet. Use + to add one from GitHub.</div> : null}
        {reposWithSessions(app, showArchived).map(({ repo: r, sessions }) => {
          const open = !closed[r.id];
          return (
            <div key={r.id} {...target('repo', r.id)} style={line(r.id)}>
              <div {...(isFreeGroup(r) ? {} : dnd('repo', r.id))} onContextMenu={(e) => { if (!isFreeGroup(r)) repoMenu(e, r); }}>
              <TreeItem icon={isFreeGroup(r) ? 'robot' : 'book-bookmark'} expandable={sessions.length > 0} expanded={open}
                label={isFreeGroup(r) ? <span title="Agents that are not tied to a repository">Free agents</span> : <span>{app.settings.showOwner ? <span style={{ color: 'var(--text-3)' }}>{r.owner}/</span> : null}{r.name}</span>}
                selected={!isFreeGroup(r) && route.screen === 'repo' && route.id === r.id} meta={sessions.length || null}
                trailing={isFreeGroup(r) ? (app.settings.freeAgents ? <IconButton icon="plus" label="New free agent" size="sm" onClick={(e: any) => { e.stopPropagation(); setUI({ newSession: { repoId: '@free' } }); }} /> : null) : lifetimeTokens(app.lifetime[r.id]) ? <span title={`${lifetimeTokens(app.lifetime[r.id]).toLocaleString()} tokens used in ${r.name} over its lifetime, including deleted sessions`} style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)', flex: 'none', marginLeft: 6 }}>{fmtTokens(lifetimeTokens(app.lifetime[r.id]))}</span> : null}
                onClick={() => { if (isFreeGroup(r) || (route.screen === 'repo' && route.id === r.id)) setClosed({ ...closed, [r.id]: open }); else go({ screen: 'repo', id: r.id }); }} />
              </div>
              {open ? sessions.map((s) => {
                const hiddenSubs = (s.subagents || []).filter((a) => a.archived).length;
                const showHidden = !!subsShown[s.id] || !!(route.screen === 'session' && route.id === s.id && route.sub && s.subagents.find((a) => a.id === route.sub && a.archived));
                const tree = subagentTree(s, showHidden);
                const running = runningSubagents(s);
                const subsOpen = !subsClosed[s.id];
                return (
                  <div key={s.id} {...target('session', s.id, r.id)} style={line(s.id)}>
                    <div {...dnd('session', s.id, r.id)} onContextMenu={(e) => sessionMenu(e, s)}>
                    <TreeItem depth={1} status={s.status} label={sessionTitle(s)} expandable={tree.length > 0 || hiddenSubs > 0} expanded={subsOpen} style={s.archivedAt ? { opacity: 0.6 } : undefined} trailing={s.archivedAt ? <i className="ph ph-archive" title="Archived" style={{ fontSize: 12, color: 'var(--text-3)' }} /> : s.stuck ? <i className="ph ph-warning" title={'Looks stuck: ' + s.stuck} style={{ fontSize: 12, color: 'var(--status-attention-text)' }} /> : null}
                      meta={running ? <span style={{ color: 'var(--status-working-text)', display: 'inline-flex', alignItems: 'center', gap: 3 }}><i className="ph ph-tree-structure" style={{ fontSize: 11 }} />{running}</span> : elapsed(s.startedAt, s.endedAt)}
                      selected={route.screen === 'session' && route.id === s.id && !route.sub}
                      onClick={() => {
                        const here = route.screen === 'session' && route.id === s.id && !route.sub;
                        if (here && (tree.length || hiddenSubs)) setSubsClosed({ ...subsClosed, [s.id]: subsOpen });
                        else go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' });
                      }} />
                    </div>
                    {subsOpen ? tree.map(({ a, depth }) => (
                      <TreeItem key={a.id} depth={2 + depth} status={subStatus(a.status)} label={a.description} meta={a.tools + ' tools'}
                        selected={route.screen === 'session' && route.id === s.id && route.sub === a.id}
                        onClick={() => go({ screen: 'session', id: s.id, tab: 'conversation', sub: a.id })} />
                    )) : null}
                    {subsOpen && hiddenSubs ? (
                      <div onClick={() => setSubsShown({ ...subsShown, [s.id]: !showHidden })} className="helm-row-hover" title="Subagents that handed back without changing any files are tidied away"
                        style={{ padding: '3px 8px 3px 62px', font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)', cursor: 'pointer', borderRadius: 4 }}>{showHidden ? 'Hide handed-back subagents' : `${hiddenSubs} handed back`}</div>
                    ) : null}
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
                  {all.length > shown.length ? <div onClick={() => go({ screen: 'repo', id: r.id, tab: 'external' })} className="helm-row-hover" style={{ padding: '4px 8px 6px 40px', font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)', cursor: 'pointer', borderRadius: 4 }}>{all.length - shown.length} more external</div> : null}
                </>;
              })() : null}
              {sessions.length === 0 && !extList(r.id).length ? <div style={{ padding: '4px 0 6px 42px', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>No sessions</div> : null}
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
  const searchKeys = useShortcutKeys('palette');
  const working = app.sessions.filter((s) => s.status === 'working').length;
  const paused = app.sessions.filter(isResumable).length;
  const narrow = useNarrow();
  return (
    <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none', display: 'flex', alignItems: 'center', gap: narrow ? 6 : 12, padding: '0 ' + (windowControls() === 'right' ? 150 : 10) + 'px 0 ' + (narrow ? 8 : 16) + 'px', borderBottom: '1px solid var(--border)', background: 'var(--bg-app)' }}>
      {narrow ? <IconButton size="lg" icon="list" label="Menu" onClick={() => setUI({ drawer: !getUI().drawer })} /> : null}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: '3px 0' }}><Breadcrumbs items={crumbs || []} compact={narrow} style={narrow ? { font: '500 17px/1.5 var(--font-sans)' } : undefined} /></div>
      {narrow ? <IconButton size="lg" icon="magnifying-glass" label="Search" onClick={() => setUI({ palette: true })} /> : <Hint id="search" title="Search anything" text="Jump to any session or repository, and run commands, from here." style={{ flex: "none" }}><button type="button" onClick={() => setUI({ palette: true })} style={{ width: 340, height: 26, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 10px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-3)', font: '400 12px/1.5 var(--font-sans)', cursor: 'pointer' }}>
        <i className="ph ph-magnifying-glass" style={{ fontSize: 13 }} />
        <span style={{ flex: 1, textAlign: 'left' }}>Search sessions and repositories</span>
        <Kbd keys={searchKeys} />
      </button></Hint>}
      <div style={{ flex: narrow ? 'none' : 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2 }}>
        <Hint id="play-pause" title="Pause and continue everything" text="Interrupt every working agent in one go, then continue them all when you are ready.">
          <span style={{ display: 'inline-flex', gap: 2 }}>
            <IconButton size={narrow ? 'lg' : 'md'} icon="plus" label="New session" accent onClick={() => { const r = getUI().route; setUI({ newSession: r.screen === 'repo' ? { repoId: r.id } : {} }); }} />
            <IconButton size={narrow ? 'lg' : 'md'} icon="play" label={paused ? `Continue all agents (${paused} interrupted)` : 'Continue all agents: none were interrupted'} disabled={!paused} hoverColor="var(--status-ready-text)" onClick={() => void resumeAll()} />
            <IconButton size={narrow ? 'lg' : 'md'} icon="pause" label={working ? `Interrupt all agents (${working} working)` : 'Interrupt all agents: none are working'} disabled={!working} hoverColor="var(--status-error-text)" onClick={() => void haltAll()} />
          </span>
        </Hint>
        <Hint id="inbox" title="Your inbox" text="Approvals, questions and finished work that need you collect here."><InboxPreview size={narrow ? 'lg' : 'md'} /></Hint>
        {narrow ? null : <>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
          <span style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 6px' }} />
          <Avatar name={app.user?.login || '?'} src={app.user?.avatar || undefined} size={22} />
        </>}
      </div>
    </div>
  );
}

export function StatusBar() {
  const app = useApp();
  const term = useUI((u) => u.term);
  const t = totals(app);
  const extLive = useUI((u) => Object.values(u.externals).reduce((n, l) => n + l.filter((x) => x.active).length, 0));
  const narrow = useNarrow();
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 8px', color: 'var(--text-3)' };
  const dot = (c: string) => <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--status-' + c + ')' }} />;
  const tok = t.tokens >= 1e6 ? (t.tokens / 1e6).toFixed(2) + 'M' : t.tokens >= 1e3 ? Math.round(t.tokens / 1e3) + 'k' : String(t.tokens);
  // A phone has room for the three counts and today's tokens; the terminal needs a keyboard and the Claude version can wait for Settings.
  if (narrow) return (
    <div style={{ height: 'var(--statusbar-h)', flex: 'none', display: 'flex', alignItems: 'center', padding: '0 4px', borderTop: '1px solid var(--border)', background: 'var(--bg-sidebar)', font: '400 11px/1.5 var(--font-mono)', overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <span style={item} title="Working">{dot('working')}{t.working}</span>
      <span style={item} title="Need you">{dot('attention')}{t.attention}</span>
      <span style={item} title="Ready for review">{dot('ready')}{t.ready}</span>
      {extLive ? <span style={item} title="Claude Code sessions running outside helm. Read-only."><i className="ph ph-eye" style={{ fontSize: 12 }} />{extLive}</span> : null}
      <span style={{ flex: 1 }} />
      <span style={item}>{tok} tokens today</span>
    </div>
  );
  return (
    <div style={{ height: 'var(--statusbar-h)', flex: 'none', display: 'flex', alignItems: 'center', padding: '0 6px', borderTop: '1px solid var(--border)', background: 'var(--bg-sidebar)', font: '400 11px/1.5 var(--font-mono)' }}>
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

/** A real shell in a pty, rooted in the workspace (a session id, `repo:<id>`, or null for the home folder). */
function XTerm({ target, themeKey, visible, onTitle, onExit, handle }: { target: string | null; themeKey: string; visible: boolean; onTitle(t: string): void; onExit(): void; handle: React.MutableRefObject<TermHandle | null> }) {
  const font = useApp().settings.editorFont;
  const el = React.useRef<HTMLDivElement>(null);
  const term = React.useRef<Terminal | null>(null);
  const fitRef = React.useRef<FitAddon | null>(null);
  const searchRef = React.useRef<SearchAddon | null>(null);
  const [find, setFind] = React.useState<string | null>(null);
  const cb = React.useRef({ onTitle, onExit });
  cb.current = { onTitle, onExit };
  React.useEffect(() => {
    const t = new Terminal({ fontFamily: fontStack(font), fontSize: 12, lineHeight: 1.4, cursorBlink: true, allowProposedApi: true, scrollback: 10000, macOptionIsMeta: true, theme: {} });
    const fit = new FitAddon();
    const search = new SearchAddon();
    t.loadAddon(fit);
    t.loadAddon(search);
    t.loadAddon(new WebLinksAddon((_e, uri) => { void api.openExternal(uri); }));
    t.open(el.current!);
    term.current = t; fitRef.current = fit; searchRef.current = search;
    // xterm sends a literal ^V for Ctrl+V and never pastes, so paste and copy are done here: Ctrl/Cmd+V pastes, Ctrl/Cmd+C copies a
    // selection (with nothing selected it still interrupts), and so do Ctrl+Shift+V and Ctrl+Shift+C.
    const pasteIn = () => api.readClipboard().then((text) => { if (text) t.paste(text); }).catch(() => undefined);
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey) || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === 'v') { e.preventDefault(); void pasteIn(); return false; }
      if (k === 'c' && (e.shiftKey || t.hasSelection())) { e.preventDefault(); if (t.hasSelection()) void api.copyText(t.getSelection()); return false; }
      if (k === 'f' && (e.shiftKey || e.metaKey)) { e.preventDefault(); setFind(t.getSelection() || ''); return false; }
      if (k === 'k' && e.metaKey) { e.preventDefault(); t.clear(); return false; }
      return true;
    });
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (t.hasSelection()) { void api.copyText(t.getSelection()); t.clearSelection(); } else void pasteIn();
    };
    el.current!.addEventListener('contextmenu', onContext);
    let id: string | null = null;
    let dead = false;
    const doFit = () => { try { if (!el.current!.offsetHeight) return; fit.fit(); if (id) void api.termResize(id, t.cols, t.rows); } catch { /* hidden */ } };
    doFit();
    api.termOpen(target, t.cols, t.rows).then((tid) => {
      if (dead) { void api.termClose(tid); return; }
      id = tid;
      t.onData((d) => void api.termWrite(tid, d));
      doFit();
    }).catch((e) => t.write(`\x1b[31mCould not start a shell: ${String(e?.message || e)}\x1b[0m\r\n`));
    handle.current = { run: (text) => { if (id) void api.termWrite(id, text); }, focus: () => t.focus(), refit: doFit };
    const offT = t.onTitleChange((x) => cb.current.onTitle(x));
    const offD = on('termData', (p) => { if (p.id === id) t.write(p.data); });
    const offE = on('termExit', (p) => { if (p.id === id) { id = null; cb.current.onExit(); } });
    const ro = new ResizeObserver(doFit);
    ro.observe(el.current!);
    const host = el.current!;
    return () => { dead = true; offD(); offE(); offT.dispose(); ro.disconnect(); host.removeEventListener('contextmenu', onContext); if (id) void api.termClose(id); handle.current = null; t.dispose(); };
  }, [target]);
  React.useEffect(() => {
    if (term.current) { term.current.options.fontFamily = fontStack(font); fitRef.current?.fit(); }
  }, [font]);
  React.useEffect(() => { if (visible) { fitRef.current?.fit(); term.current?.focus(); } }, [visible]);
  React.useEffect(() => {
    // Parent effects set data-theme after this one runs, so read the tokens on the next tick.
    const t = setTimeout(() => {
      if (!term.current) return;
      term.current.options.theme = { background: cssVar('--bg-editor'), foreground: cssVar('--text-1'), cursor: cssVar('--text-2'), selectionBackground: cssVar('--accent-muted') };
    }, 0);
    return () => clearTimeout(t);
  }, [themeKey, target]);
  const closeFind = () => { setFind(null); searchRef.current?.clearDecorations(); term.current?.focus(); };
  return (
    <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', background: 'var(--bg-editor)' }}>
      <div ref={el} style={{ flex: 1, minWidth: 0, overflow: 'hidden', padding: '2px 0 0 8px' }} />
      {find !== null ? (
        <div style={{ position: 'absolute', top: 4, right: 14, display: 'flex', gap: 4, padding: 4, background: 'var(--bg-raised, var(--bg-app))', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-dialog)' }}>
          <input autoFocus value={find} placeholder="Find" onChange={(e) => { setFind(e.target.value); searchRef.current?.findNext(e.target.value, { incremental: true }); }}
            onKeyDown={(e) => { if (e.key === 'Escape') closeFind(); else if (e.key === 'Enter') (e.shiftKey ? searchRef.current?.findPrevious(find) : searchRef.current?.findNext(find)); }}
            style={{ width: 160, font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-1)', background: 'transparent', border: 'none', outline: 'none' }} />
          <IconButton icon="caret-up" label="Previous" size="sm" onClick={() => searchRef.current?.findPrevious(find)} />
          <IconButton icon="caret-down" label="Next" size="sm" onClick={() => searchRef.current?.findNext(find)} />
          <IconButton icon="x" label="Close" size="sm" onClick={closeFind} />
        </div>
      ) : null}
    </div>
  );
}

interface TermHandle { run(text: string): void; focus(): void; refit(): void }
interface TermTab { key: number; target: string | null; title: string; label: string; exited: boolean }

/** Single-quote a path for the shell the command is typed into. */
export const cdCommand = (path: string, windows: boolean) => (windows ? `cd "${path}"\r` : `cd '${path.replace(/'/g, `'\\''`)}'\r`);

let tabKey = 0;

export function TerminalDrawer({ height: initial = 260, visible = true, onClose, sessionId, themeKey }: { height?: number; visible?: boolean; onClose(): void; sessionId: string | null; themeKey: string; }) {
  const app = useApp();
  const [height, setHeight] = React.useState(initial);
  const [view, setView] = React.useState<'shell' | 'agent'>('shell');
  const [tabs, setTabs] = React.useState<TermTab[]>([]);
  const [activeKey, setActiveKey] = React.useState(-1);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const handles = React.useRef(new Map<number, React.MutableRefObject<TermHandle | null>>());
  const tr = useTranscript(sessionId || '') || [];
  const bash = tr.filter((e) => e.k === 'bash') as any[];
  const hasAgent = !!sessionId && !sessionId.startsWith('repo:');
  const windows = platform() === 'win32';

  const labelFor = React.useCallback((target: string | null) => {
    if (!target) return 'home';
    if (target.startsWith('repo:')) return target.slice(5).split('/').pop() || target;
    const s = app.sessions.find((x) => x.id === target);
    return s ? sessionTitle(s) : target;
  }, [app.sessions]);
  const add = React.useCallback((target: string | null) => {
    const key = ++tabKey;
    setTabs((t) => [...t, { key, target, title: '', label: labelFor(target), exited: false }]);
    setActiveKey(key); setView('shell');
  }, [labelFor]);
  const close = (key: number) => {
    const i = tabs.findIndex((x) => x.key === key);
    const rest = tabs.filter((x) => x.key !== key);
    handles.current.delete(key);
    setTabs(rest);
    if (key === activeKey) setActiveKey(rest[Math.min(i, rest.length - 1)]?.key ?? -1);
    if (rest.length === 0) onClose();
  };
  // Opening the terminal starts a shell in whatever you are looking at, and closing the last tab leaves nothing behind.
  React.useEffect(() => { if (visible && tabs.length === 0) add(sessionId); }, [visible, tabs.length]);
  React.useEffect(() => { if (visible) handles.current.get(activeKey)?.current?.refit(); }, [height, activeKey, visible]);

  // Keyboard: Ctrl+Shift+T new tab, Ctrl+Shift+W close it, Ctrl+Tab / Ctrl+Shift+Tab (or Ctrl+PageUp/Down) switch.
  React.useEffect(() => {
    if (!visible) return;
    const h = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === 't') { e.preventDefault(); add(sessionId); }
      else if (e.shiftKey && k === 'w') { e.preventDefault(); close(activeKey); }
      else if (k === 'tab' || k === 'pagedown' || k === 'pageup') {
        if (tabs.length < 2) return;
        e.preventDefault();
        const back = k === 'pageup' || (k === 'tab' && e.shiftKey);
        const i = tabs.findIndex((x) => x.key === activeKey);
        setActiveKey(tabs[(i + (back ? -1 : 1) + tabs.length) % tabs.length].key);
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [visible, tabs, activeKey, sessionId, add]);

  /** Every place worth jumping to: this session, then the repositories, then the live sessions of each, then home. */
  const places = (): { label: string; hint?: string; icon: string; target: string | null; separator?: boolean }[] => {
    const out: { label: string; hint?: string; icon: string; target: string | null; separator?: boolean }[] = [];
    const seen = new Set<string | null>();
    const push = (p: { label: string; hint?: string; icon: string; target: string | null }, sep = false) => { if (!seen.has(p.target)) { seen.add(p.target); out.push({ ...p, separator: sep && out.length > 0 }); } };
    if (sessionId) push({ label: 'This workspace', hint: labelFor(sessionId), icon: 'crosshair', target: sessionId });
    app.repos.forEach((r, i) => push({ label: r.name, hint: r.owner, icon: 'git-branch', target: 'repo:' + r.id }, i === 0));
    app.sessions.filter((s) => !s.archivedAt).forEach((s, i) => push({ label: sessionTitle(s), hint: s.repoId.split('/').pop(), icon: 'tree-structure', target: s.id }, i === 0));
    push({ label: 'Home folder', icon: 'house', target: null }, true);
    return out;
  };
  const openMenu = (e: React.MouseEvent, mode: 'new' | 'jump') => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = places().map((p) => ({
      label: p.hint ? `${p.label}  ·  ${p.hint}` : p.label, icon: p.icon, separator: p.separator,
      onClick: () => {
        if (mode === 'new') { add(p.target); return; }
        // Jump: `cd` in the shell you are in. Only a workspace has a path the renderer knows; the rest open a tab.
        const path = !p.target ? null : p.target.startsWith('repo:') ? app.repos.find((x) => 'repo:' + x.id === p.target)?.localPath : app.sessions.find((x) => x.id === p.target)?.worktree;
        if (path) { handles.current.get(activeKey)?.current?.run(cdCommand(path, windows)); handles.current.get(activeKey)?.current?.focus(); }
        else add(p.target);
      }
    }));
    setMenu({ x: r.left, y: r.top - 4 - items.length * 30, items });
  };

  const tabStyle = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 6, height: '100%', padding: '0 8px 0 10px', cursor: 'pointer', maxWidth: 200, font: '400 11.5px/1.5 var(--font-mono)', color: on ? 'var(--text-1)' : 'var(--text-3)', boxShadow: on ? 'inset 0 -1px 0 var(--accent)' : 'none' });
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = height;
    const move = (m: MouseEvent) => setHeight(Math.max(120, Math.min(window.innerHeight - 160, h0 + (y0 - m.clientY))));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return (
    <div style={{ height, flex: 'none', display: visible ? 'flex' : 'none', flexDirection: 'column', borderTop: '1px solid var(--border)', background: 'var(--bg-editor)', position: 'relative' }}>
      <div onMouseDown={startDrag} style={{ position: 'absolute', top: -3, left: 0, right: 0, height: 6, cursor: 'ns-resize', zIndex: 5 }} />
      <div style={{ height: 30, flex: 'none', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px 0 4px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', height: '100%', minWidth: 0, overflowX: 'auto' }}>
          {tabs.map((t) => (
            <span key={t.key} style={tabStyle(view === 'shell' && t.key === activeKey)} onClick={() => { setActiveKey(t.key); setView('shell'); }}
              onAuxClick={(e) => { if (e.button === 1) close(t.key); }} title={t.title || t.label}>
              <i className="ph ph-terminal-window" style={{ fontSize: 13, flex: 'none', opacity: t.exited ? 0.5 : 1 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: t.exited ? 'line-through' : 'none' }}>{t.label}</span>
              <i className="ph ph-x" onClick={(e) => { e.stopPropagation(); close(t.key); }} style={{ fontSize: 11, flex: 'none', opacity: 0.6 }} />
            </span>
          ))}
        </div>
        <IconButton icon="plus" label="New terminal (Ctrl+Shift+T)" size="sm" onClick={() => add(sessionId)} />
        <IconButton icon="caret-up" label="New terminal in…" size="sm" onClick={(e: any) => openMenu(e, 'new')} />
        <IconButton icon="lightning" label="Jump to a project in this terminal" size="sm" onClick={(e: any) => openMenu(e, 'jump')} />
        {hasAgent ? <span style={tabStyle(view === 'agent')} onClick={() => setView('agent')}><i className="ph ph-robot" style={{ fontSize: 13 }} />agent output</span> : null}
        <span style={{ flex: 1 }} />
        <IconButton icon="caret-down" label="Minimise" size="sm" onClick={onClose} />
      </div>
      <div style={{ flex: 1, minHeight: 0, display: view === 'shell' ? 'flex' : 'none', position: 'relative' }}>
        {tabs.map((t) => {
          const handle = handles.current.get(t.key) || (() => { const r = { current: null as TermHandle | null }; handles.current.set(t.key, r); return r; })();
          const on = t.key === activeKey && view === 'shell' && visible;
          return (
            <div key={t.key} style={{ position: 'absolute', inset: 0, display: on ? 'flex' : 'none' }}>
              <XTerm target={t.target} themeKey={themeKey} visible={on} handle={handle}
                onTitle={(title) => setTabs((all) => all.map((x) => (x.key === t.key ? { ...x, title } : x)))}
                onExit={() => setTabs((all) => all.map((x) => (x.key === t.key ? { ...x, exited: true } : x)))} />
              {t.exited ? (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: 'var(--bg-app)', borderTop: '1px solid var(--border-subtle)', font: '400 11.5px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>
                  Process exited.
                  <button type="button" onClick={() => { const target = t.target; close(t.key); add(target); }} style={{ font: 'inherit', color: 'var(--accent-text, var(--accent))', background: 'none', border: 'none', cursor: 'pointer' }}>Restart</button>
                  <button type="button" onClick={() => close(t.key)} style={{ font: 'inherit', color: 'var(--text-2)', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {view === 'agent' ? (
        <pre className="selectable" style={{ flex: 1, minHeight: 0, overflow: 'auto', margin: 0, padding: '8px 14px', font: '400 12px/1.6 var(--font-mono)', color: 'var(--text-2)' }}>
          {bash.length === 0 ? <div style={{ color: 'var(--text-3)' }}>The agent has not run any commands yet.</div> : null}
          {bash.map((b, i) => (
            <div key={i}><span style={{ color: 'var(--text-3)' }}>$ </span><span style={{ color: 'var(--text-1)' }}>{b.cmd}</span>
              {b.done ? <div style={{ color: b.ok ? 'var(--diff-add-fg)' : 'var(--diff-del-fg)' }}>{b.out} <span style={{ color: 'var(--text-3)' }}>{b.meta}</span></div> : <div style={{ color: 'var(--status-working-text)' }}>running…</div>}</div>
          ))}
        </pre>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

export type { Route };
