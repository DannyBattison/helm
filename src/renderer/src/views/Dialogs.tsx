import React from 'react';
import type { BaseOption, GhRepo, MergeMethod, ModelAlias, PermMode, PullRequest, SessionDeleteInfo } from '@shared/types';
import { api, platform } from '../api';
import glyph from '../assets/helm-glyph-violet.svg';
import { tilde } from '../lib';
import { getUI, go, setUI, toast, useApp, useMoney } from '../store';
import { Badge, Button, Checkbox, Dialog, Input, Kbd, Select, Tabs, useNarrow } from '../ui';
import { MODEL_OPTIONS, PERM_OPTIONS } from './Settings';
import { VariantEditor, type Variant } from './Review';

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
            <span style={{ font: '600 26px/1 var(--font-mono)', letterSpacing: '-0.02em', position: 'relative', top: '0.14em' }}>helm</span>
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


// ------------------------------------------------------------------ sign in to Claude (hosted server)
/**
 * Shown over everything, and the app behind it switched off, when the server's Claude Code is not signed in: on a server nobody can run
 * `claude` in front of it, so signing in is the first thing to do. Done when Claude Code reports that it is signed in.
 */
export function ClaudeLoginGate() {
  const app = useApp();
  const [step, setStep] = React.useState(0);
  const [url, setUrl] = React.useState('');
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(app.claudeLogin?.error || '');

  const start = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api.claudeLoginStart();
      setUrl(r.url); setStep(1);
      void api.openExternal(r.url);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await api.claudeLoginCode(code); }
    catch (e) { setErr(errText(e)); setStep(0); setCode(''); }
    finally { setBusy(false); }
  };
  const startOver = () => { void api.claudeLoginCancel(); setStep(0); setCode(''); setErr(''); };
  const text: React.CSSProperties = { margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' };

  return (
    <div role="dialog" aria-modal="true" aria-label="Sign in to Claude" style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'grid', placeItems: 'center', padding: 24, background: 'color-mix(in srgb, var(--bg-app) 86%, transparent)', backdropFilter: 'blur(6px)' }}>
      <div style={{ width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 18, padding: 28, borderRadius: 'var(--radius-lg)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border), 0 20px 60px rgba(0,0,0,.45)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={glyph} width="30" height="30" alt="" />
          <span style={{ font: '600 20px/1 var(--font-mono)', letterSpacing: '-0.02em', position: 'relative', top: '0.14em' }}>helm</span>
        </div>
        {step === 0 ? <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, font: '600 18px/1.3 var(--font-sans)' }}>Sign in to Claude to start</h1>
            <p style={text}>helm runs Claude Code on this server, and it has to be signed in to your Claude account before agents can do anything. It uses your Claude subscription.</p>
          </div>
          <Button size="lg" variant="primary" fullWidth loading={busy} onClick={start}>Sign in with Claude</Button>
          {err ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span> : null}
          <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Use your own account, on a server only you use: Anthropic's terms limit sharing a subscription login with other people or apps.</span>
        </> : <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h1 style={{ margin: 0, font: '600 18px/1.3 var(--font-sans)' }}>Approve it on Claude, then paste the code</h1>
            <p style={text}>We opened Claude in a new tab. Approve the sign-in there, and it shows a code. Paste it here to finish. If the tab did not open, use the button below.</p>
          </div>
          <Button variant="secondary" fullWidth iconRight="arrow-square-out" onClick={() => api.openExternal(url)}>Open Claude again</Button>
          <Input mono autoFocus value={code} onChange={(e: any) => setCode(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && code.trim() && !busy) void submit(); }} placeholder="Paste the code here" />
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" style={{ flex: 1 }} loading={busy} disabled={!code.trim()} onClick={submit}>Continue</Button>
            <Button variant="ghost" onClick={startOver}>Start over</Button>
          </div>
          {err ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span> : null}
        </>}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}><span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', width: 70 }}>Clone into</span><Input mono value={dir} onChange={(e: any) => setDir(e.target.value)} style={{ flex: '1 1 160px', minWidth: 0 }} /><Button onClick={() => choose(setDir)}>Choose…</Button></div>
        </> : null}
        {tab === 'local' ? <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><Input mono value={path} onChange={(e: any) => setPath(e.target.value)} placeholder="Path to an existing clone" style={{ flex: '1 1 160px', minWidth: 0 }} /><Button onClick={() => choose(setPath)}>Choose folder…</Button></div>
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
export function NewSession({ repoId, initial, onClose }: { repoId?: string; initial?: { task?: string; source?: import('@shared/types').Session['source']; base?: string }; onClose(): void }) {
  const app = useApp();
  const narrow = useNarrow();
  const { sym, to, from } = useMoney();
  const sub = app.settings.billing === 'subscription';
  const [repo, setRepo] = React.useState(repoId || app.repos[0]?.id || '@free');
  const r = app.repos.find((x) => x.id === repo);
  const free = repo === '@free';
  const [bases, setBases] = React.useState<BaseOption[]>([]);
  const [dirty, setDirty] = React.useState(0);
  const [base, setBase] = React.useState(r?.defaultBranch || 'main');
  const [task, setTask] = React.useState(initial?.task || '');
  const [after, setAfter] = React.useState('');
  const [model, setModel] = React.useState<ModelAlias>(app.settings.defaultModel);
  const [perm, setPerm] = React.useState<PermMode>(app.settings.permMode);
  const [budget, setBudget] = React.useState(String(Math.round(to(app.settings.sessionBudget) * 100) / 100));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [compare, setCompare] = React.useState(false);
  const [folder, setFolder] = React.useState('');
  const [variants, setVariants] = React.useState<Variant[]>([{ model: 'sonnet', effort: 'default' }, { model: 'opus', effort: 'default' }]);
  React.useEffect(() => {
    if (!repo) return;
    if (repo === '@free') { setBases([]); setDirty(0); return; }
    setBase(app.repos.find((x) => x.id === repo)?.defaultBranch || 'main');
    // Start from the local branch when it has commits GitHub does not, since that is where unpushed work is.
    api.repoBases(repo).then((b) => { setBases(b); const want = initial?.base && b.find((x) => x.ref === initial.base); if (want) setBase(want.ref); else if (initial?.base) setBase(initial.base); else if (b[0]) setBase(b[0].ref); }).catch(() => setBases([]));
    api.workspaceInfo('repo:' + repo).then((i) => setDirty(i.dirty)).catch(() => setDirty(0));
  }, [repo]);
  const start = async () => {
    setBusy(true); setErr('');
    try {
      const input = { repoId: repo, base: free ? '' : base, folder: free && folder ? folder : undefined, task: task.trim(), model, budget: sub ? 0 : from(parseFloat(budget)) || app.settings.sessionBudget, permMode: perm, after: after || undefined, source: initial?.source };
      if (compare && !free) {
        const ids = await api.createGroup(input, variants.map((v) => ({ model: v.model, effort: v.effort === 'default' ? undefined : v.effort })));
        const group = getUI().app?.sessions.find((x) => x.id === ids[0])?.group;
        onClose();
        go(group ? { screen: 'compare', group } : { screen: 'overview' });
        return;
      }
      const id = await api.createSession(input);
      onClose();
      go({ screen: 'session', id, tab: 'conversation' });
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const mod = mac() ? '⌘' : 'Ctrl+';
  return (
    <Dialog width={560} title={free ? 'New free agent' : 'New session'} description={free ? 'An agent that is not tied to a repository, for research, writing, scripts and one-off jobs. It works in a folder of its own.' : 'The agent works in its own git worktree on a new branch. Your checkout is not touched.'} onClose={onClose}
      footer={<>
        <span style={{ flex: narrow ? '1 1 100%' : 1, font: '400 12px/1.3 var(--font-sans)', color: err ? 'var(--status-error-text)' : 'var(--text-3)' }}>{err || (free ? (folder ? 'Works directly in your folder' : 'A new scratch folder, with git') : r ? `Branch ${app.settings.branchPrefix}<name> from ${base}` : '')}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="play" kbd={narrow ? undefined : mod + '↵'} loading={busy} disabled={!task.trim() || !repo} onClick={start}>{compare && !free ? `Start ${variants.length} runs` : after ? 'Queue session' : 'Start session'}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 8 }}>
          <Select value={repo} onChange={(e: any) => { setRepo(e.target.value); if (e.target.value === '@free') setCompare(false); }} options={[{ value: '@free', label: 'No repository (free agent)' }, ...app.repos.map((x) => ({ value: x.id, label: x.id }))]} style={{ flex: narrow ? 'none' : 1, minWidth: 0 }} icon={free ? 'robot' : 'book-bookmark'} />
          {free ? <Button variant="secondary" icon="folder-open" onClick={() => void api.chooseFolder().then((f) => f && setFolder(f))}>{folder ? 'Change folder…' : 'Use my own folder…'}</Button>
            : <Select value={base} onChange={(e: any) => setBase(e.target.value)} options={bases.length ? bases.map((b) => ({ value: b.ref, label: b.label })) : [base]} mono icon="git-branch" />}
        </div>
        <textarea autoFocus={!narrow} rows={narrow ? 4 : 5} value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should the agent do? Be specific about the outcome, and mention files or checks that matter."
          onKeyDown={(e) => { if (e.key === 'Enter' && (mac() ? e.metaKey : e.ctrlKey) && task.trim()) void start(); }}
          style={{ resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.55 var(--font-sans)', padding: '10px 12px' }} />
        <div style={{ display: 'grid', gridTemplateColumns: narrow ? 'minmax(0,1fr)' : sub ? '1fr 1fr' : '1fr 1fr 110px', gap: 8, ...(compare ? { opacity: 0.5 } : null) }}>
          <Select disabled={compare} value={model} onChange={(e: any) => setModel(e.target.value)} options={MODEL_OPTIONS} />
          <Select value={perm} onChange={(e: any) => setPerm(e.target.value)} options={PERM_OPTIONS} />
          {sub ? null : <Input mono value={sym + budget} onChange={(e: any) => setBudget(e.target.value.replace(/[^0-9.]/g, ''))} />}
        </div>
        {free && folder ? <span style={{ display: 'flex', gap: 8, alignItems: 'center', font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-attention-text)' }}><i className="ph-fill ph-warning-circle" /><span><code style={{ font: 'var(--type-data)' }}>{folder}</code> is your own folder: the agent works in it directly, with no worktree to throw away and no checkpoints. <a href="#" onClick={(e) => { e.preventDefault(); setFolder(''); }}>Use a scratch folder instead</a></span></span> : null}
        {!compare && !free ? (
          <Select value={after} onChange={(e: any) => setAfter(e.target.value)} icon="hourglass"
            options={[{ value: '', label: app.settings.maxRunning ? `Start now, or when one of ${app.settings.maxRunning} slots is free` : 'Start right away' }, ...app.sessions.filter((x) => x.repoId === repo && !x.mergedAt && !x.archivedAt).map((x) => ({ value: x.id, label: 'After “' + (x.customTitle || x.title || x.task).slice(0, 48) + '” is merged' }))]} />
        ) : null}
        {free ? null : <Checkbox checked={compare} onChange={setCompare} label="Compare several runs" description="Start the same task more than once, with different models or effort, and keep the best result." />}
        {compare && !free ? <VariantEditor variants={variants} onChange={setVariants} /> : null}
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

// ------------------------------------------------------------------ delete session
const METHOD_HELP: Record<MergeMethod, string> = {
  merge: 'Keeps every commit and adds a merge commit.',
  squash: 'Combines the branch into one commit on the base.',
  rebase: 'Replays the commits onto the base, with no merge commit.'
};

/** Merge an open pull request on GitHub, from inside helm. */
export function MergePr({ target, onClose }: { target: { repoId: string; number: number; sessionId?: string }; onClose(): void }) {
  const app = useApp();
  const session = app.sessions.find((x) => x.id === target.sessionId);
  const [pr, setPr] = React.useState<PullRequest | null>(null);
  const [method, setMethod] = React.useState<MergeMethod>(app.settings.mergeMethod);
  const [del, setDel] = React.useState(!!(session ? session.deleteBranchAfterMerge ?? session.removeAfterMerge : false));
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => { api.repoPulls(target.repoId).then((l) => setPr(l.find((p) => p.number === target.number) || null)).catch((e) => setErr(errText(e))); }, []);
  const run = async () => {
    setBusy(true); setErr('');
    try {
      await api.mergePr(target.repoId, target.number, { method, deleteBranch: del });
      toast({ tone: 'ready', title: `Merged #${target.number}`, description: pr ? `${pr.branch} into ${pr.base}` : undefined });
      onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const note = pr?.draft ? 'This is a draft. GitHub will not merge it until it is marked ready for review.'
    : pr?.checks === 'failing' ? 'Its checks are failing.'
    : pr?.checks === 'pending' ? 'Its checks are still running.' : '';
  return (
    <Dialog width={500} title={`Merge pull request #${target.number}?`} description={pr ? pr.title : undefined} onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.4 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="git-merge" loading={busy} disabled={!pr || pr.state !== 'open'} onClick={run}>{pr ? `Merge into ${pr.base}` : 'Merge'}</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {pr && pr.state !== 'open' ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>It is already {pr.state}.</span> : null}
        {note ? <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-attention-text)' }}><i className="ph-fill ph-warning-circle" style={{ fontSize: 14, marginTop: 1, flex: 'none' }} />{note}</span> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ font: '500 12px/1 var(--font-sans)' }}>How</span>
          <Select value={method} onChange={(e: any) => setMethod(e.target.value)} options={[{ value: 'merge', label: 'Merge commit' }, { value: 'squash', label: 'Squash and merge' }, { value: 'rebase', label: 'Rebase and merge' }]} />
          <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{METHOD_HELP[method]}</span>
        </div>
        <Checkbox checked={del} onChange={setDel} label={<span>Delete the branch on GitHub{pr ? <> <code style={{ font: 'var(--type-data)' }}>{pr.branch}</code></> : null}</span>}
          description="Also deletes your local branch, which removes the worktree too. Leave it off to keep both." />
        {session ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{session.removeAfterMerge || del ? 'The worktree is removed afterwards, ' : 'The worktree is kept, '}and the session is {app.settings.afterMerge === 'archive' ? 'archived' : app.settings.afterMerge === 'delete' ? 'deleted' : 'left as it is'}.</span> : null}
      </div>
    </Dialog>
  );
}

export function RenameSession({ id, onClose }: { id: string; onClose(): void }) {
  const s = useApp().sessions.find((x) => x.id === id);
  const [name, setName] = React.useState(s?.customTitle || s?.title || '');
  const [err, setErr] = React.useState('');
  if (!s) return null;
  const save = async (v: string) => {
    try { await api.renameSession(id, v); onClose(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <Dialog width={440} title="Rename session" description={s.free ? (s.title && !s.customTitle ? 'Claude named this one.' : 'Only the name in helm changes.') : s.title && !s.customTitle ? `Claude named this one. Branch ${s.branch} is not changed.` : `The branch ${s.branch} is not changed.`} onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        {s.customTitle ? <Button variant="ghost" onClick={() => void save('')}>Use Claude's name</Button> : null}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={() => void save(name)}>Rename</Button>
      </>}>
      <Input autoFocus value={name} placeholder={s.id} onChange={(e: any) => setName(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && name.trim()) void save(name); }} />
    </Dialog>
  );
}

export function DeleteSession({ id, onClose }: { id: string; onClose(): void }) {
  const app = useApp();
  const s = app.sessions.find((x) => x.id === id);
  const [info, setInfo] = React.useState<SessionDeleteInfo | null>(null);
  const [worktree, setWorktree] = React.useState(true);
  const [branch, setBranch] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => { api.sessionDeleteInfo(id).then(setInfo).catch((e) => setErr(errText(e))); }, [id]);
  const run = async () => {
    setBusy(true); setErr('');
    try {
      await api.deleteSession(id, { worktree: worktree || branch, branch });
      const r = getUI().route;
      if (r.screen === 'session' && r.id === id) go({ screen: 'overview' });
      toast({ tone: 'neutral', title: `Deleted ${id}`, description: [worktree || branch ? 'worktree removed' : 'worktree kept', branch ? 'branch deleted' : 'branch kept'].join(' · ') });
      onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  if (!s) return null;
  const warn = (text: string) => <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '400 12px/1.45 var(--font-sans)', color: 'var(--status-attention-text)' }}><i className="ph-fill ph-warning-circle" style={{ fontSize: 14, marginTop: 1, flex: 'none' }} />{text}</span>;
  const removing = worktree || branch;
  return (
    <Dialog width={520} title={`Delete ${s.id}?`} description="The conversation and its record in helm are removed. Your checkout and other sessions are not touched." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon="trash" loading={busy} disabled={!info} onClick={run}>Delete session</Button>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {info?.running ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>It is running, and will be stopped first.</span> : null}
        {info?.free === 'folder' ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>It worked in your own folder, <code style={{ font: 'var(--type-data)' }}>{tilde(info.worktree, app.home)}</code>. That folder is left exactly as it is.</span> : null}
        {info?.free !== 'folder' ? <Checkbox checked={worktree || branch} disabled={branch || !info?.worktreeExists} onChange={setWorktree} label={info?.free === 'scratch' ? 'Delete its scratch folder' : 'Remove the worktree'}
          description={info?.worktreeExists ? tilde(info.worktree, app.home) : 'Already gone from disk'} /> : null}
        {info?.free ? null : <Checkbox checked={branch} onChange={(v: boolean) => { setBranch(v); if (v) setWorktree(true); }} label={<span>Delete the branch <code style={{ font: 'var(--type-data)' }}>{s.branch}</code></span>}
          description={info?.pushed ? 'Only the local branch. It also exists on GitHub and stays there.' : 'Local only. It is not on GitHub.'} />}
        {info && removing && info.dirty > 0 ? warn(`${info.dirty} uncommitted ${info.dirty === 1 ? 'file' : 'files'} in the ${info.free ? 'folder' : 'worktree'} will be lost.`) : null}
        {info && branch && info.unpushed > 0 ? warn(`${info.unpushed} ${info.unpushed === 1 ? 'commit' : 'commits'} on this branch ${info.pushed ? 'are not on GitHub' : 'exist nowhere else'}, and will be lost.`) : null}
        {info && !branch && info.unpushed > 0 ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>Keeping the branch keeps its {info.unpushed} {info.unpushed === 1 ? 'commit' : 'commits'}.</span> : null}
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ remove repository
export function RemoveRepo({ id, onClose }: { id: string; onClose(): void }) {
  const app = useApp();
  const repo = app.repos.find((r) => r.id === id);
  const mine = app.sessions.filter((s) => s.repoId === id);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  if (!repo) return null;
  const run = async () => {
    setBusy(true); setErr('');
    try {
      await api.removeRepo(id);
      const r = getUI().route;
      if ((r.screen === 'repo' && r.id === id) || (r.screen === 'external' && r.repoId === id)) go({ screen: 'overview' });
      onClose();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog width={480} title={`Remove ${repo.id} from helm?`} description="helm stops tracking it. The folder on disk and the repository on GitHub are not touched." onClose={onClose}
      footer={<>
        <span style={{ flex: 1, font: '400 12px/1.3 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon="trash" loading={busy} disabled={mine.length > 0} onClick={run}>Remove repository</Button>
      </>}>
      {mine.length ? (
        <span style={{ display: 'flex', gap: 8, alignItems: 'flex-start', font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--status-attention-text)' }}>
          <i className="ph-fill ph-warning-circle" style={{ fontSize: 14, marginTop: 2, flex: 'none' }} />
          It still has {mine.length} {mine.length === 1 ? 'session' : 'sessions'} ({mine.slice(0, 3).map((s) => s.id).join(', ')}{mine.length > 3 ? '…' : ''}). Delete {mine.length === 1 ? 'it' : 'them'} first, from the right-click menu in the left tree, so no worktrees are left behind.
        </span>
      ) : <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>Its usage history is kept, so adding it again picks up where it left off. Its weekly cap goes back to the default.</span>}
    </Dialog>
  );
}

// ------------------------------------------------------------------ command palette
export function Palette({ onClose, toggleTheme }: { onClose(): void; toggleTheme(): void }) {
  const app = useApp();
  const [q, setQ] = React.useState('');
  const [i, setI] = React.useState(0);
  type Item = { key: string; label: string; hint?: string; icon: string; section?: string; run(): void };
  const [deep, setDeep] = React.useState<import('@shared/types').SearchResults | null>(null);
  const [searching, setSearching] = React.useState(false);
  // Search what was said in conversations, commit messages and, inside a session or repository, its code.
  React.useEffect(() => {
    setDeep(null);
    if (q.trim().length < 2) { setSearching(false); return; }
    setSearching(true);
    let live = true;
    const r = getUI().route;
    const workspace = r.screen === 'session' ? r.id : r.screen === 'repo' ? 'repo:' + r.id : undefined;
    const t = setTimeout(() => api.searchAll(q, workspace).then((x) => { if (live) { setDeep(x); setSearching(false); } }).catch(() => live && setSearching(false)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const items: Item[] = [
    { key: 'a-overview', label: 'Overview', icon: 'squares-four', run: () => go({ screen: 'overview' }) },
    { key: 'a-need', label: 'Inbox: what needs you', icon: 'tray', run: () => go({ screen: 'inbox' }) },
    { key: 'a-reports', label: 'Reports', icon: 'chart-line-up', run: () => go({ screen: 'reports' }) },
    { key: 'a-act', label: 'Activity', icon: 'pulse', run: () => go({ screen: 'activity' }) },
    { key: 'a-set', label: 'Settings', icon: 'gear-six', run: () => go({ screen: 'settings' }) },
    { key: 'a-new', label: 'New session', icon: 'plus', hint: mac() ? '⌘N' : 'Ctrl+N', run: () => setUI({ newSession: {} }) },
    { key: 'a-free', label: 'New free agent (no repository)', icon: 'robot', run: () => setUI({ newSession: { repoId: '@free' } }) },
    { key: 'a-add', label: 'Add repository', icon: 'book-bookmark', run: () => setUI({ adding: true }) },
    { key: 'a-theme', label: 'Toggle theme', icon: 'sun', run: toggleTheme },
    ...app.sessions.map((s) => ({ key: 's-' + s.id, label: s.id, hint: s.task, icon: 'robot', run: () => go({ screen: 'session', id: s.id, tab: s.status === 'ready' ? 'changes' : 'conversation' }) })),
    ...app.repos.map((r) => ({ key: 'r-' + r.id, label: r.id, hint: 'Repository', icon: 'book-bookmark', run: () => go({ screen: 'repo', id: r.id }) }))
  ];
  const KIND_HINT = { you: 'you', claude: 'Claude', command: 'command', edit: 'edit', note: 'note' } as const;
  const deepItems: Item[] = deep ? [
    ...deep.transcripts.map((h, n) => ({ key: `t-${h.sessionId}-${h.index}-${n}`, section: 'In conversations', label: h.snippet, hint: `${h.title} · ${KIND_HINT[h.kind]}`, icon: 'chats-circle', run: () => go({ screen: 'session', id: h.sessionId, tab: 'conversation' }) })),
    ...deep.commits.map((c) => ({ key: `c-${c.repoId}-${c.hash}`, section: 'Commits', label: c.msg, hint: `${c.hash} · ${c.who} · ${c.repoId}`, icon: 'git-commit', run: () => go({ screen: 'repo', id: c.repoId, tab: 'history' }) })),
    ...deep.code.map((h, n) => ({ key: `f-${h.path}-${h.line}-${n}`, section: 'In code', label: h.text.trim() || h.path, hint: `${h.path}:${h.line}`, icon: 'code', run: () => (h.ws.startsWith('repo:') ? go({ screen: 'repo', id: h.ws.slice(5), tab: 'code' }) : go({ screen: 'session', id: h.ws, tab: 'code', file: h.path, line: h.line })) }))
  ] : [];
  const f = [...items.filter((x) => (x.label + ' ' + (x.hint || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 8), ...deepItems];
  const go_ = (it?: Item) => { if (!it) return; onClose(); it.run(); };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'var(--scrim)', display: 'flex', justifyContent: 'center', paddingTop: 90 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, alignSelf: 'flex-start', borderRadius: 'var(--radius-xl)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)', overflow: 'hidden', animation: 'helm-in var(--dur-slow) var(--ease-out)' }}>
        <div style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)' }}>
          <Input autoFocus icon="magnifying-glass" size="lg" placeholder="Search sessions, conversations, commits and code" value={q} onChange={(e: any) => { setQ(e.target.value); setI(0); }}
            onKeyDown={(e: any) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(i + 1, f.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') go_(f[i]);
              else if (e.key === 'Escape') onClose();
            }} />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto', padding: 6 }}>
          {f.length === 0 ? <div style={{ padding: 14, font: '400 13px/1 var(--font-sans)', color: 'var(--text-3)' }}>{searching ? 'Searching…' : 'Nothing matches.'}</div> : null}
          {f.map((it, n) => (
            <React.Fragment key={it.key}>
            {it.section && f[n - 1]?.section !== it.section ? <div style={{ padding: '10px 10px 4px', font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>{it.section}</div> : null}
            <div onMouseEnter={() => setI(n)} onClick={() => go_(it)} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 34, padding: '0 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: n === i ? 'var(--bg-selected)' : 'transparent' }}>
              <i className={'ph ph-' + it.icon} style={{ fontSize: 15, color: 'var(--text-3)' }} />
              <span style={{ font: it.section ? '400 12.5px/1.2 var(--font-sans)' : '500 13px/1 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: it.section ? '66%' : undefined, flex: it.section ? '0 1 auto' : 'none' }}>{it.label}</span>
              <span style={{ flex: 1, minWidth: 0, font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: it.section ? 'right' : undefined }}>{it.hint}</span>
            </div>
            </React.Fragment>
          ))}
          {searching && f.length > 0 ? <div style={{ padding: '8px 10px', font: '400 11.5px/1 var(--font-sans)', color: 'var(--text-3)' }}>Searching conversations, commits and code…</div> : null}
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
