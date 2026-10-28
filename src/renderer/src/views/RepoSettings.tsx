import React from 'react';
import type { Settings as SettingsT } from '@shared/types';
import { REPO_SETTING_KEYS, type RepoSettingKey, type RepoSettings } from '@shared/repoSettings';
import { api } from '../api';
import { defaultChoice, modelChoices, splitChoice } from '../lib';
import { toast, useApp, useMoney } from '../store';
import { Badge, Button, SegmentedControl, Select, Switch } from '../ui';
import { EFFORT_OPTIONS } from './Review';
import { Field, H, PERM_OPTIONS, SettingRow } from './Settings';

const textarea: React.CSSProperties = { width: 280, resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' };

const Overrides = React.createContext<{ repoId: string | null; own: RepoSettings; clear(keys: RepoSettingKey[]): void }>({ repoId: null, own: {}, clear: () => undefined });

/** A row; in a repository it says whether the value is its own or inherited, and offers to go back to the default. */
function Row({ keys, title, desc, children }: { keys: RepoSettingKey[]; title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  const { repoId, own, clear } = React.useContext(Overrides);
  const overridden = !!repoId && keys.some((k) => k in own);
  return (
    <SettingRow title={<>{title}{overridden ? <> <Badge tone="attention">overridden</Badge></> : null}</>} desc={desc}>
      {children}
      {repoId ? <Button size="sm" variant="ghost" icon="arrow-counter-clockwise" disabled={!overridden} onClick={() => clear(keys)}>Use default</Button> : null}
    </SettingRow>
  );
}

/**
 * The settings a repository can set for itself. With no `repoId` this is the defaults screen, which edits the settings every repository
 * starts from. With one, each row shows the value that repository uses: its own when it has set one, otherwise the default, which it follows.
 */
export function RepoSettingsPane({ repoId }: { repoId: string | null }) {
  const app = useApp();
  const { sym, to, from } = useMoney();
  const repo = repoId ? app.repos.find((r) => r.id === repoId) : undefined;
  const base = app.settings;
  const own: RepoSettings = repo?.settings || {};
  const st = { ...base, ...own } as SettingsT;
  const put = (patch: RepoSettings) => { if (repoId) void api.setRepoSettings(repoId, { ...own, ...patch }); else void api.updateSettings(patch as Partial<SettingsT>); };
  const clear = (keys: RepoSettingKey[]) => { const next = { ...own }; for (const k of keys) delete next[k]; void api.setRepoSettings(repoId!, next); };
  const money = { format: (v: number) => sym + String(Math.round(v * 100) / 100), parse: (x: string) => { const n = parseFloat(x.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; } };

  const sel = (k: 'defaultEffort' | 'permMode' | 'commitStyle' | 'mergeMethod' | 'autoMerge' | 'afterMerge', options: { value: string; label: string }[]) =>
    <Select value={st[k]} onChange={(e: any) => put({ [k]: e.target.value })} options={options} />;
  const sw = (k: 'runTests' | 'fetchBeforeSession' | 'autoPush' | 'commitTrailer' | 'prDraft' | 'openPrAfterCreate') =>
    <Switch checked={st[k]} onChange={(v: boolean) => put({ [k]: v })} />;
  const seg = (k: 'commitAuthor' | 'pushWhen' | 'deliver', options: { value: string; label: string }[]) =>
    <SegmentedControl value={st[k]} onChange={(v: string) => put({ [k]: v })} options={options} />;
  const area = (k: 'defaultInstructions' | 'copyFiles', placeholder: string) =>
    <textarea className="selectable" value={st[k]} rows={5} spellCheck={false} placeholder={placeholder} onChange={(e) => put({ [k]: e.target.value })} style={textarea} />;

  const live = repo ? app.sessions.filter((s) => s.repoId === repo.id && !s.archivedAt).length : 0;
  const hide = (hidden: boolean) => api.setRepoHidden(repo!.id, hidden).catch((e: any) => toast({ tone: 'error', title: 'Could not change that', description: String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '') }));
  if (repoId && !repo) return null;
  return <Overrides.Provider value={{ repoId, own, clear }}>
    <H sub={repo ? `Settings for sessions in ${repo.id}. Anything you leave alone follows the defaults under Defaults in Settings, and changes there reach this repository too.` : 'The settings every repository starts from. A repository can override any of them from its own Settings tab or its entry in this list; the rest follow what you set here.'}>{repo ? `${repo.id} settings` : 'Defaults'}</H>
    {repo ? <SettingRow title="Hide this repository" desc={live ? `${live} ${live === 1 ? 'session is' : 'sessions are'} not archived. Archive ${live === 1 ? 'it' : 'them'} to be able to hide the repository.` : 'Takes it out of the sidebar, the new session options and the pickers. Everything is kept, and it stays here to be shown again.'}>
      <Button size="sm" icon={repo.hidden ? 'eye' : 'eye-slash'} disabled={!repo.hidden && live > 0} onClick={() => void hide(!repo.hidden)}>{repo.hidden ? 'Unhide' : 'Hide'}</Button>
    </SettingRow> : null}
    {repo && Object.keys(own).length ? <SettingRow title="Overrides" desc={`${Object.keys(own).length} ${Object.keys(own).length === 1 ? 'setting differs' : 'settings differ'} from the defaults.`}><Button size="sm" onClick={() => clear([...REPO_SETTING_KEYS])}>Use all defaults</Button></SettingRow> : null}

    <H>Sessions</H>
    <Row keys={['defaultBackend', 'defaultModel']} title="Agent and model" desc="New sessions start with this. Models of every agent you are signed in to are listed.">
      <Select value={defaultChoice({ ...app, settings: st }, undefined)} onChange={(e: any) => { const c = splitChoice(e.target.value); put({ defaultBackend: c.backend, defaultModel: c.model as any }); }} options={modelChoices(app)} />
    </Row>
    <Row keys={['defaultEffort']} title="Effort" desc="How hard new sessions think. Default leaves it to the agent.">{sel('defaultEffort', EFFORT_OPTIONS as any)}</Row>
    <Row keys={['permMode']} title="Permissions" desc="What a new session may do without asking.">{sel('permMode', PERM_OPTIONS)}</Row>
    <Row keys={['sessionBudget']} title="Session limit" desc="The most a session may spend before it pauses, when it is paid for per token.">
      <Field value={to(st.sessionBudget)} onCommit={(v: number) => put({ sessionBudget: from(v) })} {...money} style={{ width: 100 }} />
    </Row>
    <Row keys={['runTests']} title="Run the tests before finishing" desc="Asks the agent to run the project's tests, when it has any, and report the result.">{sw('runTests')}</Row>
    <Row keys={['defaultInstructions']} title="Standing instructions" desc="Added to every session's instructions, for example “Use pnpm, not npm.”">{area('defaultInstructions', 'Use pnpm, not npm.')}</Row>

    <H>Branches and worktrees</H>
    <Row keys={['branchPrefix']} title="Branch prefix" desc="New sessions branch off the default branch with this in front of their name."><Field value={st.branchPrefix} onCommit={(v: string) => put({ branchPrefix: v })} style={{ width: 120 }} /></Row>
    <Row keys={['fetchBeforeSession']} title="Fetch before a new session" desc="Fetches from GitHub just before branching, so the session starts from the latest.">{sw('fetchBeforeSession')}</Row>
    <Row keys={['copyFiles']} title="Copy untracked files" desc="Files from your checkout that git does not track, copied into each new worktree. One pattern per line, in .gitignore format.">{area('copyFiles', '.env\n.env.local')}</Row>

    <H>Commits</H>
    <Row keys={['commitStyle']} title="Commit messages" desc="Plain leaves the wording to the agent. Conventional asks for “type(scope): summary”.">{sel('commitStyle', [{ value: 'plain', label: 'Plain' }, { value: 'conventional', label: 'Conventional commits' }])}</Row>
    <Row keys={['commitTrailer']} title="Session trailer" desc="Ends each commit message with a trailer naming the session.">{sw('commitTrailer')}</Row>
    <Row keys={['commitAuthor']} title="Commits are credited to" desc="You with the agent as a co-author, or the agent alone.">{seg('commitAuthor', [{ value: 'coauthor', label: 'You and the agent' }, { value: 'sole', label: 'The agent' }])}</Row>
    <Row keys={['autoPush']} title="Push after commits" desc="Pushes the session's branch to GitHub automatically.">{sw('autoPush')}</Row>
    {st.autoPush ? <Row keys={['pushWhen']} title="Push" desc="After every commit, or once when the session is ready for review.">{seg('pushWhen', [{ value: 'commit', label: 'After each commit' }, { value: 'ready', label: 'When ready' }])}</Row> : null}

    <H>Delivering work</H>
    <Row keys={['deliver']} title="When a session is ready" desc="Open a pull request for review, or push straight onto the default branch.">{seg('deliver', [{ value: 'pr', label: 'Pull request' }, { value: 'merge', label: 'Merge directly' }])}</Row>
    <Row keys={['prDraft']} title="Open pull requests as drafts">{sw('prDraft')}</Row>
    <Row keys={['openPrAfterCreate']} title="Open new pull requests in the browser">{sw('openPrAfterCreate')}</Row>
    <Row keys={['mergeMethod']} title="Merge pull requests by" desc="The default when you merge from helm.">{sel('mergeMethod', [{ value: 'merge', label: 'Merge commit' }, { value: 'squash', label: 'Squash and merge' }, { value: 'rebase', label: 'Rebase and merge' }])}</Row>
    <Row keys={['autoMerge']} title="Merge automatically" desc="Merges a pull request opened from helm by itself once it meets this.">{sel('autoMerge', [{ value: 'off', label: 'Off' }, { value: 'checks', label: 'When checks pass' }, { value: 'approved', label: 'When checks pass and approved' }])}</Row>
    <Row keys={['afterMerge']} title="When its work is merged" desc="What happens to the session once its work is merged.">{sel('afterMerge', [{ value: 'archive', label: 'Archive it' }, { value: 'delete', label: 'Delete it' }, { value: 'keep', label: 'Leave it' }])}</Row>
  </Overrides.Provider>;
}
