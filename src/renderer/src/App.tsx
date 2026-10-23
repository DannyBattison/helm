import React from 'react';
import { api, platform } from './api';
import { dataStack, fontStack, uiStack } from './fonts';
import { theme as resolveTheme } from './lib';
import { dismissToast, getUI, go, init, setUI, useUI } from './store';
import { Button, Toast } from './ui';
import { Activity, Dashboard } from './views/Dashboard';
import { AddRepo, NewSession, Palette, SignIn } from './views/Dialogs';
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
  const term = useUI((u) => u.term);
  const toasts = useUI((u) => u.toasts);
  const [sysDark, setSysDark] = React.useState(0);

  React.useEffect(() => { void init(); }, []);
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
      else if (m && e.key.toLowerCase() === 'n' && getUI().app?.repos.length) { e.preventDefault(); const r = getUI().route; setUI({ newSession: r.screen === 'repo' ? { repoId: r.id } : {} }); }
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
    crumbs = [{ label: r?.id || 'Session', icon: 'book-bookmark', onClick: r && (() => go({ screen: 'repo', id: r.id })) }, subA ? { label: route.id, onClick: () => go({ screen: 'session', id: route.id, tab: 'conversation' }) } : route.id, ...(subA ? [{ label: subA.description, icon: 'tree-structure' }] : [])];
    body = <Session key={route.id} id={route.id} tab={route.tab || 'conversation'} sub={route.sub} setTab={(t) => go({ screen: 'session', id: route.id, tab: t })} themeKey={theme} />;
  } else if (route.screen === 'external') {
    const x = getUI().externals[route.repoId]?.find((e) => e.id === route.id);
    crumbs = [{ label: route.repoId, icon: 'book-bookmark', onClick: () => go({ screen: 'repo', id: route.repoId, tab: 'external' }) }, { label: x?.title || 'Claude Code session', icon: 'eye' }];
    body = <ExternalSessionView key={route.id} repoId={route.repoId} id={route.id} />;
  } else if (route.screen === 'repo') {
    crumbs = [{ label: route.id, icon: 'book-bookmark' }];
    body = <Repo key={route.id} id={route.id} tab={route.tab} themeKey={theme} />;
  } else if (route.screen === 'settings') {
    crumbs = [{ label: 'Settings', icon: 'gear-six' }];
    body = <Settings section={route.section} />;
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
      {newSession ? <NewSession repoId={newSession.repoId} onClose={() => setUI({ newSession: null })} /> : null}
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
