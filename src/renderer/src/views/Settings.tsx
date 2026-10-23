import React from 'react';
import type { ModelAlias, PermMode, Settings as SettingsT } from '@shared/types';
import { api } from '../api';
import { livePlan, untilReset } from '../lib';
import { CURRENCIES, rateFor } from '@shared/money';
import { BUNDLED_FONTS, fontStack, SYSTEM_DEFAULT, systemFonts, systemUiFonts, uiStack, UI_BUNDLED_FONTS, dataStack } from '../fonts';
import { toast, useApp, useMoney } from '../store';
import { Avatar, Badge, Button, Input, Meter, SegmentedControl, Select, Switch, TreeItem, useColumns } from '../ui';

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

const H = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
    <h2 style={{ margin: 0, font: '600 16px/1.3 var(--font-sans)' }}>{children}</h2>
    {sub ? <span style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-3)' }}>{sub}</span> : null}
  </div>
);

/** A font choice: bundled fonts, fonts installed on this computer, or any family typed in. */
function FontRow({ title, desc, value, onChange, bundled, system, stack }: { title: string; desc: string; value: string; onChange(v: string): void; bundled: string[]; system: string[]; stack(n: string): string }) {
  const known = bundled.includes(value) || system.includes(value);
  const [typed, setTyped] = React.useState('');
  return (
    <>
      <SettingRow title={title} desc={desc}>
        <span style={{ font: '400 14px/1 ' + stack(value), color: 'var(--text-3)', maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden' }}>Aa 0123</span>
        <Select value={known ? value : '__custom'} onChange={(e: any) => onChange(e.target.value === '__custom' ? (typed || value) : e.target.value)}
          options={[...bundled.map((f) => ({ value: f, label: f })), ...system.map((f) => ({ value: f, label: f === SYSTEM_DEFAULT ? f : f + ' (installed)' })), { value: '__custom', label: 'Custom…' }]} />
      </SettingRow>
      {!known ? <SettingRow title="Font family" desc="The name of any font installed on this computer."><Field value={value} onCommit={(v: string) => { setTyped(v); if (v.trim()) onChange(v.trim()); }} style={{ width: 220 }} /></SettingRow> : null}
    </>
  );
}

export function Settings({ section }: { section?: string }) {
  const app = useApp();
  const st = app.settings;
  const [sec, setSec] = React.useState(section || 'account');
  const { fmt, sym, to, from, cur } = useMoney();
  const plan = livePlan(app);
  const money0 = { format: (v: number) => sym + String(Math.round(v * 100) / 100), parse: (x: string) => { const n = parseFloat(x.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; } };
  const repoCols = useColumns('budget-repos', [{ w: 1, min: 160, flex: true }, { w: 220, min: 120 }, { w: 90, min: 70, fixed: true }]);
  const monoSystem = React.useMemo(() => systemFonts(), []);
  const uiSystem = React.useMemo(() => systemUiFonts(), []);
  const subCols = useColumns('subagent-repos', [{ w: 1, min: 160, flex: true }, { w: 170, min: 110, fixed: true }]);
  const pctOptions = [{ value: '0', label: 'Off' }, { value: '50', label: '50%' }, { value: '70', label: '70%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }];
  const subLimits = (extra: number[]) => [...new Set([0, 1, 2, 3, 4, 6, 8, 12, ...extra])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 0 ? 'Off' : String(n) }));
  const nav = [['account', 'Account', 'github-logo'], ['agents', 'Claude Code', 'robot'], ['worktrees', 'Worktrees', 'tree-structure'], ['budgets', 'Usage', 'coins'], ['notifications', 'Notifications', 'bell'], ['appearance', 'Appearance', 'paint-brush']];
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
            <SettingRow title="Subagents per session" desc="Most subagents one session may run at once. Off stops agents from starting any. A session can override this."><Select value={String(st.maxSubagentsSession)} onChange={(e: any) => set({ maxSubagentsSession: +e.target.value })} options={subLimits([st.maxSubagentsSession])} /></SettingRow>
            <SettingRow title="Subagents per repository" desc="Most subagents that may run at once across every session of a repository."><Select value={String(st.maxSubagentsRepo)} onChange={(e: any) => set({ maxSubagentsRepo: +e.target.value })} options={subLimits([st.maxSubagentsRepo, 16, 24])} /></SettingRow>
            {app.repos.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: subCols.template, gap: 12, padding: '8px 0', font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                  {subCols.cell(0, 'Repository')}<span>Subagent limit</span>
                </div>
                {app.repos.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: subCols.template, gap: 12, alignItems: 'center', minHeight: 38, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ font: '400 12.5px/1 var(--font-mono)' }}>{r.id}</span>
                    <Select size="sm" value={r.maxSubagents == null ? 'default' : String(r.maxSubagents)} onChange={(e: any) => void api.setRepoMaxSubagents(r.id, e.target.value === 'default' ? null : +e.target.value)}
                      options={[{ value: 'default', label: 'Default (' + st.maxSubagentsRepo + ')' }, ...subLimits([]).map((o) => ({ value: o.value, label: o.value === '0' ? 'Off' : 'Up to ' + o.value }))]} />
                  </div>
                ))}
              </div>
            ) : null}
            <SettingRow title="Remote Control for new and resumed sessions" desc="Starts Remote Control (/rc) in every agent, so you can follow and drive it from claude.ai/code or the Claude app. Takes effect when a session next starts. Needs a Claude subscription sign-in, and can be blocked by your organisation."><Switch checked={st.remoteControl} onChange={(v: boolean) => set({ remoteControl: v })} /></SettingRow>
            <SettingRow title="Run tests before marking ready" desc="Asks the agent to run the project's tests (package.json, go.mod, Makefile) before it finishes."><Switch checked={st.runTests} onChange={(v: boolean) => set({ runTests: v })} /></SettingRow>
          </> : null}
          {sec === 'worktrees' ? <>
            <H sub="Every session gets its own git worktree and branch, so agents never touch your working copy or each other.">Worktrees</H>
            <SettingRow title="Location"><Field value={st.worktreeRoot} onCommit={(v: string) => set({ worktreeRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Clone location" desc="Repositories cloned from GitHub go to <location>/<owner>/<name>."><Field value={st.cloneRoot} onCommit={(v: string) => set({ cloneRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Branch prefix" desc="New sessions branch from the repository's default branch."><Field value={st.branchPrefix} onCommit={(v: string) => set({ branchPrefix: v })} style={{ width: 120 }} /></SettingRow>
            <SettingRow title="Archive sessions not opened for" desc="Archived sessions leave the left tree and Overview, and stay in the Archive. Their worktree and branch are kept. Sessions that are running, waiting on you, or finished but not yet reviewed are never archived automatically.">
              <Select value={String(st.archiveAfterDays)} onChange={(e: any) => set({ archiveAfterDays: +e.target.value })}
                options={[{ value: '0', label: 'Never' }, ...[3, 7, 14, 30, 60, 90].map((n) => ({ value: String(n), label: n + ' days' }))]} />
            </SettingRow>
            <SettingRow title="Merge pull requests by" desc="The default when you merge a pull request from helm. You can change it each time.">
              <Select value={st.mergeMethod} onChange={(e: any) => set({ mergeMethod: e.target.value })} options={[{ value: 'merge', label: 'Merge commit' }, { value: 'squash', label: 'Squash and merge' }, { value: 'rebase', label: 'Rebase and merge' }]} />
            </SettingRow>
            <SettingRow title="When a session is ready" desc="Open a pull request for review, or skip it and push the branch straight onto the default branch. You can still choose per session on its Changes tab. A protected branch refuses direct pushes.">
              <SegmentedControl value={st.deliver} onChange={(v: string) => set({ deliver: v as any })} options={[{ value: 'pr', label: 'Pull request' }, { value: 'merge', label: 'Merge directly' }]} />
            </SettingRow>
            <SettingRow title="When its work is merged" desc="What happens to the session once its pull request is merged or it is merged directly. Archiving keeps the conversation and numbers in the Archive; the worktree is removed separately, below.">
              <Select value={st.afterMerge} onChange={(e: any) => set({ afterMerge: e.target.value })} options={[{ value: 'archive', label: 'Archive it' }, { value: 'delete', label: 'Delete it' }, { value: 'keep', label: 'Leave it' }]} />
            </SettingRow>
            <SettingRow title="Remove worktree after merge" desc="Applies to pull requests opened from helm."><Switch checked={st.removeAfterMerge} onChange={(v: boolean) => set({ removeAfterMerge: v })} /></SettingRow>
            <SettingRow title="Copy untracked files" desc={<>Files from your checkout that git does not track, copied into each new worktree. One pattern per line, in .gitignore format: <code>.env</code>, <code>config/*.local.json</code>, <code>**/secrets.*</code>, <code>!keep.env</code> to exclude, <code>#</code> for a comment. Tracked files are never copied.</>}>
              <textarea className="selectable" value={st.copyFiles} rows={5} spellCheck={false} placeholder={'.env\n.env.local'} onChange={(e) => set({ copyFiles: e.target.value })}
                style={{ width: 280, resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' }} />
            </SettingRow>
          </> : null}
          {sec === 'budgets' ? <>
            <H sub="How helm measures and limits usage. Pick the option that matches how you pay for Claude.">Usage</H>
            <SettingRow title="Billing" desc={st.billing === 'subscription' ? 'A Claude subscription (Pro or Max). Usage is limited by plan windows, not dollars, so helm shows plan usage and has no dollar budgets.' : 'Pay per token with an API key. helm tracks cost and enforces the dollar budgets below.'}>
              <SegmentedControl value={st.billing} onChange={(v: string) => set({ billing: v as any, billingDetected: true })} options={[{ value: 'subscription', label: 'Subscription' }, { value: 'api', label: 'API tokens' }]} />
            </SettingRow>
            <SettingRow title="Currency" desc={`Used wherever an amount is shown. 1 USD = ${rateFor(cur, app.rates).toFixed(rateFor(cur, app.rates) > 20 ? 0 : 2)} ${cur}.`}>
              <Select value={cur} onChange={(e: any) => {
                // Round limits to whole amounts in the new currency, so $100 becomes £75 rather than £74.76.
                const next = e.target.value as string;
                const r = rateFor(next, app.rates);
                const snap = (usd: number) => Math.max(1, Math.round(usd * r)) / r;
                set({ currency: next, currencyDetected: true, weeklyLimit: snap(st.weeklyLimit), sessionBudget: snap(st.sessionBudget) });
                for (const repo of app.repos) void api.setRepoCap(repo.id, snap(repo.cap));
              }} options={CURRENCIES as any} />
            </SettingRow>
            {st.billing === 'subscription' ? <>
              <SettingRow title="Current plan usage" desc="Reported by Claude Code after each message. A window resets by itself.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
                  <Meter label="5-hour window" value={plan.fiveHour?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={plan.fiveHour ? `${Math.round(plan.fiveHour.util * 100)}% · resets ${untilReset(plan.fiveHour.resetsAt)}` : 'no data yet'} />
                  <Meter label="Weekly" value={plan.weekly?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={plan.weekly ? `${Math.round(plan.weekly.util * 100)}% · resets ${untilReset(plan.weekly.resetsAt)}` : 'no data yet'} />
                </div>
              </SettingRow>
              <SettingRow title="Pause agents at 5-hour usage" desc="Running sessions pause and wait in Needs you when the 5-hour window reaches this. You can continue anyway until it resets."><SegmentedControl size="sm" value={String(st.planPause5h)} onChange={(v: string) => set({ planPause5h: +v })} options={pctOptions} /></SettingRow>
              <SettingRow title="Pause agents at weekly usage" desc="The same for the weekly limit."><SegmentedControl size="sm" value={String(st.planPauseWeek)} onChange={(v: string) => set({ planPauseWeek: +v })} options={pctOptions} /></SettingRow>
              <SettingRow title="Warn at" desc="Meters turn amber at this share of a window."><SegmentedControl size="sm" value={String(st.warnAt)} onChange={(v: string) => set({ warnAt: +v })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }]} /></SettingRow>
            </> : <>
              <SettingRow title="Weekly limit, all repositories" desc="Agents pause when a limit is reached and wait in Needs you."><Field value={to(st.weeklyLimit)} onCommit={(v: number) => set({ weeklyLimit: from(v) })} {...money0} style={{ width: 100 }} /></SettingRow>
              <SettingRow title="Default per-session limit"><Field value={to(st.sessionBudget)} onCommit={(v: number) => set({ sessionBudget: from(v) })} {...money0} style={{ width: 100 }} /></SettingRow>
              <SettingRow title="Warn at"><SegmentedControl size="sm" value={String(st.warnAt)} onChange={(v: string) => set({ warnAt: +v })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }]} /></SettingRow>
              <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
                {app.repos.length === 0 ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>Add a repository to set its weekly cap.</span> : (
                  <div style={{ display: 'grid', gridTemplateColumns: repoCols.template, gap: 16, padding: '8px 0', font: '500 10.5px/1 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {repoCols.cell(0, 'Repository')}{repoCols.cell(1, 'This week')}<span>Weekly cap</span>
                  </div>
                )}
                {app.repos.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: repoCols.template, gap: 16, alignItems: 'center', minHeight: 40, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ font: '400 12.5px/1 var(--font-mono)' }}>{r.id}</span>
                    <Meter value={app.weekSpend[r.id] || 0} max={r.cap} warnAt={st.warnAt / 100} detail={fmt(app.weekSpend[r.id] || 0)} />
                    <Field size="sm" value={to(r.cap)} onCommit={(v: number) => void api.setRepoCap(r.id, from(v))} {...money0} />
                  </div>
                ))}
              </div>
            </>}
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
            <FontRow title="Interface font" desc="Labels, titles and prose throughout helm." value={st.uiFont} onChange={(v: string) => set({ uiFont: v })} bundled={UI_BUNDLED_FONTS} system={[SYSTEM_DEFAULT, ...uiSystem]} stack={uiStack} />
            <FontRow title="Data font" desc="Monospaced text in the interface: paths, branches, hashes, counts and costs." value={st.dataFont} onChange={(v: string) => set({ dataFont: v })} bundled={BUNDLED_FONTS} system={monoSystem} stack={dataStack} />
            <FontRow title="Code font" desc="The editor, terminal and diffs." value={st.editorFont} onChange={(v: string) => set({ editorFont: v })} bundled={BUNDLED_FONTS} system={monoSystem} stack={fontStack} />
            <SettingRow title="Ligatures" desc="Draw combinations such as => and !== as single symbols, in code fonts that have them."><Switch checked={st.editorLigatures} onChange={(v: boolean) => set({ editorLigatures: v })} /></SettingRow>
            <div style={{ margin: '4px 0 10px', padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--bg-editor)', boxShadow: 'inset 0 0 0 1px var(--border-subtle)', fontFamily: fontStack(st.editorFont), fontSize: st.editorFontSize, lineHeight: '20px', fontVariantLigatures: st.editorLigatures ? 'normal' : 'none', color: 'var(--text-1)', whiteSpace: 'pre', overflow: 'auto' }} className="selectable">
{`const total = items.filter((i) => i.price >= 0 && i.id !== null)
  .reduce((sum, i) => sum + i.price, 0); // => 0O 1lI {}[]()`}
            </div>
            <SettingRow title="Editor font size"><Select value={String(st.editorFontSize)} onChange={(e: any) => set({ editorFontSize: +e.target.value })} options={['12', '12.5', '13', '14']} /></SettingRow>
            <SettingRow title="Open files in" desc="Used by Open in editor."><Select value={st.openIn} onChange={(e: any) => set({ openIn: e.target.value })} options={['helm', 'VS Code', 'Cursor', 'Zed']} /></SettingRow>
          </> : null}
        </div>
      </div>
    </div>
  );
}
