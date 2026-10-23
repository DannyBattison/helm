import React from 'react';
import type { ModelAlias, PermMode, Settings as SettingsT } from '@shared/types';
import { api } from '../api';
import { money } from '../lib';
import { toast, useApp } from '../store';
import { Avatar, Badge, Button, Input, Meter, SegmentedControl, Select, Switch, TreeItem } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const set = (patch: Partial<SettingsT>) => void api.updateSettings(patch);

export const PERM_OPTIONS = [{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits, ask for commands' }, { value: 'plan', label: 'Plan only' }];
export const MODEL_OPTIONS = [{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }];

function SettingRow({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ font: '500 13px/1.3 var(--font-sans)' }}>{title}</span>
        {desc ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{desc}</span> : null}
      </div>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  );
}

/** Text input that keeps its own draft and commits whatever parses. */
function Field({ value, onCommit, parse = (s: string) => s, format = (v: any) => String(v), ...rest }: any) {
  const [draft, setDraft] = React.useState(format(value));
  React.useEffect(() => { setDraft(format(value)); }, [value]);
  return <Input mono value={draft} onChange={(e: any) => { setDraft(e.target.value); const v = parse(e.target.value); if (v !== undefined) onCommit(v); }} {...rest} />;
}
const money0 = { format: (v: number) => '$' + v, parse: (s: string) => { const n = parseFloat(s.replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; } };

const H = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
    <h2 style={{ margin: 0, font: '600 16px/1.3 var(--font-sans)' }}>{children}</h2>
    {sub ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{sub}</span> : null}
  </div>
);

export function Settings({ section }: { section?: string }) {
  const app = useApp();
  const st = app.settings;
  const [sec, setSec] = React.useState(section || 'account');
  const nav = [['account', 'Account', 'github-logo'], ['agents', 'Claude Code', 'robot'], ['worktrees', 'Worktrees', 'tree-structure'], ['budgets', 'Budgets', 'coins'], ['notifications', 'Notifications', 'bell'], ['appearance', 'Appearance', 'paint-brush']];
  const notif = (key: 'notifyAttention' | 'notifyReady' | 'notifyFailed' | 'notifyChecks', title: string) => (
    <SettingRow title={title}>
      <Switch checked={st[key].desktop} onChange={(v: boolean) => set({ [key]: { ...st[key], desktop: v } })} label="Desktop" />
      <Switch checked={st[key].sound} onChange={(v: boolean) => set({ [key]: { ...st[key], sound: v } })} label="Sound" />
    </SettingRow>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <nav style={{ width: 200, flex: 'none', padding: '16px 8px', borderRight: '1px solid var(--border)' }}>
        {nav.map(([k, l, ic]) => <TreeItem key={k} icon={ic} label={l} selected={sec === k} onClick={() => setSec(k)} />)}
      </nav>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: 720, padding: '24px 32px 40px' }}>
          {sec === 'account' ? <>
            <H sub="helm signs in with GitHub only. Repositories, pull requests and history all come from this account.">Account</H>
            <SettingRow title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={app.user?.login || '?'} src={app.user?.avatar || undefined} size={24} />{app.user?.name || app.user?.login} <Badge mono>@{app.user?.login}</Badge></span>} desc="Signed in with GitHub · scopes: repo, read:org, workflow">
              <Button variant="ghost" onClick={() => { if (confirm('Sign out of GitHub? Your sessions and worktrees stay on this machine.')) void api.signOut(); }}>Sign out</Button>
            </SettingRow>
            <SettingRow title="Organisations" desc="Repositories from these organisations appear in Add repository.">
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{(app.user?.orgs || []).length ? app.user!.orgs.map((o) => <Badge key={o}>{o}</Badge>) : <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--text-3)' }}>None</span>}</span>
              <Button size="sm" iconRight="arrow-square-out" onClick={() => api.openExternal('https://github.com/settings/applications')}>Manage on GitHub</Button>
            </SettingRow>
            <SettingRow title="Commit identity" desc="Agent commits are authored by you, using your git user.name and user.email, with the session name in a Co-authored-by trailer." />
            <SettingRow title="GitHub OAuth client ID" desc="Used for sign-in. Create an OAuth app on GitHub with device flow enabled.">
              <Field value={st.githubClientId} onCommit={(v: string) => set({ githubClientId: v.trim() })} style={{ width: 240 }} />
            </SettingRow>
          </> : null}
          {sec === 'agents' ? <>
            <H sub="Defaults for new sessions. Each session can override them.">Claude Code</H>
            <SettingRow title="CLI" desc={st.claudePath ? 'Custom path' : 'Uses the Claude Code bundled with helm unless a path is set.'}>
              <Field value={st.claudePath} onCommit={(v: string) => set({ claudePath: v.trim() })} placeholder="Path to claude (optional)" style={{ width: 260 }} />
              {app.claudeVersion ? <Badge tone="ready" dot>{app.claudeVersion}</Badge> : <Badge>bundled</Badge>}
            </SettingRow>
            <SettingRow title="Default model"><Select value={st.defaultModel} onChange={(e: any) => set({ defaultModel: e.target.value as ModelAlias })} options={MODEL_OPTIONS} /></SettingRow>
            <SettingRow title="Permission mode" desc="What an agent can do without asking you first."><Select value={st.permMode} onChange={(e: any) => set({ permMode: e.target.value as PermMode })} options={PERM_OPTIONS} /></SettingRow>
            <SettingRow title="Always allowed commands" desc="Comma separated patterns. * matches anything. Added to when you choose Always allow.">
              <Field value={st.alwaysAllow} format={(v: string[]) => v.join(', ')} parse={(s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)} onCommit={(v: string[]) => set({ alwaysAllow: v })} style={{ width: 260 }} />
            </SettingRow>
            <SettingRow title="Run tests before marking ready" desc="Asks the agent to run the project's tests (package.json, go.mod, Makefile) before it finishes."><Switch checked={st.runTests} onChange={(v: boolean) => set({ runTests: v })} /></SettingRow>
          </> : null}
          {sec === 'worktrees' ? <>
            <H sub="Every session gets its own git worktree and branch, so agents never touch your working copy or each other.">Worktrees</H>
            <SettingRow title="Location"><Field value={st.worktreeRoot} onCommit={(v: string) => set({ worktreeRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Clone location" desc="Repositories cloned from GitHub go to <location>/<owner>/<name>."><Field value={st.cloneRoot} onCommit={(v: string) => set({ cloneRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Branch prefix" desc="New sessions branch from the repository's default branch."><Field value={st.branchPrefix} onCommit={(v: string) => set({ branchPrefix: v })} style={{ width: 120 }} /></SettingRow>
            <SettingRow title="Remove worktree after merge" desc="Applies to pull requests opened from helm."><Switch checked={st.removeAfterMerge} onChange={(v: boolean) => set({ removeAfterMerge: v })} /></SettingRow>
            <SettingRow title="Copy untracked files" desc="Files like .env are copied into each new worktree."><Field value={st.copyFiles} onCommit={(v: string) => set({ copyFiles: v })} style={{ width: 200 }} /></SettingRow>
          </> : null}
          {sec === 'budgets' ? <>
            <H sub="Agents pause when they reach a limit and wait in Needs you.">Budgets</H>
            <SettingRow title="Weekly limit, all repositories"><Field value={st.weeklyLimit} onCommit={(v: number) => set({ weeklyLimit: v })} {...money0} style={{ width: 100 }} /></SettingRow>
            <SettingRow title="Default per-session limit"><Field value={st.sessionBudget} onCommit={(v: number) => set({ sessionBudget: v })} {...money0} style={{ width: 100 }} /></SettingRow>
            <SettingRow title="Warn at"><SegmentedControl size="sm" value={String(st.warnAt)} onChange={(v: string) => set({ warnAt: +v })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }]} /></SettingRow>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
              {app.repos.length === 0 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>Add a repository to set its weekly cap.</span> : null}
              {app.repos.map((r) => (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 220px 90px', gap: 16, alignItems: 'center', minHeight: 40, borderTop: '1px solid var(--border-subtle)' }}>
                  <span style={{ font: '400 12.5px/1 var(--font-mono)' }}>{r.id}</span>
                  <Meter value={app.weekSpend[r.id] || 0} max={r.cap} warnAt={st.warnAt / 100} detail={money(app.weekSpend[r.id] || 0) + ' this week'} />
                  <Field size="sm" value={r.cap} onCommit={(v: number) => void api.setRepoCap(r.id, v)} {...money0} />
                </div>
              ))}
            </div>
          </> : null}
          {sec === 'notifications' ? <>
            <H sub="Desktop notifications are shown when helm is not the focused window. The taskbar or dock badge counts sessions that need you.">Notifications</H>
            {notif('notifyAttention', 'Agent needs approval or an answer')}
            {notif('notifyReady', 'Session ready for review')}
            {notif('notifyFailed', 'Session failed or hit its budget')}
            {notif('notifyChecks', 'Pull request checks finished')}
          </> : null}
          {sec === 'appearance' ? <>
            <H>Appearance</H>
            <SettingRow title="Theme"><SegmentedControl value={st.theme} onChange={(v: string) => set({ theme: v as any })} options={[{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'system', label: 'System', icon: 'desktop' }]} /></SettingRow>
            <SettingRow title="Editor font size"><Select value={String(st.editorFontSize)} onChange={(e: any) => set({ editorFontSize: +e.target.value })} options={['12', '12.5', '13', '14']} /></SettingRow>
            <SettingRow title="Open files in" desc="Used by Open in editor."><Select value={st.openIn} onChange={(e: any) => set({ openIn: e.target.value })} options={['helm', 'VS Code', 'Cursor', 'Zed']} /></SettingRow>
          </> : null}
        </div>
      </div>
    </div>
  );
}
