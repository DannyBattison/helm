import React from 'react';
import { api, platform } from './api';
import { dataStack, fontStack, uiStack } from './fonts';
import { theme as resolveTheme } from './lib';
import { dismissToast, getUI, go, init, setUI, useUI } from './store';
import { Button, Toast } from './ui';
import { Activity, Dashboard } from './views/Dashboard';
import { AddRepo, DeleteSession, MergePr, NewSession, Palette, RemoveRepo, RenameSession, SignIn } from './views/Dialogs';
import { Archive } from './views/Archive';
import { Reports } from './views/Reports';
import { Inbox } from './views/Inbox';
import { Compare, CheckpointsDialog, ContinueDialog, ForkDialog, RememberDialog, RestoreDialog } from './views/Review';
import { ExternalSessionView, Repo } from './views/Repo';
import { Session } from './views/Session';
import { Settings } from './views/Settings';
import { Sidebar, StatusBar, TerminalDrawer, TitleBar } from './views/Shell';

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
  const toasts = useUI((u) => u.toasts);
  const [sysDark, setSysDark] = React.useState(0);

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
  const codeFont = app?.settings.editorFont, uiFont = app?.settings.uiFont, dataFont = app?.settings.dataFont;
  React.useEffect(() => { if (codeFont) document.documentElement.style.setProperty('--font-code', fontStack(codeFont)); }, [codeFont]);
  React.useEffect(() => { if (uiFont) document.documentElement.style.setProperty('--font-sans', uiStack(uiFont)); }, [uiFont]);
  React.useEffect(() => { if (dataFont) document.documentElement.style.setProperty('--font-mono', dataStack(dataFont)); }, [dataFont]);
  const toggleTheme = () => void api.updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });

  React.useEffect(() => {
    const mac = platform() === 'darwin';
    const onKey = (e: KeyboardEvent) => {
      const m = mac ? e.metaKey : e.ctrlKey;
      if (m && e.key.toLowerCase() === 'k') { e.preventDefault(); setUI({ palette: true }); }
      else if (m && e.key.toLowerCase() === 'n') { e.preventDefault(); const r = getUI().route; setUI({ newSession: r.screen === 'repo' ? { repoId: r.id } : {} }); }
      else if (e.ctrlKey && e.key === '`') { e.preventDefault(); setUI({ term: !getUI().term }); }
      else if (e.key === 'Escape') setUI({ palette: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (fatal) return <div style={{ padding: 24, font: '400 13px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>helm could not start: {fatal}</div>;
  if (!app) return <div style={{ height: '100%', display: 'grid', placeItems: 'center', font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading…</div>;
  if (!app.user) return <SignIn />;

  let body: React.ReactNode;
  let crumbs: any[];
  if (route.screen === 'session') {
    const s = app.sessions.find((x) => x.id === route.id);
    const r = s && app.repos.find((x) => x.id === s.repoId);
    const subA = route.sub ? s?.subagents.find((x) => x.id === route.sub) : undefined;
    crumbs = [{ label: s?.free ? 'Free agents' : r?.id || 'Session', icon: s?.free ? 'robot' : 'book-bookmark', onClick: r && (() => go({ screen: 'repo', id: r.id })) }, subA ? { label: route.id, onClick: () => go({ screen: 'session', id: route.id, tab: 'conversation' }) } : route.id, ...(subA ? [{ label: subA.description, icon: 'tree-structure' }] : [])];
    body = <Session key={route.id} id={route.id} tab={route.tab || 'conversation'} sub={route.sub} file={route.file} line={route.line} setTab={(t) => go({ screen: 'session', id: route.id, tab: t })} themeKey={theme} />;
  } else if (route.screen === 'external') {
    const x = getUI().externals[route.repoId]?.find((e) => e.id === route.id);
    crumbs = [{ label: route.repoId, icon: 'book-bookmark', onClick: () => go({ screen: 'repo', id: route.repoId, tab: 'external' }) }, { label: x?.title || 'Claude Code session', icon: 'eye' }];
    body = <ExternalSessionView key={route.id} repoId={route.repoId} id={route.id} />;
  } else if (route.screen === 'repo') {
    crumbs = [{ label: route.id, icon: 'book-bookmark' }];
    body = <Repo key={route.id + ':' + (route.tab || '')} id={route.id} tab={route.tab} themeKey={theme} />;
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

  return (
    <div style={{ position: 'relative', height: '100%', minWidth: 1180, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Sidebar />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
          <TitleBar crumbs={crumbs} theme={theme} setTheme={toggleTheme as any} />
          {body}
          {term && !inCode ? <TerminalDrawer sessionId={route.screen === 'session' ? route.id : null} themeKey={theme} onClose={() => setUI({ term: false })} /> : null}
        </div>
      </div>
      <StatusBar />
      {adding ? <AddRepo onClose={() => setUI({ adding: false })} /> : null}
      {newSession ? <NewSession repoId={newSession.repoId} initial={newSession} onClose={() => setUI({ newSession: null })} /> : null}
      {removingRepo ? <RemoveRepo key={removingRepo} id={removingRepo} onClose={() => setUI({ removingRepo: null })} /> : null}
      {mergingPr ? <MergePr key={mergingPr.repoId + mergingPr.number} target={mergingPr} onClose={() => setUI({ mergingPr: null })} /> : null}
      {checkpointsOf ? <CheckpointsDialog key={checkpointsOf} id={checkpointsOf} onClose={() => setUI({ checkpointsOf: null })} /> : null}
      {restoring ? <RestoreDialog key={restoring.sessionId + restoring.n} target={restoring} onClose={() => setUI({ restoring: null })} /> : null}
      {forking ? <ForkDialog key={forking.sessionId + forking.index} target={forking} onClose={() => setUI({ forking: null })} /> : null}
      {remembering ? <RememberDialog key={remembering.text} target={remembering} onClose={() => setUI({ remembering: null })} /> : null}
      {continuing ? <ContinueDialog key={continuing.externalId} target={continuing} onClose={() => setUI({ continuing: null })} /> : null}
      {renaming ? <RenameSession key={renaming} id={renaming} onClose={() => setUI({ renaming: null })} /> : null}
      {deleting ? <DeleteSession key={deleting} id={deleting} onClose={() => setUI({ deleting: null })} /> : null}
      {palette ? <Palette onClose={() => setUI({ palette: false })} toggleTheme={toggleTheme} /> : null}
      <div style={{ position: 'absolute', right: 16, bottom: 40, zIndex: 60, display: 'flex', flexDirection: 'column', gap: 8 }}>
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
