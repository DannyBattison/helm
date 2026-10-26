import React from 'react';
import type { ModelAlias, PermMode, Settings as SettingsT } from '@shared/types';
import { api, platform } from '../api';
import { livePlan, theme as resolveTheme, untilReset } from '../lib';
import { CURRENCIES, rateFor } from '@shared/money';
import { BUNDLED_FONTS, fontStack, SYSTEM_DEFAULT, systemFonts, systemUiFonts, uiStack, UI_BUNDLED_FONTS, dataStack } from '../fonts';
import { ACCENT_SWATCHES, SCHEMES, STATUS_KEYS, STATUS_LABEL, isHex, schemeVars } from '@shared/schemes';
import { AutomationsSection } from './Automations';
import { toast, useApp, useMoney } from '../store';
import { comboFromEvent, comboKeys, comboProblem, normalizeCombo, SHORTCUT_ACTIONS, shortcutConflict, shortcutOf } from '@shared/shortcuts';
import { Avatar, Badge, Button, Dialog, Input, Kbd, Meter, SegmentedControl, Select, Switch, TreeItem, useColumns, useNarrow } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const set = (patch: Partial<SettingsT>) => void api.updateSettings(patch);

export const PERM_OPTIONS = [{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits, ask for commands' }, { value: 'plan', label: 'Plan only' }, { value: 'all', label: 'Allow everything' }];
export const MODEL_OPTIONS = [{ value: 'sonnet', label: 'Sonnet' }, { value: 'opus', label: 'Opus' }, { value: 'haiku', label: 'Haiku' }];

/** Which shell the terminal starts: whatever is installed here, or any command. Changes apply to terminals opened after it. */
function TerminalShellRow({ st, set }: { st: any; set(p: any): void }) {
  const [shells, setShells] = React.useState<{ id: string; label: string }[] | null>(null);
  React.useEffect(() => { api.listShells().then(setShells).catch(() => setShells([])); }, []);
  const options = [{ value: 'auto', label: shells?.[0] ? `Automatic (${shells[0].label})` : 'Automatic' }, ...(shells || []).map((s) => ({ value: s.id, label: s.label })), { value: 'custom', label: 'Other command…' }];
  return (
    <SettingRow title="Terminal shell" desc={<>Automatic prefers zsh when it is installed, then Git Bash, WSL, PowerShell. WSL distributions appear here too; to get zsh on Windows, install it in WSL and choose that. Applies to terminals opened after the change.</>}>
      <Select value={st.terminalShell} onChange={(e: any) => set({ terminalShell: e.target.value })} options={options} />
      {st.terminalShell === 'custom' ? <Field value={st.terminalShellCustom} onCommit={(v: string) => set({ terminalShellCustom: v })} placeholder="wsl.exe -d Ubuntu -e zsh" style={{ width: 240 }} /> : null}
    </SettingRow>
  );
}

/** Files uploaded to a repository: copied into every session's worktree and kept out of git (secrets, data, notes that are not committed). */
function RepoArtifactsSection({ repos }: { repos: { id: string }[] }) {
  const [repoId, setRepoId] = React.useState(repos[0]?.id || '');
  const [files, setFiles] = React.useState<{ name: string; size: number }[]>([]);
  const pick = React.useRef<HTMLInputElement>(null);
  const id = repos.some((r) => r.id === repoId) ? repoId : repos[0]?.id || '';
  const load = React.useCallback(() => { if (id) api.listRepoArtifacts(id).then(setFiles).catch(() => setFiles([])); }, [id]);
  React.useEffect(load, [load]);
  const upload = async (list: FileList | null) => {
    for (const f of Array.from(list || [])) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        await api.addRepoArtifact(id, f.name, btoa(bin));
      } catch (e) { toast({ tone: 'error', title: 'Could not upload artifact ' + f.name, description: errText(e) }); }
    }
    if (pick.current) pick.current.value = '';
    load();
  };
  return (
    <SettingRow title="Artifacts" desc="Files copied into every session of a repository, at the top of its worktree, and kept out of commits. Sessions already open get them when the agent next starts. Up to 25 MB each.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
        <Select size="sm" value={id} onChange={(e: any) => setRepoId(e.target.value)} options={repos.map((r) => ({ value: r.id, label: r.id }))} />
        {files.map((f) => (
          <div key={f.name} style={{ display: 'flex', gap: 8, alignItems: 'center', font: '400 12.5px/1 var(--font-mono)' }}>
            <span>{f.name}</span><span style={{ color: 'var(--text-3)' }}>{f.size < 1024 ? f.size + ' B' : f.size < 1048576 ? Math.round(f.size / 1024) + ' KB' : (f.size / 1048576).toFixed(1) + ' MB'}</span>
            <Button size="sm" onClick={() => void api.removeRepoArtifact(id, f.name).then(load)}>Remove</Button>
          </div>
        ))}
        <input ref={pick} type="file" multiple style={{ display: 'none' }} onChange={(e) => void upload(e.target.files)} />
        <Button size="sm" icon="upload-simple" onClick={() => pick.current?.click()}>Upload artifacts…</Button>
      </div>
    </SettingRow>
  );
}

/** The companion website: turn it on, link this computer, see who is connected. */
function CompanionSection({ st, set, state }: { st: any; set(p: any): void; state: any }) {
  const label = ({ off: 'Off', linking: 'Waiting for you to sign in to GitHub', connecting: 'Connecting…', connected: 'Connected', error: 'Not connected' } as any)[state.state] || state.state;
  const tone = state.state === 'connected' ? 'var(--status-ready-text, var(--status-ready))' : state.state === 'error' ? 'var(--status-error-text)' : 'var(--text-3)';
  return <>
    <H sub="See your agents and answer them from a phone or another computer. Off by default: nothing leaves this computer until you turn it on.">Companion</H>
    <SettingRow title="Enable companion" desc="Connects helm to your companion server and keeps it connected while helm is open. Without it, the companion website shows an “enable in settings” page.">
      <Switch checked={st.companionEnabled} onChange={(v: boolean) => set({ companionEnabled: v })} />
    </SettingRow>
    <SettingRow title="Companion server" desc="The address of your helm-companion server. helm never sends your GitHub token to it.">
      <Field value={st.companionUrl} onCommit={(v: string) => set({ companionUrl: v.trim() })} placeholder="https://companion.example.com" style={{ width: 280 }} />
    </SettingRow>
    <SettingRow title="Status" desc={state.state === 'connected' ? `Linked as ${state.login}. ${state.viewers ? `${state.viewers} ${state.viewers === 1 ? 'page is' : 'pages are'} open on the website.` : 'No page is open on the website.'}` : state.error || (state.state === 'off' ? 'Turn the companion on to link this computer.' : undefined)}>
      <span style={{ font: '500 12.5px/1.5 var(--font-sans)', color: tone, display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className={'ph-fill ph-circle'} style={{ fontSize: 8 }} />{label}</span>
      {st.companionUrl && state.state === 'connected' ? <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal(st.companionUrl)}>Open website</Button> : null}
    </SettingRow>
    {state.state === 'linking' ? (
      <div style={{ margin: '4px 0 12px', padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>Link this computer</span>
        {state.linkCode ? <>
          <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>Open GitHub and enter this code, signed in as the account you use in helm. It asks for no permissions: it only tells the companion which username this is.</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="selectable" style={{ font: '700 22px/1.5 var(--font-mono)', letterSpacing: '.12em' }}>{state.linkCode.userCode}</span>
            <Button size="sm" icon="copy" onClick={() => api.copyText(state.linkCode.userCode)}>Copy</Button>
            <Button size="sm" variant="primary" iconRight="arrow-square-out" onClick={() => api.openExternal(state.linkCode.verificationUri)}>Open GitHub</Button>
          </div>
        </> : <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Contacting the server…</span>}
      </div>
    ) : null}
    <SettingRow title="Let the website control agents" desc="Allows approving commands, answering questions, sending messages, pausing, stopping and starting sessions from the website. Turn off to make it read-only.">
      <Switch checked={st.companionControl} onChange={(v: boolean) => set({ companionControl: v })} />
    </SettingRow>
    <SettingRow title="What is sent" desc="A summary of each session (title, status, branch, tokens, any question it is waiting on), recent activity, plan usage, and the conversation of a session while someone has it open on the website. Commands and messages pass through your server. File contents and your GitHub token are never sent." />
    <SettingRow title="Unlink this computer" desc="Forget the link. Turning the companion on again signs in to GitHub afresh.">
      <Button size="sm" variant="ghost" icon="link-break" disabled={state.state === 'off' && !st.companionEnabled} onClick={() => api.companionUnlink()}>Unlink</Button>
    </SettingRow>
  </>;
}

/** Every shortcut that can be changed. Click one, then press the new keys; Esc cancels and Backspace turns the shortcut off. */
function ShortcutsSection({ st, set }: { st: SettingsT; set(p: Partial<SettingsT>): void }) {
  const mac = platform() === 'darwin';
  const [editing, setEditing] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ id: string; text: string } | null>(null);
  const mine = st.shortcuts || {};
  const save = (id: string, combo: string) => {
    const next = { ...mine };
    if (combo === SHORTCUT_ACTIONS.find((a) => a.id === id)!.default) delete next[id]; else next[id] = combo;
    set({ shortcuts: next });
  };
  React.useEffect(() => {
    if (!editing) return;
    // Capture phase, so the shortcut being pressed does not also run the action it is currently set to.
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setEditing(null); setMsg(null); return; }
      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) { save(editing, ''); setEditing(null); setMsg(null); return; }
      const combo = comboFromEvent(e, mac);
      if (!combo) return;
      const problem = comboProblem(combo);
      if (problem) { setMsg({ id: editing, text: problem }); return; }
      const clash = shortcutConflict(mine, editing, combo);
      if (clash) { setMsg({ id: editing, text: `Already used for “${clash.label}”. Change that one first.` }); return; }
      save(editing, normalizeCombo(combo));
      setEditing(null); setMsg(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, mine]);
  const changed = Object.keys(mine).length > 0;
  return <>
    <H sub="Click a shortcut, then press the keys you want. Mod is Cmd on a Mac and Ctrl everywhere else.">Keyboard shortcuts</H>
    {SHORTCUT_ACTIONS.map((a) => {
      const combo = shortcutOf(mine, a.id);
      const isEditing = editing === a.id;
      return (
        <SettingRow key={a.id} title={a.label} desc={msg?.id === a.id ? <span style={{ color: 'var(--status-attention-text)' }}>{msg.text}</span> : a.desc}>
          <button type="button" onClick={() => { setEditing(isEditing ? null : a.id); setMsg(null); }} aria-label={`Change the shortcut for ${a.label}`}
            style={{ minWidth: 120, height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', cursor: 'pointer', color: 'var(--text-2)', font: '400 12px/1.5 var(--font-sans)', boxShadow: isEditing ? 'var(--ring-focus), inset 0 0 0 1px var(--accent)' : 'inset 0 0 0 1px var(--border-strong)' }}>
            {isEditing ? 'Press the keys…' : combo ? <Kbd keys={comboKeys(combo, mac)} /> : 'Not set'}
          </button>
          <Button size="sm" variant="ghost" icon="arrow-counter-clockwise" disabled={!(a.id in mine)} onClick={() => { const next = { ...mine }; delete next[a.id]; set({ shortcuts: next }); }}>Reset</Button>
        </SettingRow>
      );
    })}
    <SettingRow title="Reset all" desc="Puts every shortcut back to its default.">
      <Button size="sm" disabled={!changed} onClick={() => { set({ shortcuts: {} }); setEditing(null); setMsg(null); }}>Reset all shortcuts</Button>
    </SettingRow>
  </>;
}

/** Scheme cards, an accent row, and the status colours tucked behind a disclosure so the page stays short. */
function ColourRows({ st, set }: { st: SettingsT; set: (p: Partial<SettingsT>) => void }) {
  const [more, setMore] = React.useState(false);
  // From the setting, not the DOM: the attribute is only updated in an effect after this render.
  const dark = resolveTheme(st.theme) === 'dark';
  const accentNow = st.accentColor || schemeVars({ scheme: st.colorScheme }, dark)['--accent'] || (dark ? '#a78bfa' : '#7655d9');
  const swatch = (c: string, on: boolean, onClick: () => void, label: string) => (
    <button key={c} type="button" aria-label={label} title={label} aria-pressed={on} onClick={onClick} style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: c, cursor: 'pointer', boxShadow: on ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--text-2)' : 'inset 0 0 0 1px var(--border-strong)' }} />
  );
  const custom = (value: string, onPick: (c: string) => void, label: string) => <input type="color" aria-label={label} title={label} value={isHex(value) ? value : '#888888'} onChange={(e) => onPick(e.target.value)} style={{ width: 28, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />;
  const changed = st.colorScheme !== 'helm' || st.accentColor || Object.keys(st.statusColors || {}).length;
  return <>
    <SettingRow title="Colour scheme" desc="Tints the backgrounds and sets the accent. Works with the light and dark themes.">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', maxWidth: 360 }}>
        {SCHEMES.map((sc) => {
          const v = schemeVars({ scheme: sc.id }, dark), on = st.colorScheme === sc.id;
          return (
            <button key={sc.id} type="button" onClick={() => set({ colorScheme: sc.id })} aria-pressed={on} style={{ width: 104, padding: 6, display: 'flex', flexDirection: 'column', gap: 6, border: 'none', borderRadius: 'var(--radius-md)', background: v['--bg-app'] || 'var(--bg-app)', cursor: 'pointer', color: 'var(--text-1)', font: '500 12px/1.4 var(--font-sans)', boxShadow: on ? '0 0 0 2px var(--accent)' : 'inset 0 0 0 1px var(--border-strong)' }}>
              <span style={{ display: 'flex', gap: 4, height: 14 }}>
                <span style={{ flex: 1, borderRadius: 3, background: v['--bg-raised'] || 'var(--bg-raised)', boxShadow: `inset 0 0 0 1px ${v['--border'] || 'var(--border)'}` }} />
                <span style={{ width: 22, borderRadius: 3, background: v['--accent'] || (dark ? sc.dark : sc.light) }} />
              </span>
              <span style={{ textAlign: 'left' }}>{sc.name}</span>
            </button>
          );
        })}
      </div>
    </SettingRow>
    <SettingRow title="Accent colour" desc="Buttons, links, selection and focus. Leave it on the scheme's own, or pick another.">
      {swatch(accentNow, !st.accentColor, () => set({ accentColor: '' }), 'Scheme default')}
      {ACCENT_SWATCHES.map((c) => swatch(c, st.accentColor.toLowerCase() === c, () => set({ accentColor: c }), c))}
      {custom(accentNow, (c) => set({ accentColor: c }), 'Custom accent colour')}
    </SettingRow>
    <div style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 0' }}>
      <button type="button" onClick={() => setMore(!more)} aria-expanded={more} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-2)', font: '500 12px/1.5 var(--font-sans)' }}>
        <i className={'ph ph-caret-' + (more ? 'down' : 'right')} />More colours
      </button>
      {more ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {STATUS_KEYS.map((k) => {
          const cur = st.statusColors?.[k];
          const base = schemeVars({}, dark)[`--status-${k}`] || getComputedStyle(document.documentElement).getPropertyValue(`--status-${k}`).trim();
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, font: '400 12px/1.5 var(--font-sans)' }}>
              <span style={{ flex: 1 }}>{STATUS_LABEL[k]}</span>
              {cur ? <Button onClick={() => { const n = { ...st.statusColors }; delete n[k]; set({ statusColors: n }); }}>Reset</Button> : null}
              {custom(cur || (isHex(base) ? base : '#888888'), (c) => set({ statusColors: { ...st.statusColors, [k]: c } }), STATUS_LABEL[k] + ' colour')}
            </div>
          );
        })}
      </div> : null}
    </div>
    {changed ? <div style={{ paddingBottom: 10 }}><Button icon="arrow-counter-clockwise" onClick={() => set({ colorScheme: 'helm', accentColor: '', statusColors: {} })}>Reset colours</Button></div> : null}
  </>;
}

function SettingRow({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="helm-setting" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '14px 0', borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>{title}</span>
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
    <h2 style={{ margin: 0, font: '600 16px/1.5 var(--font-sans)' }}>{children}</h2>
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
  const narrow = useNarrow();
  const hosted = !!window.helmBridge.hosted;
  const app = useApp();
  const st = app.settings;
  const [sec, setSec] = React.useState(section || 'account');
  const [signOut, setSignOut] = React.useState(false);
  const { fmt, sym, to, from, cur } = useMoney();
  const plan = livePlan(app);
  const money0 = { format: (v: number) => sym + String(Math.round(v * 100) / 100), parse: (x: string) => { const n = parseFloat(x.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; } };
  const repoCols = useColumns('budget-repos', [{ w: 1, min: 160, flex: true }, { w: 220, min: 120 }, { w: 90, min: 70, fixed: true }]);
  const monoSystem = React.useMemo(() => systemFonts(), []);
  const uiSystem = React.useMemo(() => systemUiFonts(), []);
  const subCols = useColumns('subagent-repos', [{ w: 1, min: 160, flex: true }, { w: 170, min: 110, fixed: true }]);
  const pctOptions = [{ value: '0', label: 'Off' }, { value: '50', label: '50%' }, { value: '70', label: '70%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }];
  const subLimits = (extra: number[]) => [...new Set([0, 1, 2, 3, 4, 6, 8, 12, ...extra])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 0 ? 'Off' : String(n) }));
  const nav = [['account', 'Account', 'github-logo'], ['agents', 'Claude Code', 'robot'], ['automations', 'Automated agents', 'clock-clockwise'], ['worktrees', 'Worktrees', 'tree-structure'], ['budgets', 'Usage', 'coins'], ...(hosted ? [] : [['companion', 'Companion', 'broadcast']]), ['notifications', 'Notifications', 'bell'], ['appearance', 'Appearance', 'paint-brush'], ['shortcuts', 'Keyboard shortcuts', 'keyboard'], ['about', 'About and support', 'info']];
  const notif = (key: 'notifyAttention' | 'notifyReady' | 'notifyFailed' | 'notifyChecks', title: string) => (
    <SettingRow title={title}>
      <Switch checked={st[key].desktop} onChange={(v: boolean) => set({ [key]: { ...st[key], desktop: v } })} label="Desktop" />
      <Switch checked={st[key].sound} onChange={(v: boolean) => set({ [key]: { ...st[key], sound: v } })} label="Sound" />
    </SettingRow>
  );
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: narrow ? 'column' : 'row' }}>
      {narrow ? (
        <nav style={{ flex: 'none', padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex' }}>
          <SegmentedControl value={sec} onChange={setSec} options={nav.map(([value, label, icon]) => ({ value, label, icon }))} />
        </nav>
      ) : (
        <nav style={{ width: 200, flex: 'none', padding: '16px 8px', borderRight: '1px solid var(--border)' }}>
          {nav.map(([k, l, ic]) => <TreeItem key={k} icon={ic} label={l} selected={sec === k} onClick={() => setSec(k)} />)}
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: 720, padding: narrow ? '16px 14px 32px' : '24px 32px 40px' }}>
          {sec === 'account' ? <>
            <H sub="helm signs in with GitHub only. Repositories, pull requests and history all come from this account.">Account</H>
            <SettingRow title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={app.user?.login || '?'} src={app.user?.avatar || undefined} size={24} />{app.user?.name || app.user?.login} <Badge mono>@{app.user?.login}</Badge></span>} desc="Signed in with GitHub · scopes: repo, read:org, workflow">
              <Button variant="ghost" onClick={() => setSignOut(true)}>Sign out</Button>
            </SettingRow>
            <SettingRow title="Organisations" desc="Repositories from these organisations appear in Add repository.">
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{(app.user?.orgs || []).length ? app.user!.orgs.map((o) => <Badge key={o}>{o}</Badge>) : <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>None</span>}</span>
              <Button size="sm" iconRight="arrow-square-out" onClick={() => api.openExternal('https://github.com/settings/applications')}>Manage on GitHub</Button>
            </SettingRow>
            <SettingRow title="Commit identity" desc="Your git user.name and user.email are used for commits and pushes. Who agent commits are credited to is set under Claude Code." />
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
            {app.claudeLogin ? (
              <SettingRow title="Claude account" desc={app.claudeLogin.loggedIn
                ? (/key|token/.test(app.claudeLogin.method) ? `Using the ${app.claudeLogin.method} set in this server's environment.` : `Signed in with your Claude subscription${app.claudeLogin.email ? ` as ${app.claudeLogin.email}` : ''}${app.claudeLogin.plan ? ` (${app.claudeLogin.plan})` : ''}.`)
                : 'Not signed in. Agents cannot run until you sign in.'}>
                {app.claudeLogin.loggedIn && !/key|token/.test(app.claudeLogin.method) ? <Button size="sm" variant="ghost" onClick={() => void api.claudeLogout()}>Sign out</Button> : null}
              </SettingRow>
            ) : null}
            <SettingRow title="Default model"><Select value={st.defaultModel} onChange={(e: any) => set({ defaultModel: e.target.value as ModelAlias })} options={MODEL_OPTIONS} /></SettingRow>
            <SettingRow title="Permission mode" desc={st.permMode === 'all' ? 'Agents run every command and edit every file without asking. The worktree keeps them off your checkout, but they can still reach the network and files outside it. Pre-approved patterns and approvals no longer matter.' : 'What an agent can do without asking you first.'}><Select value={st.permMode} onChange={(e: any) => set({ permMode: e.target.value as PermMode })} options={PERM_OPTIONS} /></SettingRow>
            <SettingRow title="Always allowed commands" desc="Comma separated patterns. * matches anything. Added to when you choose Always allow.">
              <Field value={st.alwaysAllow} format={(v: string[]) => v.join(', ')} parse={(s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)} onCommit={(v: string[]) => set({ alwaysAllow: v })} style={{ width: 260 }} />
            </SettingRow>
            <SettingRow title="Sessions working at once" desc="More than this wait in a queue and start as others finish. Sessions waiting on you do not count. A queued session can be started by hand."><Select value={String(st.maxRunning)} onChange={(e: any) => set({ maxRunning: +e.target.value })} options={[0, 1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 0 ? 'No limit' : String(n) }))} /></SettingRow>
            <SettingRow title="Subagents per session" desc="Most subagents one session may run at once. Off stops agents from starting any. A session can override this."><Select value={String(st.maxSubagentsSession)} onChange={(e: any) => set({ maxSubagentsSession: +e.target.value })} options={subLimits([st.maxSubagentsSession])} /></SettingRow>
            <SettingRow title="Subagents per repository" desc="Most subagents that may run at once across every session of a repository."><Select value={String(st.maxSubagentsRepo)} onChange={(e: any) => set({ maxSubagentsRepo: +e.target.value })} options={subLimits([st.maxSubagentsRepo, 16, 24])} /></SettingRow>
            {app.repos.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: subCols.template, gap: 12, padding: '8px 0', font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                  {subCols.cell(0, 'Repository')}<span>Subagent limit</span>
                </div>
                {app.repos.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: subCols.template, gap: 12, alignItems: 'center', minHeight: 38, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ font: '400 12.5px/1.5 var(--font-mono)' }}>{r.id}</span>
                    <Select size="sm" value={r.maxSubagents == null ? 'default' : String(r.maxSubagents)} onChange={(e: any) => void api.setRepoMaxSubagents(r.id, e.target.value === 'default' ? null : +e.target.value)}
                      options={[{ value: 'default', label: 'Default (' + st.maxSubagentsRepo + ')' }, ...subLimits([]).map((o) => ({ value: o.value, label: o.value === '0' ? 'Off' : 'Up to ' + o.value }))]} />
                  </div>
                ))}
              </div>
            ) : null}
            {app.repos.length ? <RepoArtifactsSection repos={app.repos} /> : null}
            <SettingRow title="Remote Control for new and resumed sessions" desc="Starts Remote Control (/rc) in every agent, so you can follow and drive it from claude.ai/code or the Claude app. Takes effect when a session next starts. Needs a Claude subscription sign-in, and can be blocked by your organisation."><Switch checked={st.remoteControl} onChange={(v: boolean) => set({ remoteControl: v })} /></SettingRow>
            <SettingRow title="Auto push" desc="Pushes the branch to GitHub right after every commit, whether the agent or you made it from the Changes panel, so nothing exists only on this machine. Free agents have no remote and are not pushed. A failed push shows in the activity log and is tried again at the next commit."><Switch checked={st.autoPush} onChange={(v: boolean) => set({ autoPush: v })} /></SettingRow>
            <SettingRow title="Resume agents on launch" desc="When helm opens, agents that were working when it closed pick up where they left off, one after another. Agents waiting on your answer still wait for you, and archived or merged sessions stay as they are."><Switch checked={st.resumeOnLaunch} onChange={(v: boolean) => set({ resumeOnLaunch: v })} /></SettingRow>
            <SettingRow title="Commit author" desc="Co-author: commits are authored by you, with a Co-authored-by trailer for the session. Claude only: commits are authored by Claude, with no co-author. Takes effect when a session next starts.">
              <SegmentedControl value={st.commitAuthor} onChange={(v: string) => set({ commitAuthor: v as any })} options={[{ value: 'coauthor', label: 'Co-author' }, { value: 'sole', label: 'Claude only' }]} />
            </SettingRow>
            <SettingRow title="Send messages with" desc={st.sendKey === 'enter' ? 'Enter sends. Shift+Enter starts a new line.' : 'Ctrl+Enter (Cmd+Enter on a Mac) sends. Enter starts a new line.'}>
              <SegmentedControl value={st.sendKey} onChange={(v: string) => set({ sendKey: v as any })} options={[{ value: 'enter', label: 'Enter' }, { value: 'mod-enter', label: platform() === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter' }]} />
            </SettingRow>
            <SettingRow title="Interrupt a working agent with" desc="Pauses the agent where it is. The Interrupt button next to Send always works. Esc closes the @ file list first, without interrupting.">
              <SegmentedControl value={st.interruptKey} onChange={(v: string) => set({ interruptKey: v as any })} options={[{ value: 'esc', label: 'Esc' }, { value: 'double-esc', label: 'Esc twice' }, { value: 'off', label: 'Button only' }]} />
            </SettingRow>
            <SettingRow title="Run tests before marking ready" desc="Asks the agent to run the project's tests (package.json, go.mod, Makefile) before it finishes."><Switch checked={st.runTests} onChange={(v: boolean) => set({ runTests: v })} /></SettingRow>
          </> : null}
          {sec === 'worktrees' ? <>
            <SettingRow title="Free agents" desc="Lets you start agents that are not tied to a repository, for research, writing and one-off jobs. Turning it off hides the option when starting a session; free agents you already have keep working."><Switch checked={st.freeAgents} onChange={(v: boolean) => set({ freeAgents: v })} /></SettingRow>
            <SettingRow title="Free agents' folders" desc="Where a free agent's scratch folder is made. Agents that are not tied to a repository work in a folder of their own here, with git set up so you can see what changed."><Field value={st.freeRoot} onCommit={(v: string) => set({ freeRoot: v.trim() })} style={{ width: 260 }} /></SettingRow>
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
            <SettingRow title="Open new pull requests in the browser" desc="Opens the pull request on GitHub as soon as helm creates it."><Switch checked={st.openPrAfterCreate} onChange={(v: boolean) => set({ openPrAfterCreate: v })} /></SettingRow>
            <SettingRow title="When its work is merged" desc="What happens to the session once its pull request is merged or it is merged directly. Archiving keeps the conversation and numbers in the Archive; the worktree is removed separately, below.">
              <Select value={st.afterMerge} onChange={(e: any) => set({ afterMerge: e.target.value })} options={[{ value: 'archive', label: 'Archive it' }, { value: 'delete', label: 'Delete it' }, { value: 'keep', label: 'Leave it' }]} />
            </SettingRow>
            <SettingRow title="Remove worktree after merge" desc="Applies to pull requests opened from helm. Turned on automatically when the branch is deleted."><Switch checked={st.removeAfterMerge || st.deleteBranchAfterMerge} onChange={(v: boolean) => set({ removeAfterMerge: v })} /></SettingRow>
            <SettingRow title="Delete branch after merge" desc="Deletes the session's branch on your computer and on GitHub once its work is merged. git will not delete a checked-out branch, so the worktree is removed too."><Switch checked={st.deleteBranchAfterMerge} onChange={(v: boolean) => set({ deleteBranchAfterMerge: v })} /></SettingRow>
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
                {app.repos.length === 0 ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Add a repository to set its weekly cap.</span> : (
                  <div style={{ display: 'grid', gridTemplateColumns: repoCols.template, gap: 16, padding: '8px 0', font: '500 10.5px/1.5 var(--font-sans)', letterSpacing: 'var(--tracking-label)', textTransform: 'uppercase', color: 'var(--text-3)' }}>
                    {repoCols.cell(0, 'Repository')}{repoCols.cell(1, 'This week')}<span>Weekly cap</span>
                  </div>
                )}
                {app.repos.map((r) => (
                  <div key={r.id} style={{ display: 'grid', gridTemplateColumns: repoCols.template, gap: 16, alignItems: 'center', minHeight: 40, borderTop: '1px solid var(--border-subtle)' }}>
                    <span style={{ font: '400 12.5px/1.5 var(--font-mono)' }}>{r.id}</span>
                    <Meter value={app.weekSpend[r.id] || 0} max={r.cap} warnAt={st.warnAt / 100} detail={fmt(app.weekSpend[r.id] || 0)} />
                    <Field size="sm" value={to(r.cap)} onCommit={(v: number) => void api.setRepoCap(r.id, from(v))} {...money0} />
                  </div>
                ))}
              </div>
            </>}
          </> : null}
          {sec === 'automations' ? <AutomationsSection /> : null}
          {sec === 'companion' ? <CompanionSection st={st} set={set} state={app.companion} /> : null}
          {sec === 'notifications' ? <>
            <H sub="Desktop notifications are shown when helm is not the focused window. The taskbar or dock badge counts sessions that need you.">Notifications</H>
            {notif('notifyAttention', 'Agent needs approval or an answer')}
            {notif('notifyReady', 'Session ready for review')}
            {notif('notifyFailed', 'Session failed or hit its budget')}
            {notif('notifyChecks', 'Pull request checks finished')}
            <SettingRow title="Quiet hours" desc="No desktop notifications between these times. Sound is silenced too.">
              <Switch checked={st.quiet.enabled} onChange={(v: boolean) => set({ quiet: { ...st.quiet, enabled: v } })} />
              <Field value={st.quiet.from} onCommit={(v: string) => set({ quiet: { ...st.quiet, from: v } })} parse={(x: string) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(x.trim()) ? x.trim() : undefined)} style={{ width: 70 }} />
              <span style={{ color: 'var(--text-3)' }}>to</span>
              <Field value={st.quiet.to} onCommit={(v: string) => set({ quiet: { ...st.quiet, to: v } })} parse={(x: string) => (/^([01]?\d|2[0-3]):[0-5]\d$/.test(x.trim()) ? x.trim() : undefined)} style={{ width: 70 }} />
            </SettingRow>
            <SettingRow title="Still tell me when an agent is blocked" desc="During quiet hours, an approval or question still notifies you.">
              <Switch checked={st.quiet.allowAttention} onChange={(v: boolean) => set({ quiet: { ...st.quiet, allowAttention: v } })} />
            </SettingRow>
            {app.repos.length ? <>
              <H sub="Per repository. Only things that need you leaves out finished work and failed checks.">Repositories</H>
              {app.repos.map((r) => (
                <SettingRow key={r.id} title={<span style={{ font: '400 13px/1.5 var(--font-mono)' }}>{r.id}</span>}>
                  <Select size="sm" value={st.notifyRepo[r.id] || 'all'} onChange={(e: any) => set({ notifyRepo: { ...st.notifyRepo, [r.id]: e.target.value } })} options={[{ value: 'all', label: 'Everything' }, { value: 'attention', label: 'Only things that need you' }, { value: 'off', label: 'Nothing' }]} />
                </SettingRow>
              ))}
            </> : null}
            {hosted ? null : <>
            <H>System</H>
            <SettingRow title="Tray icon" desc="Keep helm in the system tray or menu bar, with a count of what needs you and a menu to jump to it."><Switch checked={st.tray} onChange={(v: boolean) => set({ tray: v })} /></SettingRow>
            </>}
          </> : null}
          {sec === 'shortcuts' ? <ShortcutsSection st={st} set={set} /> : null}
          {sec === 'about' ? <>
            <H sub="Updates, and what to send if something goes wrong.">About and support</H>
            {hosted ? null : <>
            <SettingRow title="Version" desc={app.update.state === 'dev' ? 'This is a development build, which does not update itself.' : app.update.state === 'ready' ? `Version ${app.update.version} is downloaded and installs when helm restarts.` : app.update.state === 'downloading' ? `Downloading ${app.update.version ?? 'an update'}${app.update.percent != null ? ' · ' + app.update.percent + '%' : ''}` : app.update.state === 'error' ? 'Could not check for updates: ' + app.update.error : app.update.state === 'current' ? 'helm is up to date.' : app.update.state === 'checking' ? 'Checking…' : undefined}>
              {app.update.state === 'ready' ? <Button variant="primary" icon="arrow-clockwise" onClick={() => void api.installUpdate()}>Restart to update</Button> : <Button icon="arrows-clockwise" disabled={app.update.state === 'dev' || app.update.state === 'checking' || app.update.state === 'downloading'} onClick={() => void api.checkForUpdates()}>Check for updates</Button>}
            </SettingRow>
            <SettingRow title="Update automatically" desc="Look for a new version when helm starts and every few hours, download it in the background, and install it the next time helm quits."><Switch checked={st.autoUpdate} onChange={(v: boolean) => set({ autoUpdate: v })} /></SettingRow>
            </>}
            <SettingRow title="Diagnostics" desc="Saves versions, settings, the state of each session and the recent log as one Markdown file you can attach to a bug report. Task text, conversations, file contents and repository paths are left out, and tokens and your home folder are masked.">
              <Button icon="download-simple" onClick={() => void api.saveDiagnostics().then((f) => f && toast({ tone: 'ready', title: 'Saved diagnostics', description: f })).catch((e) => toast({ tone: 'error', title: 'Could not save', description: errText(e) }))}>Save diagnostics…</Button>
            </SettingRow>
            {hosted ? null : <SettingRow title="Log" desc="Errors and warnings from helm, kept up to about 2 MB."><Button icon="folder-open" onClick={() => void api.openLogFolder()}>Show in folder</Button></SettingRow>}
          </> : null}
          {sec === 'appearance' ? <>
            <H>Appearance</H>
            <SettingRow title="Theme"><SegmentedControl value={st.theme} onChange={(v: string) => set({ theme: v as any })} options={[{ value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'light', label: 'Light', icon: 'sun' }, { value: 'system', label: 'System', icon: 'desktop' }]} /></SettingRow>
            <ColourRows st={st} set={set} />
            <SettingRow title="Tutorial mode" desc="Shows small bubbles pointing out useful areas, one at a time, until you dismiss each.">
              <Switch checked={st.tutorial} onChange={(v: boolean) => set({ tutorial: v })} />
              <Button size="sm" icon="arrow-counter-clockwise" onClick={() => set({ tutorial: true, tutorialSeen: [] })}>Show tips again</Button>
            </SettingRow>
            <SettingRow title="Show organisation in the sidebar" desc="Writes repositories as acme/storefront rather than just storefront. Turn off to save width."><Switch checked={st.showOwner} onChange={(v: boolean) => set({ showOwner: v })} /></SettingRow>
            <FontRow title="Interface font" desc="Labels, titles and prose throughout helm." value={st.uiFont} onChange={(v: string) => set({ uiFont: v })} bundled={UI_BUNDLED_FONTS} system={[SYSTEM_DEFAULT, ...uiSystem]} stack={uiStack} />
            <FontRow title="Data font" desc="Monospaced text in the interface: paths, branches, hashes, counts and costs." value={st.dataFont} onChange={(v: string) => set({ dataFont: v })} bundled={BUNDLED_FONTS} system={monoSystem} stack={dataStack} />
            <TerminalShellRow st={st} set={set} />
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
      <Dialog open={signOut} width={440} title="Sign out of GitHub?" description="Your sessions and worktrees stay on this machine." onClose={() => setSignOut(false)}
        footer={<><Button variant="ghost" onClick={() => setSignOut(false)}>Cancel</Button><Button variant="danger" onClick={() => { setSignOut(false); void api.signOut(); }}>Sign out</Button></>} />
    </div>
  );
}
