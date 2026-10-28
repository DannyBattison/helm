import React from 'react';
import { api, platform } from './api';
import { dataStack, fontStack, uiStack } from './fonts';
import { setTimeFormat, theme as resolveTheme } from './lib';
import { schemeVars } from '@shared/schemes';
import { dismissToast, getUI, go, haltAll, init, resumeAll, setUI, useUI } from './store';
import { Button, Toast, useNarrow } from './ui';
import { isShortcut } from './shortcuts';
import { Activity, Dashboard } from './views/Dashboard';
import { AddRepo, AgentLoginGate, DeleteSession, MergePr, NewSession, Palette, RemoveRepo, RenameSession, SignIn } from './views/Dialogs';
import { Archive } from './views/Archive';
import { AddAgentHost } from './views/Panel';
import { Reports } from './views/Reports';
import { Inbox } from './views/Inbox';
import { Compare, CheckpointsDialog, ContinueDialog, ForkDialog, RememberDialog, RestoreDialog } from './views/Review';
import { ExternalSessionView, Repo } from './views/Repo';
import { Session } from './views/Session';
import { Settings } from './views/Settings';
import { sessionTitle } from '@shared/types';
import { Sidebar, StatusBar, TerminalDrawer, TitleBar } from './views/Shell';

/** Whether the start page has been chosen yet this run. */
let startedOn = false;

/** The new session dialog's starting point for the page you are on: the repository of a repository page or of a session. */
function repoHere(): { repoId?: string } {
  const { route, app } = getUI();
  if (route.screen === 'repo') return { repoId: route.id };
  if (route.screen === 'external') return { repoId: route.repoId };
  if (route.screen === 'session') { const s = app?.sessions.find((x) => x.id === route.id); return s && !s.free ? { repoId: s.repoId } : {}; }
  return {};
}

/** Opens the session after (or before) the current one among those not archived; `attentionOnly` skips those that are not waiting for you. */
function stepSession(dir: 1 | -1, attentionOnly: boolean) {
  const { route, app } = getUI();
  const list = (app?.sessions || []).filter((s) => !s.archivedAt && (!attentionOnly || s.status === 'attention' || s.id === (route.screen === 'session' ? route.id : '')));
  if (!list.length) return;
  const at = route.screen === 'session' ? list.findIndex((s) => s.id === route.id) : -1;
  const next = list[at < 0 ? (dir === 1 ? 0 : list.length - 1) : (at + dir + list.length) % list.length];
  if (next && !(next.id === (route.screen === 'session' ? route.id : '') && list.length === 1)) go({ screen: 'session', id: next.id });
}

export function App() {
  const app = useUI((u) => u.app);
  const fatal = useUI((u) => u.fatal);
  const route = useUI((u) => u.route);
  const adding = useUI((u) => u.adding);
  const newSession = useUI((u) => u.newSession);
  const palette = useUI((u) => u.palette);
  const deleting = useUI((u) => u.deleting);
  const renaming = useUI((u) => u.renaming);
  const checkpointsOf = useUI((u) => u.checkpointsOf);
  const restoring = useUI((u) => u.restoring);
  const forking = useUI((u) => u.forking);
  const continuing = useUI((u) => u.continuing);
  const remembering = useUI((u) => u.remembering);
  const mergingPr = useUI((u) => u.mergingPr);
  const removingRepo = useUI((u) => u.removingRepo);
  const term = useUI((u) => u.term);
  // Once opened the drawer stays mounted (hidden) so shells and tabs survive closing it and moving around.
  const termUsed = React.useRef(false);
  if (term) termUsed.current = true;
  const toasts = useUI((u) => u.toasts);
  const drawer = useUI((u) => u.drawer);
  const narrow = useNarrow();
  const [sysDark, setSysDark] = React.useState(0);
  // Edge swipe: `drag` is how far the drawer is pulled out (px) while a finger is on it, otherwise null.
  const [drag, setDrag] = React.useState<number | null>(null);
  const drawerW = Math.min(300, window.innerWidth * 0.86);
  React.useEffect(() => {
    if (!narrow) return;
    const W = Math.min(300, window.innerWidth * 0.86);
    let g: { x: number; y: number; open: boolean; live: boolean; last: number; t: number; v: number } | null = null;
    const start = (e: TouchEvent) => {
      const t = e.touches[0], open = !!getUI().drawer;
      if (e.touches.length !== 1 || (!open && t.clientX > 24)) { g = null; return; }
      g = { x: t.clientX, y: t.clientY, open, live: false, last: open ? W : 0, t: e.timeStamp, v: 0 };
    };
    const move = (e: TouchEvent) => {
      if (!g) return;
      const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
      if (!g.live) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; }
        if (Math.abs(dx) < 10) return;
        g.live = true;
      }
      const w = Math.max(0, Math.min(W, (g.open ? W : 0) + dx));
      g.v = (w - g.last) / Math.max(1, e.timeStamp - g.t);
      g.last = w; g.t = e.timeStamp;
      setDrag(w);
    };
    const end = () => {
      if (g?.live) setUI({ drawer: g.v > 0.3 || (Math.abs(g.v) <= 0.3 && g.last > W / 2) });
      g = null; setDrag(null);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', end);
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); document.removeEventListener('touchcancel', end); };
  }, [narrow]);

  React.useEffect(() => { void init(); }, []);
  // Opening a session restarts its idle timer.
  const openedSession = route.screen === 'session' ? route.id : '';
  React.useEffect(() => { if (openedSession) void api.touchSession(openedSession); }, [openedSession]);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => setSysDark((n) => n + 1);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);

  const pref = app?.settings.theme || 'dark';
  const theme = React.useMemo(() => resolveTheme(pref), [pref, sysDark]);
  React.useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const look = app?.settings;
  const lookKey = look ? JSON.stringify([look.colorScheme, look.accentColor, look.statusColors]) : '';
  React.useEffect(() => {
    if (!look) return;
    const vars = schemeVars({ scheme: look.colorScheme, accent: look.accentColor, status: look.statusColors }, theme === 'dark');
    const st = document.documentElement.style;
    for (const k of Object.keys(vars)) st.setProperty(k, vars[k]);
    return () => { for (const k of Object.keys(vars)) st.removeProperty(k); };
  }, [lookKey, theme]);
  setTimeFormat(app?.settings.timeFormat);
  // Where helm opens: the page you left, or a chosen one. Decided once, when the settings first arrive.
  const startPage = app?.settings.startPage;
  React.useEffect(() => {
    if (!startPage || startedOn) return;
    startedOn = true;
    if (startPage === 'overview') go({ screen: 'overview' });
    else if (startPage === 'inbox') go({ screen: 'inbox' });
  }, [startPage]);
  const codeFont = app?.settings.editorFont, uiFont = app?.settings.uiFont, dataFont = app?.settings.dataFont;
  React.useEffect(() => { if (codeFont) document.documentElement.style.setProperty('--font-code', fontStack(codeFont)); }, [codeFont]);
  React.useEffect(() => { if (uiFont) document.documentElement.style.setProperty('--font-sans', uiStack(uiFont)); }, [uiFont]);
  React.useEffect(() => { if (dataFont) document.documentElement.style.setProperty('--font-mono', dataStack(dataFont)); }, [dataFont]);
  const toggleTheme = () => void api.updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isShortcut(e, 'palette')) { e.preventDefault(); setUI({ palette: true }); }
      // Browsers reserve Cmd/Ctrl+N for a new window and often never deliver it, so Alt+N also works.
      else if (isShortcut(e, 'newSession') || isShortcut(e, 'newSessionAlt')) { e.preventDefault(); const r = getUI().route; setUI({ newSession: r.screen === 'repo' ? { repoId: r.id } : {} }); }
      else if (isShortcut(e, 'newSessionHere')) { e.preventDefault(); setUI({ newSession: repoHere() }); }
      else if (isShortcut(e, 'goOverview')) { e.preventDefault(); go({ screen: 'overview' }); }
      else if (isShortcut(e, 'goInbox')) { e.preventDefault(); go({ screen: 'inbox' }); }
      else if (isShortcut(e, 'goNeedsYou')) { e.preventDefault(); go({ screen: 'overview', filter: 'attention' }); }
      else if (isShortcut(e, 'goActivity')) { e.preventDefault(); go({ screen: 'activity' }); }
      else if (isShortcut(e, 'goSettings')) { e.preventDefault(); go({ screen: 'settings' }); }
      else if (isShortcut(e, 'nextAttention')) { e.preventDefault(); stepSession(1, true); }
      else if (isShortcut(e, 'prevSession')) { e.preventDefault(); stepSession(-1, false); }
      else if (isShortcut(e, 'nextSession')) { e.preventDefault(); stepSession(1, false); }
      else if (isShortcut(e, 'haltAll')) { e.preventDefault(); void haltAll(); }
      else if (isShortcut(e, 'resumeAll')) { e.preventDefault(); void resumeAll(); }
      else if (isShortcut(e, 'terminal')) { e.preventDefault(); setUI({ term: !getUI().term }); }
      else if (e.key === 'Escape') setUI({ palette: false, drawer: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pageTitle = (() => {
    const base = 'Helm';
    if (!app?.user) return base;
    const join = (...p: (string | undefined)[]) => [...p.filter(Boolean)].join(' - ') + ' | ' + base;
    switch (route.screen) {
      case 'session': { const s = app.sessions.find((x) => x.id === route.id); return s ? join(sessionTitle(s), s.free ? 'Free agents' : s.repoId) : join(route.id); }
      case 'external': return join(getUI().externals[route.repoId]?.find((e) => e.id === route.id)?.title || 'Claude Code session', route.repoId);
      case 'repo': return join(route.id);
      case 'settings': return join('Settings');
      case 'archive': return join('Archive');
      case 'inbox': return join('Inbox');
      case 'compare': return join('Compare runs');
      case 'reports': return join('Reports');
      case 'activity': return join('Activity');
      default: return join(route.filter === 'attention' ? 'Needs you' : 'Overview');
    }
  })();
  React.useEffect(() => { document.title = pageTitle; }, [pageTitle]);

  if (fatal) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>helm could not start: {fatal}</div>;
  if (!app) return <div style={{ height: '100%', display: 'grid', placeItems: 'center', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Loading…</div>;
  if (!app.user) return <SignIn />;

  let body: React.ReactNode;
  let crumbs: any[];
  if (route.screen === 'session') {
    const s = app.sessions.find((x) => x.id === route.id);
    const r = s && app.repos.find((x) => x.id === s.repoId);
    const subA = route.sub ? s?.subagents.find((x) => x.id === route.sub) : undefined;
    crumbs = [{ label: s?.free ? 'Free agents' : r?.id || 'Session', icon: s?.free ? 'robot' : 'book-bookmark', onClick: r && (() => go({ screen: 'repo', id: r.id })) }, subA ? { label: route.id, onClick: () => go({ screen: 'session', id: route.id, tab: 'conversation' }) } : route.id, ...(subA ? [{ label: subA.description, icon: 'tree-structure' }] : [])];
    body = <Session key={route.id} id={route.id} tab={route.tab || 'conversation'} sub={route.sub} file={route.file} line={route.line} msg={route.msg} setTab={(t) => go({ screen: 'session', id: route.id, tab: t })} themeKey={theme} />;
  } else if (route.screen === 'external') {
    const x = getUI().externals[route.repoId]?.find((e) => e.id === route.id);
    crumbs = [{ label: route.repoId, icon: 'book-bookmark', onClick: () => go({ screen: 'repo', id: route.repoId, tab: 'external' }) }, { label: x?.title || 'Claude Code session', icon: 'eye' }];
    body = <ExternalSessionView key={route.id} repoId={route.repoId} id={route.id} />;
  } else if (route.screen === 'repo') {
    crumbs = [{ label: route.id, icon: 'book-bookmark' }];
    body = <Repo key={route.id + ':' + (route.tab || '') + ':' + (route.hash || route.file || '')} id={route.id} tab={route.tab} hash={route.hash} file={route.file} line={route.line} themeKey={theme} />;
  } else if (route.screen === 'settings') {
    crumbs = [{ label: 'Settings', icon: 'gear-six' }];
    body = <Settings section={route.section} />;
  } else if (route.screen === 'archive') {
    crumbs = [{ label: 'Archive', icon: 'archive' }];
    body = <Archive />;
  } else if (route.screen === 'inbox') {
    crumbs = [{ label: 'Inbox', icon: 'tray' }];
    body = <Inbox />;
  } else if (route.screen === 'compare') {
    crumbs = [{ label: 'Compare runs', icon: 'columns' }];
    body = <Compare group={route.group} />;
  } else if (route.screen === 'reports') {
    crumbs = [{ label: 'Reports', icon: 'chart-line-up' }];
    body = <Reports tab={route.tab} />;
  } else if (route.screen === 'activity') {
    crumbs = [{ label: 'Activity', icon: 'pulse' }];
    body = <Activity />;
  } else {
    crumbs = [{ label: route.filter === 'attention' ? 'Needs you' : 'Overview', icon: route.filter === 'attention' ? 'bell-ringing' : 'squares-four' }];
    body = <Dashboard key={route.filter || 'all'} filter={route.filter} />;
  }
  const inCode = route.screen === 'session' && route.tab === 'code';
  // On a server where no agent is signed in yet, that comes first: the overlay covers the app and the app behind it is switched off.
  const needsClaude = app.agentLoginRequired && !!app.backends.length && !app.backends.some((b) => b.canSignIn && b.login?.loggedIn);

  return (
    <div style={{ position: 'relative', height: '100%', minWidth: 320, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'contents' }} {...(needsClaude ? { inert: true } : {})}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {narrow ? (drawer || drag !== null ? <>
          <div onClick={() => setUI({ drawer: false })} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.45)', ...(drag !== null ? { opacity: drag / drawerW } : { animation: 'helm-fade-in var(--dur-slow) var(--ease-out)' }) }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 41, width: drawerW, display: 'flex', boxShadow: 'var(--shadow-dialog)', ...(drag !== null ? { transform: `translateX(${drag - drawerW}px)` } : { animation: 'helm-drawer-in var(--dur-slow) var(--ease-out)' }) }}><Sidebar drawer /></div>
        </> : null) : <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
          <TitleBar crumbs={crumbs} theme={theme} setTheme={toggleTheme as any} />
          {body}
          {termUsed.current ? <TerminalDrawer visible={term && !inCode} sessionId={route.screen === 'session' ? route.id : route.screen === 'repo' ? 'repo:' + route.id : null} themeKey={theme} onClose={() => setUI({ term: false })} /> : null}
        </div>
      </div>
      <StatusBar />
      {adding ? <AddRepo onClose={() => setUI({ adding: false })} /> : null}
      {newSession ? <NewSession repoId={newSession.repoId} initial={newSession} onClose={() => setUI({ newSession: null })} /> : null}
      {removingRepo ? <RemoveRepo key={removingRepo} id={removingRepo} onClose={() => setUI({ removingRepo: null })} /> : null}
      {mergingPr ? <MergePr key={mergingPr.repoId + mergingPr.number} target={mergingPr} onClose={() => setUI({ mergingPr: null })} /> : null}
      {checkpointsOf ? <CheckpointsDialog key={checkpointsOf} id={checkpointsOf} onClose={() => setUI({ checkpointsOf: null })} /> : null}
      <AddAgentHost />
      {restoring ? <RestoreDialog key={restoring.sessionId + restoring.n} target={restoring} onClose={() => setUI({ restoring: null })} /> : null}
      {forking ? <ForkDialog key={forking.sessionId + forking.index} target={forking} onClose={() => setUI({ forking: null })} /> : null}
      {remembering ? <RememberDialog key={remembering.text} target={remembering} onClose={() => setUI({ remembering: null })} /> : null}
      {continuing ? <ContinueDialog key={continuing.externalId} target={continuing} onClose={() => setUI({ continuing: null })} /> : null}
      {renaming ? <RenameSession key={renaming} id={renaming} onClose={() => setUI({ renaming: null })} /> : null}
      {deleting ? <DeleteSession key={deleting} id={deleting} onClose={() => setUI({ deleting: null })} /> : null}
      {palette ? <Palette onClose={() => setUI({ palette: false })} toggleTheme={toggleTheme} /> : null}
      </div>
      {needsClaude ? <AgentLoginGate /> : null}
      <div style={{ position: 'absolute', right: narrow ? 8 : 16, left: narrow ? 8 : undefined, top: 'calc(var(--titlebar-h) + 8px)', zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
        {toasts.map((t) => (
          <Toast key={t.id} tone={t.tone} title={t.title} description={t.description} onClose={() => dismissToast(t.id)}
            actions={t.sessionId ? <>
              <Button size="sm" variant="primary" onClick={() => { dismissToast(t.id); go({ screen: 'session', id: t.sessionId!, tab: t.tab || 'conversation' }); }}>{t.tab === 'changes' ? 'Review' : 'Open'}</Button>
              <Button size="sm" variant="ghost" onClick={() => dismissToast(t.id)}>Later</Button>
            </> : undefined} />
        ))}
      </div>
    </div>
  );
}
