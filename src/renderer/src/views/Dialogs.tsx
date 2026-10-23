import React from 'react';
import type { BaseOption, GhRepo, ModelAlias, PermMode } from '@shared/types';
import { api, platform } from '../api';
import glyph from '../assets/helm-glyph-violet.svg';
import { tilde } from '../lib';
import { go, setUI, toast, useApp, useMoney } from '../store';
import { Badge, Button, Checkbox, Dialog, Input, Kbd, Select, Tabs } from '../ui';
import { MODEL_OPTIONS, PERM_OPTIONS } from './Settings';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const mac = () => platform() === 'darwin';

// ------------------------------------------------------------------ sign in
export function SignIn() {
  const app = useApp();
  const [step, setStep] = React.useState(0);
  const [code, setCode] = React.useState<{ userCode: string; verificationUri: string } | null>(null);
  const [err, setErr] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [token, setToken] = React.useState('');
  const [usingToken, setUsingToken] = React.useState(false);
  const [clientId, setClientId] = React.useState(app.settings.githubClientId);
  const needsClient = !app.settings.githubClientId;

  const start = async () => {
    setErr(''); setBusy(true);
    try {
      if (clientId.trim() !== app.settings.githubClientId) await api.updateSettings({ githubClientId: clientId.trim() });
      const c = await api.signInStart();
      setCode(c); setStep(1);
      void api.openExternal(c.verificationUri);
      api.signInWait().catch((e) => { setErr(errText(e)); setStep(0); });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const withToken = async () => {
    setErr(''); setBusy(true);
    try { await api.signInToken(token); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-app)' }}>
      <div className="drag" style={{ height: 'var(--titlebar-h)', flex: 'none' }} />
      <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 24, overflow: 'auto' }}>
        <div style={{ width: 380, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={glyph} width="38" height="38" alt="" />
            <span style={{ font: '600 26px/1 var(--font-mono)', letterSpacing: '-0.02em' }}>helm</span>
          </div>
          {step === 0 ? <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h1 style={{ margin: 0, font: '600 20px/1.25 var(--font-sans)' }}>Run Claude Code across all your repositories</h1>
              <p style={{ margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>helm uses your GitHub account to list repositories, open pull requests and show history. A GitHub account is required.</p>
            </div>
            {needsClient ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--text-2)' }}>GitHub OAuth app client ID</span>
                <Input mono value={clientId} onChange={(e: any) => setClientId(e.target.value)} placeholder="Ov23li…" />
                <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Create an OAuth app at github.com/settings/developers and enable device flow. helm never sees a client secret.</span>
              </div>
            ) : null}
            {!usingToken ? <Button size="lg" variant="primary" icon="github-logo" fullWidth loading={busy} disabled={!clientId.trim()} onClick={start}>Continue with GitHub</Button> : <>
              <Input mono type="password" value={token} onChange={(e: any) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" />
              <Button size="lg" variant="primary" fullWidth loading={busy} disabled={!token.trim()} onClick={withToken}>Sign in with token</Button>
            </>}
            {err ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span> : null}
            <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>
              Requests <code style={{ font: 'var(--type-data)' }}>repo</code>, <code style={{ font: 'var(--type-data)' }}>read:org</code> and <code style={{ font: 'var(--type-data)' }}>workflow</code>. Your code stays on this machine.{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setUsingToken(!usingToken); setErr(''); }}>{usingToken ? 'Use the browser instead' : 'Use a personal access token instead'}</a>
            </span>
          </> : <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h1 style={{ margin: 0, font: '600 20px/1.25 var(--font-sans)' }}>Enter this code on GitHub</h1>
              <p style={{ margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' }}>We opened {code?.verificationUri.replace('https://', '')} in your browser. This window continues once you approve.</p>
            </div>
            <div className="selectable" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 64, borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', font: '500 26px/1 var(--font-mono)', letterSpacing: '0.12em' }}>
              {code?.userCode.replace('-', '–')}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>
              <i className="ph ph-circle-notch" style={{ fontSize: 14, animation: 'helm-spin .9s linear infinite' }} />Waiting for GitHub
              <span style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" icon="copy" onClick={() => api.copyText(code!.userCode)}>Copy code</Button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="secondary" style={{ flex: 1 }} onClick={() => api.openExternal(code!.verificationUri)}>Open GitHub again</Button>
              <Button variant="ghost" onClick={() => { void api.signOut(); setStep(0); }}>Cancel</Button>
            </div>
          </>}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ add repository
export function AddRepo({ onClose }: { onClose(): void }) {
  const app = useApp();
  const [tab, setTab] = React.useState('github');
  const [list, setList] = React.useState<GhRepo[] | null>(null);
  const [loadErr, setLoadErr] = React.useState('');
  const [picked, setPicked] = React.useState<Record<string, boolean>>({});
  const [filter, setFilter] = React.useState('');
  const [owner, setOwner] = React.useState('all');
  const [url, setUrl] = React.useState('');
  const [dir, setDir] = React.useState(app.settings.cloneRoot);
  const [path, setPath] = React.useState('');
  const [insp, setInsp] = React.useState<{ ok: boolean; checks: { ok: boolean; warn?: boolean; text: string }[] } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');

  React.useEffect(() => { api.listGithubRepos().then(setList).catch((e) => { setList([]); setLoadErr(errText(e)); }); }, []);
  React.useEffect(() => {
    setInsp(null);
    if (!path.trim()) return;
    const t = setTimeout(() => api.inspectClone(path).then(setInsp).catch(() => undefined), 300);
    return () => clearTimeout(t);
  }, [path]);

  const owners = ['all', ...new Set((list || []).map((r) => r.id.split('/')[0]))];
  const shown = (list || []).filter((r) => (owner === 'all' || r.id.startsWith(owner + '/')) && r.id.toLowerCase().includes(filter.toLowerCase()));
  const n = Object.values(picked).filter(Boolean).length;

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (tab === 'github') await api.cloneRepos(Object.keys(picked).filter((k) => picked[k]));
      else if (tab === 'url') await api.cloneUrl(url.trim(), dir);
      else await api.addLocalRepo(path);
      onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const choose = async (set: (p: string) => void) => { const p = await api.chooseFolder(); if (p) set(p); };
  const can = tab === 'github' ? n > 0 : tab === 'url' ? !!url.trim() && !!dir.trim() : !!insp?.ok;

  return (
    <Dialog width={600} title="Add repository" description="helm works with GitHub repositories so every session can branch, commit and open pull requests." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: err ? 'var(--status-error-text)' : 'var(--text-3)' }}>{err || (tab === 'github' ? 'Cloned into ' + tilde(app.settings.cloneRoot, app.home) + '/<owner>/<name>' : '')}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="download-simple" loading={busy} disabled={!can} onClick={submit}>{tab === 'github' ? 'Clone ' + n + (n === 1 ? ' repository' : ' repositories') : tab === 'url' ? 'Clone' : 'Add'}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '-8px 0 0' }}>
        <Tabs value={tab} onChange={setTab} style={{ padding: 0 }} tabs={[{ value: 'github', label: 'Your repositories', icon: 'github-logo' }, { value: 'url', label: 'Clone from URL', icon: 'link' }, { value: 'local', label: 'Existing clone', icon: 'folder-simple' }]} />
        {tab === 'github' ? <>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input icon="magnifying-glass" placeholder="Filter repositories" value={filter} onChange={(e: any) => setFilter(e.target.value)} style={{ flex: 1 }} />
            <Select value={owner} onChange={(e: any) => setOwner(e.target.value)} options={owners.map((o) => ({ value: o, label: o === 'all' ? 'All owners' : o }))} />
          </div>
          <div style={{ maxHeight: 300, minHeight: 80, overflow: 'auto', borderRadius: 'var(--radius-md)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
            {list == null ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>Loading your repositories…</div> : null}
            {loadErr ? <div style={{ padding: 16, font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-error-text)' }}>{loadErr}</div> : null}
            {list && !loadErr && shown.length === 0 ? <div style={{ padding: 16, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>No repositories match.</div> : null}
            {shown.map((r, i) => (
              <div key={r.id} onClick={() => !r.added && setPicked({ ...picked, [r.id]: !picked[r.id] })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderTop: i ? '1px solid var(--border-subtle)' : 'none', cursor: r.added ? 'default' : 'pointer', opacity: r.added ? 0.55 : 1 }}>
                <Checkbox checked={r.added || !!picked[r.id]} disabled={r.added} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, font: '500 13px/1.2 var(--font-sans)' }}>{r.id}{r.private ? <i className="ph ph-lock-simple" style={{ fontSize: 12, color: 'var(--text-3)' }} /> : null}</span>
                  <span style={{ font: '400 12px/1.2 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.description || ' '}</span>
                </div>
                <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{r.lang}</span>
                <span style={{ width: 76, textAlign: 'right', font: '400 11px/1 var(--font-sans)', color: 'var(--text-3)' }}>{r.added ? <Badge>Added</Badge> : r.updated}</span>
              </div>
            ))}
          </div>
        </> : null}
        {tab === 'url' ? <>
          <Input mono icon="link" value={url} onChange={(e: any) => setUrl(e.target.value)} placeholder="https://github.com/owner/name or git@github.com:owner/name.git" />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', width: 70 }}>Clone into</span><Input mono value={dir} onChange={(e: any) => setDir(e.target.value)} style={{ flex: 1 }} /><Button onClick={() => choose(setDir)}>Choose…</Button></div>
        </> : null}
        {tab === 'local' ? <>
          <div style={{ display: 'flex', gap: 8 }}><Input mono value={path} onChange={(e: any) => setPath(e.target.value)} placeholder="Path to an existing clone" style={{ flex: 1 }} /><Button onClick={() => choose(setPath)}>Choose folder…</Button></div>
          {insp ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border)' }}>
              {insp.checks.map((c) => {
                const tone = !c.ok ? 'error' : c.warn ? 'attention' : 'ready';
                return <span key={c.text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}><i className={'ph-fill ph-' + (c.ok ? (c.warn ? 'warning-circle' : 'check-circle') : 'x-circle')} style={{ fontSize: 14, color: 'var(--status-' + tone + ')', marginTop: 1 }} />{c.text}</span>;
              })}
            </div>
          ) : null}
          <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Folders without a GitHub remote can’t be added. Push them to GitHub first.</span>
        </> : null}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ new session
export function NewSession({ repoId, onClose }: { repoId?: string; onClose(): void }) {
  const app = useApp();
  const { sym, to, from } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const [repo, setRepo] = React.useState(repoId || app.repos[0]?.id || '');
  const r = app.repos.find((x) => x.id === repo);
  const [bases, setBases] = React.useState<BaseOption[]>([]);
  const [dirty, setDirty] = React.useState(0);
  const [base, setBase] = React.useState(r?.defaultBranch || 'main');
  const [task, setTask] = React.useState('');
  const [model, setModel] = React.useState<ModelAlias>(app.settings.defaultModel);
  const [perm, setPerm] = React.useState<PermMode>(app.settings.permMode);
  const [budget, setBudget] = React.useState(String(Math.round(to(app.settings.sessionBudget) * 100) / 100));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    if (!repo) return;
    setBase(app.repos.find((x) => x.id === repo)?.defaultBranch || 'main');
    // Start from the local branch when it has commits GitHub does not, since that is where unpushed work is.
    api.repoBases(repo).then((b) => { setBases(b); if (b[0]) setBase(b[0].ref); }).catch(() => setBases([]));
    api.workspaceInfo('repo:' + repo).then((i) => setDirty(i.dirty)).catch(() => setDirty(0));
  }, [repo]);
  const start = async () => {
    setBusy(true); setErr('');
    try {
      const id = await api.createSession({ repoId: repo, base, task: task.trim(), model, budget: sub ? 0 : from(parseFloat(budget)) || app.settings.sessionBudget, permMode: perm });
      onClose();
      go({ screen: 'session', id, tab: 'conversation' });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const mod = mac() ? '⌘' : 'Ctrl+';
  return (
    <Dialog width={560} title="New session" description="The agent works in its own git worktree on a new branch. Your checkout is not touched." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: err ? 'var(--status-error-text)' : 'var(--text-3)' }}>{err || (r ? `Branch ${app.settings.branchPrefix}<name> from ${base}` : '')}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="play" kbd={mod + '↵'} loading={busy} disabled={!task.trim() || !repo} onClick={start}>Start session</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select value={repo} onChange={(e: any) => setRepo(e.target.value)} options={app.repos.map((x) => x.id)} style={{ flex: 1 }} icon="book-bookmark" />
          <Select value={base} onChange={(e: any) => setBase(e.target.value)} options={bases.length ? bases.map((b) => ({ value: b.ref, label: b.label })) : [base]} mono icon="git-branch" />
        </div>
        <textarea autoFocus rows={5} value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should the agent do? Be specific about the outcome, and mention files or checks that matter."
          onKeyDown={(e) => { if (e.key === 'Enter' && (mac() ? e.metaKey : e.ctrlKey) && task.trim()) void start(); }}
          style={{ resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.55 var(--font-sans)', padding: '10px 12px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: sub ? '1fr 1fr' : '1fr 1fr 110px', gap: 8 }}>
          <Select value={model} onChange={(e: any) => setModel(e.target.value)} options={MODEL_OPTIONS} />
          <Select value={perm} onChange={(e: any) => setPerm(e.target.value)} options={PERM_OPTIONS} />
          {sub ? null : <Input mono value={sym + budget} onChange={(e: any) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))} />}
        </div>
        {(() => {
          const here = bases.find((b) => b.ref === base);
          const hidden = bases.find((b) => b.local && b.ahead > 0 && 'origin/' + b.ref === base);
          const notes: { text: string; warn?: boolean }[] = [];
          if (here?.local && here.ahead > 0) notes.push({ text: `Starts from your local ${here.ref}, including ${here.ahead} ${here.ahead === 1 ? 'commit' : 'commits'} that are not on GitHub yet.` });
          if (hidden) notes.push({ warn: true, text: `Your local ${hidden.ref} has ${hidden.ahead} ${hidden.ahead === 1 ? 'commit' : 'commits'} that ${base} does not. The agent will not see them.` });
          if (dirty > 0) notes.push({ warn: true, text: `${dirty} uncommitted ${dirty === 1 ? 'file' : 'files'} in your checkout will not be in the session. Commit them first if the agent needs them.` });
          return notes.map((n, i) => <span key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '400 12px/1.45 var(--font-sans)', color: n.warn ? 'var(--status-attention-text)' : 'var(--text-2)' }}><i className={'ph-fill ph-' + (n.warn ? 'warning-circle' : 'info')} style={{ fontSize: 14, marginTop: 1 }} />{n.text}</span>);
        })()}
        <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{sub ? 'Model and permission mode can be changed later. Plan usage limits are set in Settings → Usage.' : 'Model, permission mode and the session budget can be changed later. The agent pauses at the budget and waits in Needs you.'}</span>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ command palette
export function Palette({ onClose, toggleTheme }: { onClose(): void; toggleTheme(): void }) {
  const app = useApp();
  const [q, setQ] = React.useState('');
  const [i, setI] = React.useState(0);
  type Item = { key: string; label: string; hint?: string; icon: string; run(): void };
  const items: Item[] = [
    { key: 'a-overview', label: 'Overview', icon: 'squares-four', run: () => go({ screen: 'overview' }) },
    { key: 'a-need', label: 'Needs you', icon: 'bell-ringing', run: () => go({ screen: 'overview', filter: 'attention' }) },
    { key: 'a-act', label: 'Activity', icon: 'pulse', run: () => go({ screen: 'activity' }) },
    { key: 'a-set', label: 'Settings', icon: 'gear-six', run: () => go({ screen: 'settings' }) },
    { key: 'a-new', label: 'New session', icon: 'plus', hint: mac() ? '⌘N' : 'Ctrl+N', run: () => setUI({ newSession: {} }) },
    { key: 'a-add', label: 'Add repository', icon: 'book-bookmark', run: () => setUI({ adding: true }) },
    { key: 'a-theme', label: 'Toggle theme', icon: 'sun', run: toggleTheme },
    ...app.sessions.map((s) => ({ key: 's-' + s.id, label: s.id, hint: s.task, icon: 'robot', run: () => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' }) })),
    ...app.repos.map((r) => ({ key: 'r-' + r.id, label: r.id, hint: 'Repository', icon: 'book-bookmark', run: () => go({ screen: 'repo', id: r.id }) }))
  ];
  const f = items.filter((x) => (x.label + ' ' + (x.hint || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 12);
  const go_ = (it?: Item) => { if (!it) return; onClose(); it.run(); };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', paddingTop: 90 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, alignSelf: 'flex-start', borderRadius: 'var(--radius-xl)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)', overflow: 'hidden', animation: 'helm-in var(--dur-slow) var(--ease-out)' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)' }}>
          <Input autoFocus icon="magnifying-glass" size="lg" placeholder="Search sessions, repositories and actions" value={q} onChange={(e: any) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e: any) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, f.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') go_(f[i]);
              else if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto', padding: 6 }}>
          {f.length === 0 ? <div style={{ padding: 14, font: '400 13px/1 var(--font-sans)', color: 'var(--text-3)' }}>Nothing matches.</div> : null}
          {f.map((it, n) => (
            <div key={it.key} onMouseEnter={() => setI(n)} onClick={() => go_(it)} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: n === i ? 'var(--bg-selected)' : 'transparent' }}>
              <i className={'ph ph-' + it.icon} style={{ fontSize: 15, color: 'var(--text-3)' }} />
              <span style={{ font: '500 13px/1 var(--font-sans)', whiteSpace: 'nowrap' }}>{it.label}</span>
              <span style={{ flex: 1, minWidth: 0, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.hint}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 14, padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', font: '400 11px/1 var(--font-sans)', color: 'var(--text-3)' }}>
          <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Kbd keys={['↑', '↓']} /> move</span>
          <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Kbd keys={['↵']} /> open</span>
          <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}><Kbd keys={['Esc']} /> close</span>
        </div>
      </div>
    </div>
  );
}
