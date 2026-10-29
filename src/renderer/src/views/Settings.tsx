import React from 'react';
import type { CustomShortcut, GotoTarget, ModelAlias, NewSessionPreset, PermMode, Settings as SettingsT } from '@shared/types';
import type { SyncStatus } from '@shared/sync';
import { api, platform } from '../api';
import { billingOf, defaultChoice, livePlan, modelChoices, planBackends, splitChoice, theme as resolveTheme, untilReset } from '../lib';
import { CURRENCIES, rateFor } from '@shared/money';
import { BUNDLED_FONTS, fontStack, SYSTEM_DEFAULT, systemFonts, systemUiFonts, uiStack, UI_BUNDLED_FONTS, dataStack } from '../fonts';
import { ACCENT_SWATCHES, SCHEMES, STATUS_KEYS, STATUS_LABEL, isHex, schemeVars } from '@shared/schemes';
import { McpServers } from './McpServers';
import { RepoSettingsPane } from './RepoSettings';
import { AutomationsSection } from './Automations';
import { EFFORT_OPTIONS, VariantEditor } from './Review';
import { toast, useApp, useMoney } from '../store';
import { comboFromEvent, comboKeys, comboProblem, normalizeCombo, SHORTCUT_ACTIONS, shortcutConflict, shortcutOf } from '@shared/shortcuts';
import { AgentSignInDialog } from './AgentSignIn';
import { Avatar, Badge, Button, Checkbox, Dialog, IconButton, Input, Kbd, Meter, SegmentedControl, Select, Switch, TreeItem, useColumns, useNarrow } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const set = (patch: Partial<SettingsT>) => void api.updateSettings(patch);

export const PERM_OPTIONS = [{ value: 'ask', label: 'Ask before commands' }, { value: 'edits', label: 'Allow edits, ask for commands' }, { value: 'plan', label: 'Plan only' }, { value: 'all', label: 'Allow everything' }];

/** Moving helm to another machine or server: everything but sign-ins and passwords, as one file. */
function TransferSection() {
  const [busy, setBusy] = React.useState(false);
  const file = React.useRef<HTMLInputElement>(null);
  const fail = (title: string) => (e: any) => toast({ tone: 'error', title, description: errText(e) });
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const r = await api.importData(await f.text());
      toast({ tone: 'ready', title: 'Imported', description: `${r.sessions} sessions, ${r.repos} repositories, ${r.files} files` });
    } catch (e) { fail('Could not import')(e); } finally { setBusy(false); if (file.current) file.current.value = ''; }
  };
  return <>
    <H sub="For moving helm to another computer or server.">Import and export</H>
    <SettingRow title="Export" desc="Saves repositories, sessions, transcripts, usage history, automated agents, settings and uploaded fixtures as one file. Your GitHub and Claude sign-ins and passwords are not included, so you sign in again on the new machine. The file holds your conversations; keep it private.">
      <Button icon="download-simple" disabled={busy} onClick={() => { setBusy(true); void api.exportData().then((f) => f && toast({ tone: 'ready', title: 'Exported', description: f })).catch(fail('Could not export')).finally(() => setBusy(false)); }}>Export…</Button>
    </SettingRow>
    <SettingRow title="Import" desc="Adds the contents of an export file to what is here. Anything already here is kept: sessions and repositories with the same name are not overwritten. Paths, shells and update settings stay as they are on this machine. Imported sessions come in stopped; those whose worktree is not on this machine are marked as having none.">
      <input ref={file} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={(e) => void pick(e.target.files?.[0])} />
      <Button icon="upload-simple" disabled={busy} onClick={() => file.current?.click()}>Import…</Button>
    </SettingRow>
  </>;
}

/** Keeping history in step with other helm instances: a key for them to use here, and the servers to sync with from here. */
function SyncSection({ st }: { st: SettingsT }) {
  const [status, setStatus] = React.useState<SyncStatus | null>(null);
  const [key, setKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: '', url: '', key: '' });
  const [confirmRegen, setConfirmRegen] = React.useState(false);
  const refresh = React.useCallback(() => void api.syncStatus().then(setStatus).catch(() => undefined), []);
  React.useEffect(refresh, [refresh, st.syncEnabled]);
  // Connections come and go and syncs finish on their own, so look again now and then.
  React.useEffect(() => { const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [refresh]);
  React.useEffect(() => { setKey(null); }, [st.syncEnabled]);
  const fail = (title: string) => (e: any) => toast({ tone: 'error', title, description: errText(e) });
  const run = async (peerId?: string) => {
    setBusy(peerId || 'all');
    try {
      const r = await api.syncRun(peerId);
      for (const x of r) {
        const n = (c: { sessions: number; events: number; records: number }) => `${c.sessions} sessions, ${c.events} messages, ${c.records} usage records`;
        toast(x.result.ok ? { tone: 'ready', title: `Synced with ${x.name}`, description: `Received ${n(x.result.pulled)}. Sent ${n(x.result.pushed)}.` } : { tone: 'error', title: `Could not sync with ${x.name}`, description: x.result.error });
      }
    } catch (e) { fail('Could not sync')(e); } finally { setBusy(null); refresh(); }
  };
  const peers = status?.peers || [];
  return <>
    <H sub="Keep the history of several helm instances (say your desktop and a cloud server) in step. It runs when you press the button, and all the time for servers you turn Keep in sync on for.">Sync</H>
    {status?.canServe ? <>
      <SettingRow title="Let other instances sync with this one" desc="Off by default. When on, an instance that has the key below can read and add sessions, transcripts and usage here. Use HTTPS in front of this server.">
        <Switch checked={st.syncEnabled} onChange={(v: boolean) => set({ syncEnabled: v })} />
      </SettingRow>
      {st.syncEnabled ? <SettingRow title="Connected" desc="Instances holding a standing connection to this one, which are told the moment something changes here."><Badge>{String(status.connected)}</Badge></SettingRow> : null}
      {st.syncEnabled ? <SettingRow title="Sync key" desc="Paste this, with this server's address, into the other instance. Anyone with it can read your conversations.">
        {key ? <code className="selectable" style={{ font: '400 12px var(--font-mono)', wordBreak: 'break-all' }}>{key}</code> : null}
        <Button size="sm" icon={key ? 'copy' : 'eye'} onClick={() => { if (key) void navigator.clipboard?.writeText(key); else void api.syncKey().then(setKey).catch(fail('Could not read the key')); }}>{key ? 'Copy' : 'Show'}</Button>
        <Button size="sm" icon="arrows-clockwise" onClick={() => setConfirmRegen(true)}>Regenerate</Button>
      </SettingRow> : null}
    </> : null}
    <SettingRow title="Servers to sync with" desc={status?.canServe ? 'Another helm server and its sync key.' : 'A helm server and the sync key from its settings. This app has no address of its own, so it starts every sync and other instances cannot sync into it.'}>
      <Button icon="arrows-clockwise" disabled={!peers.length || !!busy} onClick={() => void run()}>{busy === 'all' ? 'Syncing…' : 'Sync all history'}</Button>
    </SettingRow>
    {peers.map((p) => (
      <SettingRow key={p.id} title={p.name} desc={<>{p.url}{p.continuous ? <> · {p.live.state === 'connected' ? 'connected' : p.live.state === 'connecting' ? 'connecting…' : p.live.state === 'error' ? `reconnecting (${p.live.error})` : 'off'}</> : null}{p.last ? <> · {p.last.ok ? `last synced ${new Date(p.last.at).toLocaleString()}` : `failed: ${p.last.error}`}</> : ' · never synced'}</>}>
        <Switch checked={p.continuous} onChange={(v: boolean) => void api.syncSetContinuous(p.id, v).then(refresh).catch(fail('Could not change'))} label="Keep in sync" />
        <Button size="sm" icon="arrows-clockwise" disabled={!!busy} onClick={() => void run(p.id)}>{busy === p.id ? 'Syncing…' : 'Sync'}</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={() => void api.syncRemovePeer(p.id).then(refresh)}>Remove</Button>
      </SettingRow>
    ))}
    <SettingRow title="Add a server">
      <Input placeholder="Name" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} style={{ width: 120 }} />
      <Input placeholder="https://helm.example.com" value={form.url} onChange={(e: any) => setForm({ ...form, url: e.target.value })} style={{ width: 220 }} />
      <Input type="password" placeholder="Sync key" value={form.key} onChange={(e: any) => setForm({ ...form, key: e.target.value })} style={{ width: 160 }} />
      <Button icon="plus" disabled={!form.url || !form.key} onClick={() => void api.syncAddPeer(form.name, form.url, form.key).then(() => { setForm({ name: '', url: '', key: '' }); refresh(); }).catch(fail('Could not add'))}>Add</Button>
    </SettingRow>
    <Dialog open={confirmRegen} width={440} title="Regenerate the sync key?" description="Instances using the old key stop working until you give them the new one." onClose={() => setConfirmRegen(false)}
      footer={<><Button variant="ghost" onClick={() => setConfirmRegen(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirmRegen(false); void api.syncRegenerateKey().then(setKey).catch(fail('Could not regenerate')); }}>Regenerate</Button></>} />
  </>;
}

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

/** The companion website: turn it on, link this computer, see who is connected. */
/** Outbound email: where helm sends notifications that leave the app. The password is held by the host, encrypted, and never shown again. */
function EmailSection({ st, set, passwordSet }: { st: any; set(p: any): void; passwordSet: boolean }) {
  const e = st.outbound.email;
  const put = (patch: any) => set({ outbound: { ...st.outbound, email: { ...e, ...patch } } });
  const [testing, setTesting] = React.useState(false);
  const [pw, setPw] = React.useState('');
  const kinds: ['attention' | 'ready' | 'failed', string][] = [['attention', 'An agent needs approval or an answer'], ['ready', 'A session is ready for review'], ['failed', 'A session failed or hit its budget']];
  const test = async () => {
    setTesting(true);
    try {
      const problem = await api.testOutbound('email');
      toast(problem ? { tone: 'error', title: 'Test email failed', description: problem } : { tone: 'ready', title: 'Test email sent', description: `Check ${e.to}` });
    } catch (err) { toast({ tone: 'error', title: 'Test email failed', description: errText(err) }); }
    setTesting(false);
  };
  return <>
    <H sub="Send notifications by email, so you hear about them away from this computer. Quiet hours and the per repository settings apply here too.">Email</H>
    <SettingRow title="Send email notifications"><Switch checked={e.enabled} onChange={(v: boolean) => put({ enabled: v })} /></SettingRow>
    {kinds.map(([k, label]) => (
      <SettingRow key={k} title={label}><Switch checked={e.kinds[k]} onChange={(v: boolean) => put({ kinds: { ...e.kinds, [k]: v } })} /></SettingRow>
    ))}
    <SettingRow title="Send to" desc="One or more addresses, separated by commas."><Field value={e.to} onCommit={(v: string) => put({ to: v })} placeholder="you@example.com" style={{ width: 280 }} /></SettingRow>
    <SettingRow title="Sender address" desc="Usually the account you sign in to the mail server with."><Field value={e.from} onCommit={(v: string) => put({ from: v.trim() })} placeholder="helm@example.com" style={{ width: 280 }} /></SettingRow>
    <SettingRow title="Sender name"><Field value={e.fromName} onCommit={(v: string) => put({ fromName: v })} style={{ width: 280 }} /></SettingRow>
    <SettingRow title="SMTP server" desc="For Gmail use smtp.gmail.com with an app password.">
      <Field value={e.host} onCommit={(v: string) => put({ host: v.trim() })} placeholder="smtp.example.com" style={{ width: 200 }} />
      <Field value={e.port} onCommit={(v: number) => put({ port: v })} parse={(x: string) => (/^\d+$/.test(x.trim()) ? Number(x) : undefined)} style={{ width: 80 }} />
    </SettingRow>
    <SettingRow title="Security" desc="TLS is encrypted from the start, usually port 465. STARTTLS upgrades after connecting, usually port 587.">
      <Select size="sm" value={e.security} onChange={(ev: any) => put({ security: ev.target.value, port: ev.target.value === 'tls' ? 465 : ev.target.value === 'starttls' ? 587 : 25 })} options={[{ value: 'starttls', label: 'STARTTLS' }, { value: 'tls', label: 'TLS' }, { value: 'none', label: 'None (local relay only)' }]} />
    </SettingRow>
    <SettingRow title="Username" desc="Leave empty if the server needs no sign-in."><Field value={e.user} onCommit={(v: string) => put({ user: v.trim() })} style={{ width: 280 }} /></SettingRow>
    <SettingRow title="Password" desc={passwordSet ? 'A password is saved, encrypted on this computer. Enter a new one to replace it.' : 'Stored encrypted on this computer, not in the settings file.'}>
      <Input type="password" value={pw} placeholder={passwordSet ? '••••••••' : ''} onChange={(ev: any) => setPw(ev.target.value)} style={{ width: 200 }} />
      <Button size="sm" disabled={!pw} onClick={() => { void api.setEmailPassword(pw); setPw(''); }}>Save</Button>
      {passwordSet ? <Button size="sm" variant="ghost" onClick={() => void api.setEmailPassword('')}>Clear</Button> : null}
    </SettingRow>
    <SettingRow title="Test" desc="Sends a test message with these settings, whether or not email is turned on."><Button size="sm" icon="paper-plane-tilt" disabled={testing} onClick={test}>{testing ? 'Sending…' : 'Send test email'}</Button></SettingRow>
  </>;
}

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

/** The phone app: turn on a direct link, get a share code, see and remove paired phones. */
function PhoneSection({ st, set, state }: { st: any; set(p: any): void; state: any }) {
  const label = ({ off: 'Off', starting: 'Starting…', ready: 'Listening', error: 'Not running' } as any)[state.state] || state.state;
  const tone = state.state === 'ready' ? 'var(--status-ready-text, var(--status-ready))' : state.state === 'error' ? 'var(--status-error-text)' : 'var(--text-3)';
  const nat = state.nat === 'symmetric'
    ? 'Your router gives this port a different public address for each destination (symmetric NAT or carrier-grade NAT), so a phone outside your network cannot be told where to connect. It can still connect over your home network, IPv6 or a VPN such as Tailscale, or you can forward the port on your router.'
    : state.nat === 'cone' ? 'Your router keeps one public address for this port, so a phone elsewhere can usually connect. If it cannot, forward the port on your router.'
    : state.nat === 'unknown' && st.p2pStun ? 'The STUN server did not answer, so the public address is not known. Local, IPv6 and VPN addresses still work.' : undefined;
  return <>
    <H sub="Use helm from the phone app, straight to this computer, with no server in between. Off by default: nothing listens until you turn it on.">Phone app</H>
    <SettingRow title="Allow the phone app" desc="Opens one UDP port. Nothing answers a packet that is not from a phone you have paired, so the port shows nothing to a scan.">
      <Switch checked={st.p2pEnabled} onChange={(v: boolean) => set({ p2pEnabled: v })} />
    </SettingRow>
    <SettingRow title="Status" desc={state.state === 'ready' ? `UDP port ${state.port}${state.mapped ? `, seen from outside as ${state.mapped}` : ''}.` : state.error}>
      <span style={{ font: '500 12.5px/1.5 var(--font-sans)', color: tone, display: 'inline-flex', alignItems: 'center', gap: 6 }}><i className={'ph-fill ph-circle'} style={{ fontSize: 8 }} />{label}</span>
    </SettingRow>
    {state.state === 'ready' && nat ? <SettingRow title="Reachability" desc={nat} /> : null}
    {state.code ? (
      <div style={{ margin: '4px 0 12px', padding: 14, borderRadius: 'var(--radius-md)', background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ font: '500 13px/1.5 var(--font-sans)' }}>Pair a phone</span>
        <span style={{ font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>In the phone app choose Add computer and paste this code, then sign in to GitHub as {st.githubUser || 'the same account as here'}. The code pairs one phone, once, within ten minutes. It holds addresses of this computer, so share it only with yourself.</span>
        <span className="selectable" style={{ font: '400 11.5px/1.5 var(--font-mono)', wordBreak: 'break-all', maxHeight: 72, overflow: 'auto', color: 'var(--text-2)' }}>{state.code}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="sm" icon="copy" onClick={() => api.copyText(state.code)}>Copy code</Button>
          <Button size="sm" variant="ghost" icon="arrows-clockwise" onClick={() => api.p2pNewCode()}>New code</Button>
        </div>
      </div>
    ) : null}
    <SettingRow title="Paired phones" desc={state.devices.length ? undefined : 'No phone is paired.'} />
    {state.devices.map((d: any) => (
      <SettingRow key={d.id} title={d.name} desc={`${d.connected ? 'Connected now. ' : ''}Paired ${new Date(d.addedAt).toLocaleDateString()}, last seen ${new Date(d.lastSeen).toLocaleString()}.`}>
        <Button size="sm" variant="ghost" icon="trash" onClick={() => api.p2pRevoke(d.id)}>Remove</Button>
      </SettingRow>
    ))}
    <SettingRow title="What a phone can do" desc="Everything this window can: read and answer agents, run commands in the terminal, change settings. Not the things that act on this computer, such as opening a folder. Your GitHub token stays here. Pairing needs the phone's user to be the GitHub account signed in on this computer." />
    <SettingRow title="UDP port" desc="0 picks a free port the first time and keeps it. If you forward a port on your router, set it here to the one you forwarded."><Field value={st.p2pPort} onCommit={(v: number) => set({ p2pPort: v })} parse={(x: string) => (/^\d+$/.test(x.trim()) && +x <= 65535 ? Number(x) : undefined)} style={{ width: 90 }} /></SettingRow>
    <SettingRow title="Fixed address" desc="Something that does not change, such as a dynamic DNS name, added to the code so a paired phone can still find this computer when its public address changes."><Field value={st.p2pAddress} onCommit={(v: string) => set({ p2pAddress: v.trim() })} placeholder="home.example.com" style={{ width: 220 }} /></SettingRow>
    <SettingRow title="STUN server" desc="Tells this computer which public address its port has. Only the port's address is sent. Leave empty to not ask."><Field value={st.p2pStun} onCommit={(v: string) => set({ p2pStun: v.trim() })} placeholder="stun.cloudflare.com:3478" style={{ width: 220 }} /></SettingRow>
  </>;
}

/**
 * Click a shortcut, then press the new keys; Esc cancels and Backspace turns the shortcut off. `conflict` names another action already using the keys.
 * Listens in the capture phase, so the keys being pressed do not also run the action they are currently set to.
 */
function useShortcutRecorder(commit: (id: string, combo: string) => void, conflict: (id: string, combo: string) => { label: string } | undefined) {
  const mac = platform() === 'darwin';
  const [editing, setEditing] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ id: string; text: string } | null>(null);
  const latest = React.useRef({ commit, conflict });
  latest.current = { commit, conflict };
  const stop = () => { setEditing(null); setMsg(null); };
  React.useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { stop(); return; }
      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) { latest.current.commit(editing, ''); stop(); return; }
      const combo = comboFromEvent(e, mac);
      if (!combo) return;
      const problem = comboProblem(combo);
      if (problem) { setMsg({ id: editing, text: problem }); return; }
      const clash = latest.current.conflict(editing, combo);
      if (clash) { setMsg({ id: editing, text: `Already used for “${clash.label}”. Change that one first.` }); return; }
      latest.current.commit(editing, normalizeCombo(combo));
      stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing]);
  return { editing, msg, stop, toggle: (id: string) => { setEditing(editing === id ? null : id); setMsg(null); } };
}

/** The button that shows a shortcut and starts recording a new one. */
function ShortcutButton({ combo, editing, label, onClick }: { combo: string; editing: boolean; label: string; onClick(): void }) {
  const mac = platform() === 'darwin';
  return (
    <button type="button" onClick={onClick} aria-label={`Change the shortcut for ${label}`}
      style={{ minWidth: 120, height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', cursor: 'pointer', color: 'var(--text-2)', font: '400 12px/1.5 var(--font-sans)', boxShadow: editing ? 'var(--ring-focus), inset 0 0 0 1px var(--accent)' : 'inset 0 0 0 1px var(--border-strong)' }}>
      {editing ? 'Press the keys…' : combo ? <Kbd keys={comboKeys(combo, mac)} /> : 'Not set'}
    </button>
  );
}

/** Every built-in shortcut that can be changed. */
function ShortcutsSection({ st, set }: { st: SettingsT; set(p: Partial<SettingsT>): void }) {
  const mine = st.shortcuts || {};
  const save = (id: string, combo: string) => {
    const next = { ...mine };
    if (combo === SHORTCUT_ACTIONS.find((a) => a.id === id)!.default) delete next[id]; else next[id] = combo;
    set({ shortcuts: next });
  };
  const rec = useShortcutRecorder(save, (id, combo) => shortcutConflict(mine, id, combo, st.customShortcuts));
  const changed = Object.keys(mine).length > 0;
  return <>
    <H sub="Click a shortcut, then press the keys you want. Mod is Cmd on a Mac and Ctrl everywhere else. Make your own under Custom shortcuts.">Keyboard shortcuts</H>
    {SHORTCUT_ACTIONS.map((a) => (
      <SettingRow key={a.id} title={a.label} desc={rec.msg?.id === a.id ? <span style={{ color: 'var(--status-attention-text)' }}>{rec.msg.text}</span> : a.desc}>
        <ShortcutButton combo={shortcutOf(mine, a.id)} editing={rec.editing === a.id} label={a.label} onClick={() => rec.toggle(a.id)} />
        <Button size="sm" variant="ghost" icon="arrow-counter-clockwise" disabled={!(a.id in mine)} onClick={() => { const next = { ...mine }; delete next[a.id]; set({ shortcuts: next }); }}>Reset</Button>
      </SettingRow>
    ))}
    <SettingRow title="Reset all" desc="Puts every shortcut back to its default.">
      <Button size="sm" disabled={!changed} onClick={() => { set({ shortcuts: {} }); rec.stop(); }}>Reset all shortcuts</Button>
    </SettingRow>
  </>;
}

const GOTO_PAGES: { value: GotoTarget['page']; label: string }[] = [
  { value: 'overview', label: 'Overview' }, { value: 'needsYou', label: 'Needs you' }, { value: 'inbox', label: 'Inbox' }, { value: 'activity', label: 'Activity' },
  { value: 'archive', label: 'Archive' }, { value: 'reports', label: 'Reports' }, { value: 'settings', label: 'Settings' }, { value: 'repo', label: 'A repository' }
];
const REPO_TABS = [{ value: '', label: 'Its usual tab' }, { value: 'history', label: 'History' }, { value: 'code', label: 'Code' }, { value: 'external', label: 'Outside sessions' }, { value: 'memory', label: 'Memory' }, { value: 'mcp', label: 'MCP servers' }, { value: 'worktrees', label: 'Branches & worktrees' }, { value: 'issues', label: 'Issues' }, { value: 'actions', label: 'Actions' }, { value: 'settings', label: 'Settings' }, { value: 'prs', label: 'Pull requests' }];

function LabeledField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: '500 12px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{label}</span>
      {children}
      {hint ? <span style={{ font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{hint}</span> : null}
    </div>
  );
}

/** What a "new session" shortcut opens the dialog with. Every field is optional; a field left empty keeps the dialog's usual default. */
function PresetEditor({ preset, onChange }: { preset: NewSessionPreset; onChange(p: NewSessionPreset): void }) {
  const app = useApp();
  const { sym, to, from } = useMoney();
  const free = preset.repoId === '@free';
  const put = (p: Partial<NewSessionPreset>) => {
    const next: Record<string, unknown> = { ...preset, ...p };
    for (const k of Object.keys(next)) { const v = next[k]; if (v === '' || v === undefined || v === false || (Array.isArray(v) && !v.length)) delete next[k]; }
    onChange(next as NewSessionPreset);
  };
  const models = [{ value: '', label: 'The default agent and model' }, ...modelChoices(app)];
  const others = app.repos.filter((r) => r.id !== preset.repoId);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0 6px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}><LabeledField label="Repository">
          <Select value={preset.repoId || ''} onChange={(e: any) => put({ repoId: e.target.value, base: undefined, extraRepos: undefined, ...(e.target.value === '@free' ? { compare: false, variants: undefined } : { folder: undefined }) })} icon="book-bookmark"
            options={[{ value: '', label: 'Whichever page you are on' }, { value: '@free', label: 'No repository (free agent)' }, ...app.repos.map((r) => ({ value: r.id, label: r.id }))]} />
        </LabeledField></div>
        {free ? null : <div style={{ flex: 1, minWidth: 0 }}><LabeledField label="Branch to start from">
          <Input mono value={preset.base || ''} placeholder="The default branch" onChange={(e: any) => put({ base: e.target.value.trim() })} />
        </LabeledField></div>}
      </div>
      <LabeledField label="Task" hint="Filled into the box so you can add to it or send it as it is. Attachments cannot be part of a shortcut.">
        <textarea rows={3} value={preset.task || ''} onChange={(e) => put({ task: e.target.value })} placeholder="Leave empty to type it each time"
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', color: 'var(--text-1)', font: '400 13px/1.5 var(--font-sans)', padding: '8px 10px' }} />
      </LabeledField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 110px', gap: 8 }}>
        <LabeledField label="Agent and model"><Select value={preset.choice || ''} onChange={(e: any) => put({ choice: e.target.value })} options={models} /></LabeledField>
        <LabeledField label="Permissions"><Select value={preset.permMode || ''} onChange={(e: any) => put({ permMode: e.target.value })} options={[{ value: '', label: 'The default' }, ...PERM_OPTIONS]} /></LabeledField>
        <LabeledField label="Budget"><Input mono value={preset.budget != null ? sym + String(Math.round(to(preset.budget) * 100) / 100) : ''} placeholder="Default"
          onChange={(e: any) => { const n = parseFloat(e.target.value.replace(/[^0-9.]/g, '')); put({ budget: Number.isFinite(n) ? from(n) : undefined }); }} /></LabeledField>
      </div>
      {free ? (
        <LabeledField label="Folder" hint="Work directly in this folder instead of a new scratch one. There is no worktree to throw away and no checkpoints.">
          <Input mono value={preset.folder || ''} placeholder="A new scratch folder, with git" onChange={(e: any) => put({ folder: e.target.value.trim() })} />
        </LabeledField>
      ) : <>
        {others.length ? <LabeledField label="Also work in"><Select multiple value={(preset.extraRepos || []).filter((id) => others.some((r) => r.id === id))} onChange={(e: any) => put({ extraRepos: e.target.value })} options={others.map((r) => ({ value: r.id, label: r.id }))} placeholder="None" icon="books" /></LabeledField> : null}
      </>}
      <LabeledField label="Also ask"><Select multiple value={preset.joiners || []} onChange={(e: any) => put({ joiners: e.target.value })} options={modelChoices(app)} placeholder="No other agents" icon="users-three" /></LabeledField>
      {free ? null : <>
        <Checkbox checked={!!preset.compare} onChange={(v: boolean) => put({ compare: v })} label="Compare several runs" description="Opens the dialog set up to start the same task more than once." />
        {preset.compare ? <VariantEditor variants={preset.variants?.length ? preset.variants : defaultVariants(app)} onChange={(v) => put({ variants: v })} /> : null}
      </>}
    </div>
  );
}

const defaultVariants = (app: Parameters<typeof modelChoices>[0]): { choice: string; effort: 'default' }[] => { const c = modelChoices(app); const d = defaultChoice(app); return [{ choice: d, effort: 'default' }, { choice: c.find((x) => x.value !== d)?.value ?? d, effort: 'default' }]; };

function GotoEditor({ target, onChange }: { target: GotoTarget; onChange(t: GotoTarget): void }) {
  const app = useApp();
  return (
    <div style={{ display: 'flex', gap: 8, padding: '4px 0 6px' }}>
      <div style={{ flex: 1, minWidth: 0 }}><LabeledField label="Opens">
        <Select value={target.page} onChange={(e: any) => onChange({ page: e.target.value, repoId: e.target.value === 'repo' ? target.repoId : undefined })} options={GOTO_PAGES} icon="arrow-right" />
      </LabeledField></div>
      {target.page === 'repo' ? <>
        <div style={{ flex: 1, minWidth: 0 }}><LabeledField label="Repository"><Select value={target.repoId || ''} onChange={(e: any) => onChange({ ...target, repoId: e.target.value })} options={[{ value: '', label: 'Choose…' }, ...app.repos.map((r) => ({ value: r.id, label: r.id }))]} icon="book-bookmark" /></LabeledField></div>
        <div style={{ flex: 1, minWidth: 0 }}><LabeledField label="Tab"><Select value={target.tab || ''} onChange={(e: any) => onChange({ ...target, tab: e.target.value || undefined })} options={REPO_TABS} /></LabeledField></div>
      </> : null}
    </div>
  );
}

const summary = (c: CustomShortcut) => {
  if (c.action.kind === 'goto') { const t = c.action.target; return t.page === 'repo' ? `Opens ${t.repoId || 'a repository'}${t.tab ? ' · ' + t.tab : ''}` : `Opens ${GOTO_PAGES.find((p) => p.value === t.page)?.label}`; }
  const p = c.action.preset;
  return 'New session' + (p.repoId ? ' in ' + (p.repoId === '@free' ? 'a free agent' : p.repoId) : '') + (p.task ? ': ' + p.task.slice(0, 50) : '');
};

/** Shortcuts you make yourself. Each opens the new session dialog with things already filled in, or goes to a page or repository. */
function CustomShortcutsSection({ st, set }: { st: SettingsT; set(p: Partial<SettingsT>): void }) {
  const list = st.customShortcuts || [];
  const [open, setOpen] = React.useState<string | null>(null);
  const save = (next: CustomShortcut[]) => set({ customShortcuts: next });
  const patch = (id: string, p: Partial<CustomShortcut>) => save(list.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const rec = useShortcutRecorder((id, combo) => patch(id, { combo }), (id, combo) => shortcutConflict(st.shortcuts, id, combo, list));
  const add = () => {
    const c: CustomShortcut = { id: 'c' + Date.now().toString(36), label: 'New session', combo: '', action: { kind: 'newSession', preset: {} } };
    save([...list, c]);
    setOpen(c.id);
  };
  return <>
    <H sub="Your own shortcuts. One can open the new session dialog with the repository, task, model and more already filled in; another can jump to a page or repository. They also show up in Search.">Custom shortcuts</H>
    {list.length ? null : <div style={{ padding: '14px 0', borderTop: '1px solid var(--border-subtle)', font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>None yet.</div>}
    {list.map((c) => {
      const isOpen = open === c.id;
      return (
        <div key={c.id} style={{ borderTop: '1px solid var(--border-subtle)', padding: '10px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Edit'} style={{ border: 'none', background: 'none', color: 'var(--text-3)', cursor: 'pointer', padding: 4, display: 'grid', placeItems: 'center' }}>
              <i className={'ph ph-caret-' + (isOpen ? 'down' : 'right')} style={{ fontSize: 12 }} />
            </button>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Input value={c.label} placeholder="Name" onChange={(e: any) => patch(c.id, { label: e.target.value })} style={{ maxWidth: 320 }} />
              <span style={{ font: '400 12px/1.45 var(--font-sans)', color: rec.msg?.id === c.id ? 'var(--status-attention-text)' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rec.msg?.id === c.id ? rec.msg.text : summary(c)}</span>
            </div>
            <ShortcutButton combo={c.combo} editing={rec.editing === c.id} label={c.label} onClick={() => rec.toggle(c.id)} />
            <IconButton icon="trash" label="Delete shortcut" size="sm" onClick={() => { save(list.filter((x) => x.id !== c.id)); if (open === c.id) setOpen(null); rec.stop(); }} />
          </div>
          {isOpen ? (
            <div style={{ margin: '10px 0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <LabeledField label="Does">
                <SegmentedControl value={c.action.kind} onChange={(k: string) => patch(c.id, { action: k === 'goto' ? { kind: 'goto', target: { page: 'overview' } } : { kind: 'newSession', preset: {} } })}
                  options={[{ value: 'newSession', label: 'Start a new session', icon: 'plus' }, { value: 'goto', label: 'Go to a page', icon: 'arrow-right' }]} style={{ alignSelf: 'flex-start' }} />
              </LabeledField>
              {c.action.kind === 'newSession'
                ? <PresetEditor preset={c.action.preset} onChange={(preset) => patch(c.id, { action: { kind: 'newSession', preset } })} />
                : <GotoEditor target={c.action.target} onChange={(target) => patch(c.id, { action: { kind: 'goto', target } })} />}
            </div>
          ) : null}
        </div>
      );
    })}
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}><Button size="sm" icon="plus" onClick={add}>Add a shortcut</Button></div>
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

export function SettingRow({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
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
export function Field({ value, onCommit, parse = (s: string) => s, format = (v: any) => String(v), ...rest }: any) {
  const [draft, setDraft] = React.useState(format(value));
  React.useEffect(() => { setDraft(format(value)); }, [value]);
  return <Input mono value={draft} onChange={(e: any) => { setDraft(e.target.value); const v = parse(e.target.value); if (v !== undefined) onCommit(v); }} {...rest} />;
}

export const H = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
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

/** One agent's accounts and command-line tool. Signing out is here, and so is signing in to one that was not chosen first. */
function AgentAccount({ b, heading = true }: { b: import('@shared/types').BackendInfo; heading?: boolean }) {
  const app = useApp();
  const st = app.settings;
  const [signing, setSigning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const l = b.login;
  const fromEnv = !!l?.loggedIn && /key|token/.test(l.method);
  const pathKey = b.id === 'claude' ? 'claudePath' : b.id === 'codex' ? 'codexPath' : '';
  const who = l?.loggedIn
    ? fromEnv ? `Using the ${l.method} set in this machine's environment.` : `Signed in${l.method === 'chatgpt' ? ' with ChatGPT' : ' with your subscription'}${l.email ? ` as ${l.email}` : ''}${l.plan ? ` (${l.plan})` : ''}.`
    : l?.error ? `Not signed in. ${l.error}` : 'Not signed in. This agent cannot be used until you sign in.';
  return (
    <>
      {heading ? <div style={{ margin: '14px 0 2px', font: '600 13px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{b.label}</div> : null}
      {pathKey ? (
        <SettingRow title="Command-line tool" desc={(st as any)[pathKey] ? 'Custom path' : b.id === 'claude' ? 'Uses the Claude Code bundled with helm unless a path is set.' : `Uses \`${b.id}\` from the PATH unless a path is set.`}>
          <Field value={(st as any)[pathKey]} onCommit={(v: string) => set({ [pathKey]: v.trim() } as any)} placeholder={`Path to ${b.id} (optional)`} style={{ width: 260 }} />
          {b.version ? <Badge tone="ready" dot>{b.version}</Badge> : b.installed ? <Badge>bundled</Badge> : <Badge tone="error">not found</Badge>}
        </SettingRow>
      ) : null}
      {b.canSignIn ? (
        <SettingRow title="Account" desc={who}>
          {l?.loggedIn && !fromEnv ? <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); try { await api.agentLogout(b.id); } finally { setBusy(false); } }}>Sign out</Button> : null}
          {!l?.loggedIn ? <Button size="sm" variant="secondary" disabled={!b.installed} onClick={() => setSigning(true)}>Sign in</Button> : null}
        </SettingRow>
      ) : null}
      {signing ? <AgentSignInDialog backendId={b.id} onClose={() => setSigning(false)} /> : null}
    </>
  );
}

export function Settings({ section }: { section?: string }) {
  const narrow = useNarrow();
  const hosted = !!window.helmBridge.hosted;
  const app = useApp();
  const st = app.settings;
  const [sec, setSec] = React.useState(!section || section === 'account' ? 'github' : section);
  const [signOut, setSignOut] = React.useState(false);
  const { fmt, sym, to, from, cur } = useMoney();
  const plan = livePlan(app);
  // Agents paid for by a plan get meters; before anything is signed in, Claude's own billing setting decides what to show.
  const noneReady = !app.backends.some((b) => b.ready);
  const subs = planBackends(app).length ? planBackends(app) : noneReady && st.billing === 'subscription' ? app.backends.filter((b) => b.id === st.defaultBackend || b.id === 'claude').slice(0, 1) : [];
  const showPlan = subs.length > 0;
  const showDollars = !showPlan || app.backends.some((b) => b.ready && billingOf(app, b.id) === 'api');
  const money0 = { format: (v: number) => sym + String(Math.round(v * 100) / 100), parse: (x: string) => { const n = parseFloat(x.replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n >= 0 ? n : undefined; } };
  const repoCols = useColumns('budget-repos', [{ w: 1, min: 160, flex: true }, { w: 220, min: 120 }, { w: 90, min: 70, fixed: true }]);
  const monoSystem = React.useMemo(() => systemFonts(), []);
  const uiSystem = React.useMemo(() => systemUiFonts(), []);
  const subCols = useColumns('subagent-repos', [{ w: 1, min: 160, flex: true }, { w: 170, min: 110, fixed: true }]);
  const pctOptions = [{ value: '0', label: 'Off' }, { value: '50', label: '50%' }, { value: '70', label: '70%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }];
  const subLimits = (extra: number[]) => [...new Set([0, 1, 2, 3, 4, 6, 8, 12, ...extra])].sort((a, b) => a - b).map((n) => ({ value: String(n), label: n === 0 ? 'Off' : String(n) }));
  const nav = [['defaults', 'Defaults', 'sliders-horizontal'], ...app.repos.map((r) => ['repo:' + r.id, r.hidden ? r.id + ' (hidden)' : r.id, r.hidden ? 'eye-slash' : 'git-branch', 1]), ['github', 'GitHub', 'github-logo', 1], ['claude', 'Claude Code', 'sparkle', 1], ['codex', 'Codex', 'terminal-window', 1], ['agents', 'Agents', 'robot'], ['automations', 'Automated agents', 'clock-clockwise'], ['mcp', 'MCP servers', 'plugs-connected'], ['worktrees', 'Worktrees', 'tree-structure'], ['budgets', 'Usage', 'coins'], ...(hosted ? [] : [['companion', 'Companion', 'broadcast'], ['phone', 'Phone app', 'device-mobile']]), ['notifications', 'Notifications', 'bell'], ['appearance', 'Appearance', 'paint-brush'], ['shortcuts', 'Keyboard shortcuts', 'keyboard', 1], ['custom-shortcuts', 'Custom shortcuts', 'lightning', 1], ['transfer', 'Import and export', 'arrows-left-right'], ['sync', 'Sync', 'arrows-clockwise'], ['about', 'About and support', 'info']] as [string, string, string, number?][];
  // Accounts and Shortcuts are nodes of their own with nothing on them: each holds its pages and folds them away when clicked.
  const repoKeys = app.repos.map((r) => 'repo:' + r.id);
  const groups: Record<string, [string, string, string]> = { github: ['accounts', 'Accounts', 'user-circle'], shortcuts: ['shortcuts', 'Shortcuts', 'keyboard'], ...(repoKeys[0] ? { [repoKeys[0]]: ['repos', 'Repositories', 'book-bookmark'] } : {}) };
  const groupOf: Record<string, string> = { ...Object.fromEntries(repoKeys.map((k) => [k, 'repos'])), github: 'accounts', claude: 'accounts', codex: 'accounts', shortcuts: 'shortcuts', 'custom-shortcuts': 'shortcuts' };
  const [folded, setFolded] = React.useState<string[]>([]);
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
          {/* Some twenty pages do not fit a strip: a list shows them all and the one you are on. */}
          <Select size="lg" value={sec} onChange={(e: any) => setSec(e.target.value)} style={{ width: '100%' }} options={nav.map(([value, label]) => ({ value, label: (groupOf[value as string] === 'accounts' ? 'Accounts · ' : groupOf[value as string] === 'shortcuts' ? 'Shortcuts · ' : groupOf[value as string] === 'repos' ? 'Repository · ' : '') + label }))} />
        </nav>
      ) : (
        <nav style={{ width: 200, flex: 'none', padding: '16px 8px', borderRight: '1px solid var(--border)' }}>
          {nav.map(([k, l, ic, depth]) => (
            <React.Fragment key={k}>
              {groups[k] ? <TreeItem icon={groups[k][2]} label={groups[k][1]} expandable expanded={!folded.includes(groups[k][0])} onClick={() => setFolded((f) => (f.includes(groups[k][0]) ? f.filter((x) => x !== groups[k][0]) : [...f, groups[k][0]]))} /> : null}
              {groupOf[k] && folded.includes(groupOf[k]) ? null : <TreeItem icon={ic} label={l} depth={depth || 0} selected={sec === k} onClick={() => setSec(k)} />}
            </React.Fragment>
          ))}
        </nav>
      )}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: 720, padding: narrow ? '16px 14px 32px' : '24px 32px 40px' }}>
          {sec === 'defaults' ? <RepoSettingsPane repoId={null} /> : null}
          {sec.startsWith('repo:') ? <RepoSettingsPane repoId={sec.slice(5)} /> : null}
          {sec === 'github' ? <>
            <H sub="helm signs in with GitHub. Repositories, pull requests and history all come from this account. Claude Code and Codex are signed in separately, under Accounts.">GitHub</H>
            <SettingRow title={<span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={app.user?.login || '?'} src={app.user?.avatar || undefined} size={24} />{app.user?.name || app.user?.login} <Badge mono>@{app.user?.login}</Badge></span>} desc="Signed in with GitHub · scopes: repo, read:org, workflow">
              <Button variant="ghost" onClick={() => setSignOut(true)}>Sign out</Button>
            </SettingRow>
            <SettingRow title="Organisations" desc="Repositories from these organisations appear in Add repository.">
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{(app.user?.orgs || []).length ? app.user!.orgs.map((o) => <Badge key={o}>{o}</Badge>) : <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>None</span>}</span>
              <Button size="sm" iconRight="arrow-square-out" onClick={() => api.openExternal('https://github.com/settings/applications')}>Manage on GitHub</Button>
            </SettingRow>
            <SettingRow title="Commit identity" desc="Your git user.name and user.email are used for commits and pushes. Who agent commits are credited to is set under Agents." />
            <SettingRow title="GitHub OAuth client ID" desc="Used for sign-in. Create an OAuth app on GitHub with device flow enabled.">
              <Field value={st.githubClientId} onCommit={(v: string) => set({ githubClientId: v.trim() })} style={{ width: 240 }} />
            </SettingRow>
          </> : null}
          {sec === 'agents' ? <>
            <H sub="Settings for every agent. Each agent's account, command-line tool and anything specific to it are under Accounts, in Claude Code and Codex.">Agents</H>
            {app.backends.map((b) => {
              const on = (st.enabledAgents || []).includes(b.id);
              const left = app.backends.filter((x) => (st.enabledAgents || []).includes(x.id)).length;
              const last = on && left <= 1;
              return (
                <SettingRow key={b.id} title={b.label}
                  desc={b.configured
                    ? (on ? 'On. Its models are offered when you start a session.' : 'Off. It is left out of the model lists and cannot start new sessions; sessions it already has still work.')
                    : <>{!b.installed ? 'Not installed on this machine.' : 'Not signed in.'} It cannot be used until it is set up, under <a href="#" onClick={(e) => { e.preventDefault(); setSec(b.id); }} style={{ color: 'var(--accent-text, var(--accent))' }}>Accounts → {b.label}</a>.</>}>
                  {b.configured ? <Badge tone="ready" dot>ready</Badge> : <Button size="sm" variant="secondary" onClick={() => setSec(b.id)}>{!b.installed ? 'Set up' : 'Sign in'}</Button>}
                  <span title={last ? 'At least one agent has to stay on.' : undefined}>
                    <Switch checked={on} disabled={last} onChange={(v: boolean) => set({ enabledAgents: v ? [...(st.enabledAgents || []), b.id] : (st.enabledAgents || []).filter((x) => x !== b.id) })} />
                  </span>
                </SettingRow>
              );
            })}
            <SettingRow title="Default model" desc="New sessions start with this. Models of every agent you are signed in to are listed."><Select value={defaultChoice(app)} onChange={(e: any) => { const c = splitChoice(e.target.value); set({ defaultBackend: c.backend, defaultModel: c.model }); }} options={modelChoices(app)} /></SettingRow>
            <SettingRow title="Default effort" desc="How hard new sessions think. Default leaves it to the agent. You can change it per session."><Select value={st.defaultEffort} onChange={(e: any) => set({ defaultEffort: e.target.value })} options={EFFORT_OPTIONS} /></SettingRow>
            <SettingRow title="Standing instructions" desc="Rules added to the instructions of every session, for example “use pnpm, not npm” or “never edit migrations/”. Applies when a session next starts.">
              <textarea className="selectable" value={st.defaultInstructions} rows={5} spellCheck={false} placeholder={'Use pnpm, not npm.'} onChange={(e) => set({ defaultInstructions: e.target.value })} style={{ width: 280, resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' }} />
            </SettingRow>
            <SettingRow title="Environment variables" desc="Set for every agent and terminal, one NAME=value per line. Lines starting with # are ignored. Stored in the settings file, so keep secrets out of it. Applies when a session next starts.">
              <textarea className="selectable" value={st.agentEnv} rows={4} spellCheck={false} placeholder={'NODE_OPTIONS=--max-old-space-size=4096'} onChange={(e) => set({ agentEnv: e.target.value })} style={{ width: 280, resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' }} />
            </SettingRow>
            <SettingRow title="Permission mode" desc={st.permMode === 'all' ? 'Agents run every command and edit every file without asking. The worktree keeps them off your checkout, but they can still reach the network and files outside it. Pre-approved patterns and approvals no longer matter.' : 'What an agent can do without asking you first.'}><Select value={st.permMode} onChange={(e: any) => set({ permMode: e.target.value as PermMode })} options={PERM_OPTIONS} /></SettingRow>
            <SettingRow title="Always allowed commands" desc="Comma separated patterns. * matches anything. Added to when you choose Always allow.">
              <Field value={st.alwaysAllow} format={(v: string[]) => v.join(', ')} parse={(s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)} onCommit={(v: string[]) => set({ alwaysAllow: v })} style={{ width: 260 }} />
            </SettingRow>
            <SettingRow title="Replies to one message" desc="With several agents in a session, the most replies one message of yours can bring, counting their answers to each other. Unlimited lets them keep going for as long as they keep mentioning each other."><Select value={String(st.panelReplyCap ?? 6)} onChange={(e: any) => set({ panelReplyCap: +e.target.value })} options={[1, 2, 3, 4, 6, 8, 12, 20, -1].map((n) => ({ value: String(n), label: n < 0 ? 'Unlimited' : String(n) }))} /></SettingRow>
            <SettingRow title="Always ask commands" desc="Comma separated patterns. * matches anything. These ask every time, even when an always-allowed pattern matches. By default: killing processes by name or in bulk, which would take down your other agents.">
              <Field value={st.alwaysAsk} format={(v: string[]) => v.join(', ')} parse={(s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)} onCommit={(v: string[]) => set({ alwaysAsk: v })} style={{ width: 260 }} />
            </SettingRow>
            <SettingRow title="Sessions working at once" desc="More than this wait in a queue and start as others finish. Sessions waiting on you do not count. A queued session can be started by hand."><Select value={String(st.maxRunning)} onChange={(e: any) => set({ maxRunning: +e.target.value })} options={[0, 1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: n === 0 ? 'No limit' : String(n) }))} /></SettingRow>
            <SettingRow title="Flag stalled agents" desc="Marks a working session as needing you when it has produced no output for this long, so a stuck agent does not sit unnoticed."><Select value={String(st.stallMinutes)} onChange={(e: any) => set({ stallMinutes: +e.target.value })} options={[{ value: '0', label: 'Off' }, { value: '5', label: '5 min' }, { value: '10', label: '10 min' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '60 min' }]} /></SettingRow>
            <SettingRow title="Subagents per session" desc="Most subagents one session may run at once, for Claude Code and for Codex. Off stops agents from starting any. A session can override this."><Select value={String(st.maxSubagentsSession)} onChange={(e: any) => set({ maxSubagentsSession: +e.target.value })} options={subLimits([st.maxSubagentsSession])} /></SettingRow>
            <SettingRow title="Subagents per repository" desc="Most subagents that may run at once across every session of a repository. Counted for Claude Code only: Codex sessions cannot be counted together."><Select value={String(st.maxSubagentsRepo)} onChange={(e: any) => set({ maxSubagentsRepo: +e.target.value })} options={subLimits([st.maxSubagentsRepo, 16, 24])} /></SettingRow>
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
            <SettingRow title="Auto push" desc="Pushes the branch to GitHub, whether the agent or you made it from the Changes panel, so nothing exists only on this machine. Free agents have no remote and are not pushed. A failed push shows in the activity log and is tried again at the next commit."><Switch checked={st.autoPush} onChange={(v: boolean) => set({ autoPush: v })} /></SettingRow>
            <SettingRow title="Push" desc="When auto push is on: after every commit, or once when the session becomes ready for review."><Select value={st.pushWhen} onChange={(e: any) => set({ pushWhen: e.target.value })} options={[{ value: 'commit', label: 'After every commit' }, { value: 'ready', label: 'When ready' }]} /></SettingRow>
            <SettingRow title="Resume agents on launch" desc="When helm opens, agents that were working when it closed pick up where they left off, one after another. Agents waiting on your answer still wait for you, and archived or merged sessions stay as they are."><Switch checked={st.resumeOnLaunch} onChange={(v: boolean) => set({ resumeOnLaunch: v })} /></SettingRow>
            <SettingRow title="Commit author" desc="Co-author: commits are authored by you, with a Co-authored-by trailer for the session. Agent only: commits are authored by the agent (Claude or Codex), with no co-author. Takes effect when a session next starts.">
              <SegmentedControl value={st.commitAuthor} onChange={(v: string) => set({ commitAuthor: v as any })} options={[{ value: 'coauthor', label: 'Co-author' }, { value: 'sole', label: 'Agent only' }]} />
            </SettingRow>
            <SettingRow title="Commit messages" desc="Plain leaves the wording to the agent. Conventional asks for “type(scope): summary”, as release tooling often expects."><Select value={st.commitStyle} onChange={(e: any) => set({ commitStyle: e.target.value })} options={[{ value: 'plain', label: 'Plain' }, { value: 'conventional', label: 'Conventional commits' }]} /></SettingRow>
            <SettingRow title="Session trailer" desc="Ends each commit message with a trailer naming the session (a Co-authored-by line, or Helm-Session when the agent is the sole author)."><Switch checked={st.commitTrailer} onChange={(v: boolean) => set({ commitTrailer: v })} /></SettingRow>
            <SettingRow title="Sign commits" desc="Your git settings follows what git is set up to do. Always signs the agent’s commits and the ones helm makes, with the key in your git configuration (user.signingkey, gpg.format). Agents cannot type a passphrase, so use a key that is loaded in an agent (gpg-agent, ssh-agent). Never leaves commits unsigned even if git is set to sign. Applies when a session next starts."><SegmentedControl value={st.signCommits} onChange={(v: string) => set({ signCommits: v as any })} options={[{ value: 'config', label: 'Your git settings' }, { value: 'on', label: 'Always' }, { value: 'off', label: 'Never' }]} /></SettingRow>
            <SettingRow title="Send messages with" desc={st.sendKey === 'enter' ? 'Enter sends. Shift+Enter starts a new line.' : 'Ctrl+Enter (Cmd+Enter on a Mac) sends. Enter starts a new line.'}>
              <SegmentedControl value={st.sendKey} onChange={(v: string) => set({ sendKey: v as any })} options={[{ value: 'enter', label: 'Enter' }, { value: 'mod-enter', label: platform() === 'darwin' ? 'Cmd+Enter' : 'Ctrl+Enter' }]} />
            </SettingRow>
            <SettingRow title="Interrupt a working agent with" desc="Pauses the agent where it is. The Interrupt button next to Send always works. Esc closes the @ file list first, without interrupting.">
              <SegmentedControl value={st.interruptKey} onChange={(v: string) => set({ interruptKey: v as any })} options={[{ value: 'esc', label: 'Esc' }, { value: 'double-esc', label: 'Esc twice' }, { value: 'off', label: 'Button only' }]} />
            </SettingRow>
            <SettingRow title="Run tests before marking ready" desc="Asks the agent to run the project's tests (package.json, go.mod, Makefile) before it finishes."><Switch checked={st.runTests} onChange={(v: boolean) => set({ runTests: v })} /></SettingRow>
            <SettingRow title="Confirm before deleting a session" desc="When off, a session with nothing to lose is deleted straight away. One with uncommitted or unpushed work, or that worked in your own folder, still asks."><Switch checked={st.confirmDestructive} onChange={(v: boolean) => set({ confirmDestructive: v })} /></SettingRow>
            <SettingRow title="Review model" desc="The model that reviews a session’s changes. Session’s own uses the model the session runs on."><Select value={st.reviewModel} onChange={(e: any) => set({ reviewModel: e.target.value })} options={[{ value: '', label: 'Session’s own' }, ...app.backends.flatMap((b) => b.models.map((m) => ({ value: m.id, label: b.label + ' · ' + m.label })))]} /></SettingRow>
            <SettingRow title="Review automatically" desc="Runs the review when a session becomes ready, so findings are waiting when you open it. It costs a little each time."><Switch checked={st.autoReview} onChange={(v: boolean) => set({ autoReview: v })} /></SettingRow>
          </> : null}
          {sec === 'worktrees' ? <>
            <SettingRow title="Free agents" desc="Lets you start agents that are not tied to a repository, for research, writing and one-off jobs. Turning it off hides the option when starting a session; free agents you already have keep working."><Switch checked={st.freeAgents} onChange={(v: boolean) => set({ freeAgents: v })} /></SettingRow>
            <SettingRow title="Free agents' folders" desc="Where a free agent's scratch folder is made. Agents that are not tied to a repository work in a folder of their own here, with git set up so you can see what changed."><Field value={st.freeRoot} onCommit={(v: string) => set({ freeRoot: v.trim() })} style={{ width: 260 }} /></SettingRow>
            <H sub="Every session gets its own git worktree and branch, so agents never touch your working copy or each other.">Worktrees</H>
            <SettingRow title="Location"><Field value={st.worktreeRoot} onCommit={(v: string) => set({ worktreeRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Clone location" desc="Repositories cloned from GitHub go to <location>/<owner>/<name>."><Field value={st.cloneRoot} onCommit={(v: string) => set({ cloneRoot: v })} style={{ width: 260 }} /></SettingRow>
            <SettingRow title="Branch prefix" desc="New sessions branch from the repository's default branch."><Field value={st.branchPrefix} onCommit={(v: string) => set({ branchPrefix: v })} style={{ width: 120 }} /></SettingRow>
            <SettingRow title="Fetch before a new session" desc="Fetches from GitHub just before branching, so the session starts from the latest. Turn off to start faster or offline."><Switch checked={st.fetchBeforeSession} onChange={(v: boolean) => set({ fetchBeforeSession: v })} /></SettingRow>
            <SettingRow title="Fetch repositories in the background" desc="Keeps GitHub’s branches up to date in each repository, so pushes, pull requests and the unpushed counts stay accurate."><Select value={String(st.fetchMinutes)} onChange={(e: any) => set({ fetchMinutes: +e.target.value })} options={[{ value: '0', label: 'Off' }, { value: '5', label: '5 min' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '60 min' }]} /></SettingRow>
            <SettingRow title="Archive sessions not opened for" desc="Archived sessions leave the left tree and Overview, and stay in the Archive. Their worktree and branch are kept. Sessions that are running, waiting on you, or finished but not yet reviewed are never archived automatically.">
              <Select value={String(st.archiveAfterDays)} onChange={(e: any) => set({ archiveAfterDays: +e.target.value })}
                options={[{ value: '0', label: 'Never' }, ...[3, 7, 14, 30, 60, 90].map((n) => ({ value: String(n), label: n + ' days' }))]} />
            </SettingRow>
            <SettingRow title="Merge pull requests by" desc="The default when you merge a pull request from helm. You can change it each time.">
              <Select value={st.mergeMethod} onChange={(e: any) => set({ mergeMethod: e.target.value })} options={[{ value: 'merge', label: 'Merge commit' }, { value: 'squash', label: 'Squash and merge' }, { value: 'rebase', label: 'Rebase and merge' }]} />
            </SettingRow>
            <SettingRow title="Merge automatically" desc="Merges a pull request opened from helm by itself: once its checks pass, or once they pass and it has been approved."><Select value={st.autoMerge} onChange={(e: any) => set({ autoMerge: e.target.value })} options={[{ value: 'off', label: 'Off' }, { value: 'checks', label: 'When checks pass' }, { value: 'approved', label: 'When checks pass and approved' }]} /></SettingRow>
            <SettingRow title="When a session is ready" desc="Open a pull request for review, or skip it and push the branch straight onto the default branch. You can still choose per session on its Changes tab. A protected branch refuses direct pushes.">
              <SegmentedControl value={st.deliver} onChange={(v: string) => set({ deliver: v as any })} options={[{ value: 'pr', label: 'Pull request' }, { value: 'merge', label: 'Merge directly' }]} />
            </SettingRow>
            <SettingRow title="Open new pull requests in the browser" desc="Opens the pull request on GitHub as soon as helm creates it."><Switch checked={st.openPrAfterCreate} onChange={(v: boolean) => set({ openPrAfterCreate: v })} /></SettingRow>
            <SettingRow title="Open pull requests as drafts" desc="New pull requests start as drafts. You can still choose when opening one."><Switch checked={st.prDraft} onChange={(v: boolean) => set({ prDraft: v })} /></SettingRow>
            <SettingRow title="When its work is merged" desc="What happens to the session once its pull request is merged or it is merged directly. Archiving keeps the conversation and numbers in the Archive; the worktree is removed separately, below.">
              <Select value={st.afterMerge} onChange={(e: any) => set({ afterMerge: e.target.value })} options={[{ value: 'archive', label: 'Archive it' }, { value: 'delete', label: 'Delete it' }, { value: 'keep', label: 'Leave it' }]} />
            </SettingRow>
            <SettingRow title="Remove worktree after merge" desc="Applies to pull requests opened from helm. Turned on automatically when the branch is deleted."><Switch checked={st.removeAfterMerge || st.deleteBranchAfterMerge} onChange={(v: boolean) => set({ removeAfterMerge: v })} /></SettingRow>
            <SettingRow title="Delete branch after merge" desc="Deletes the session's branch on your computer and on GitHub once its work is merged. git will not delete a checked-out branch, so the worktree is removed too."><Switch checked={st.deleteBranchAfterMerge} onChange={(v: boolean) => set({ deleteBranchAfterMerge: v })} /></SettingRow>
            <SettingRow title="Remove worktrees of archived sessions after" desc="Frees disk space once a session has sat in the Archive this long. The branch and conversation are kept; unsaved or unpushed work is never removed."><Select value={String(st.cleanupDays)} onChange={(e: any) => set({ cleanupDays: +e.target.value })} options={[{ value: '0', label: 'Never' }, { value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }]} /></SettingRow>
            <SettingRow title="Clear build output when archiving" desc="Deletes ignored build output and installed packages (node_modules, dist and the like) from a worktree when its session is archived. They come back with an install."><Switch checked={st.reclaimOnArchive} onChange={(v: boolean) => set({ reclaimOnArchive: v })} /></SettingRow>
            <SettingRow title="Copy untracked files" desc={<>Files from your checkout that git does not track, copied into each new worktree. One pattern per line, in .gitignore format: <code>.env</code>, <code>config/*.local.json</code>, <code>**/secrets.*</code>, <code>!keep.env</code> to exclude, <code>#</code> for a comment. Tracked files are never copied.</>}>
              <textarea className="selectable" value={st.copyFiles} rows={5} spellCheck={false} placeholder={'.env\n.env.local'} onChange={(e) => set({ copyFiles: e.target.value })}
                style={{ width: 280, resize: 'vertical', border: 'none', outline: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', color: 'var(--text-1)', font: '400 12px/1.55 var(--font-mono)', padding: '8px 10px', boxSizing: 'border-box' }} />
            </SettingRow>
          </> : null}
          {sec === 'budgets' ? <>
            <H sub="How helm measures and limits usage across your agents. Claude Code's billing is chosen under Claude Code; Codex reports its own from its account.">Usage</H>
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
            {showPlan ? <>
              <SettingRow title="Current plan usage" desc="Reported by each agent as it works. A window resets by itself.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 260 }}>
                  {subs.map((b) => { const p = livePlan(app, b.id); return (
                    <div key={b.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {subs.length > 1 ? <span style={{ font: '600 12px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{b.label}</span> : null}
                      <Meter label="5-hour window" value={p.fiveHour?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={p.fiveHour ? `${Math.round(p.fiveHour.util * 100)}% · resets ${untilReset(p.fiveHour.resetsAt)}` : 'no data yet'} />
                      <Meter label="Weekly" value={p.weekly?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={p.weekly ? `${Math.round(p.weekly.util * 100)}% · resets ${untilReset(p.weekly.resetsAt)}` : 'no data yet'} />
                    </div>
                  ); })}
                </div>
              </SettingRow>
              <SettingRow title="Pause agents at 5-hour usage" desc="Running sessions pause and wait in Needs you when the 5-hour window reaches this. You can continue anyway until it resets."><SegmentedControl size="sm" value={String(st.planPause5h)} onChange={(v: string) => set({ planPause5h: +v })} options={pctOptions} /></SettingRow>
              <SettingRow title="Pause agents at weekly usage" desc="The same for the weekly limit."><SegmentedControl size="sm" value={String(st.planPauseWeek)} onChange={(v: string) => set({ planPauseWeek: +v })} options={pctOptions} /></SettingRow>
              <SettingRow title="Warn at" desc="Meters turn amber at this share of a window."><SegmentedControl size="sm" value={String(st.warnAt)} onChange={(v: string) => set({ warnAt: +v })} options={[{ value: '50', label: '50%' }, { value: '80', label: '80%' }, { value: '90', label: '90%' }]} /></SettingRow>
            </> : null}
            {showDollars ? <>
              <SettingRow title="Weekly limit, all repositories" desc="Agents pause when a limit is reached and wait in Needs you."><Field value={to(st.weeklyLimit)} onCommit={(v: number) => set({ weeklyLimit: from(v) })} {...money0} style={{ width: 100 }} /></SettingRow>
              <SettingRow title="Default per-session limit"><Field value={to(st.sessionBudget)} onCommit={(v: number) => set({ sessionBudget: from(v) })} {...money0} style={{ width: 100 }} /></SettingRow>
            <SettingRow title="At the session limit" desc="Pause stops the agent and waits for you. Warn only tells you and lets it carry on."><Select value={st.budgetAction} onChange={(e: any) => set({ budgetAction: e.target.value })} options={[{ value: 'pause', label: 'Pause the agent' }, { value: 'warn', label: 'Warn only' }]} /></SettingRow>
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
            </> : null}
          </> : null}
          {sec === 'claude' ? (() => { const b = app.backends.find((x) => x.id === 'claude'); return b ? <>
            <H sub="Anthropic's coding agent. Signs in with a Claude subscription or an API key.">Claude Code</H>
            <AgentAccount b={b} heading={false} />
            <SettingRow title="Billing" desc={st.billing === 'subscription' ? 'A Claude subscription (Pro or Max). Usage is limited by plan windows, not dollars, so helm shows plan usage and has no dollar budgets.' : 'Pay per token with an API key. helm tracks cost and enforces the dollar budgets below.'}>
              <SegmentedControl value={st.billing} onChange={(v: string) => set({ billing: v as any, billingDetected: true })} options={[{ value: 'subscription', label: 'Subscription' }, { value: 'api', label: 'API tokens' }]} />
            </SettingRow>
            <SettingRow title="Remote Control for new and resumed sessions" desc="Starts Remote Control (/rc) in every Claude Code agent, so you can follow and drive it from claude.ai/code or the Claude app. Takes effect when a session next starts. Needs a Claude subscription sign-in, and can be blocked by your organisation. Codex has no equivalent."><Switch checked={st.remoteControl} onChange={(v: boolean) => set({ remoteControl: v })} /></SettingRow>
          </> : null; })() : null}
          {sec === 'codex' ? (() => { const b = app.backends.find((x) => x.id === 'codex'); if (!b) return null; const p = livePlan(app, 'codex'); return <>
            <H sub="OpenAI's coding agent (OpenAI Codex). Signs in with a ChatGPT plan or an OpenAI API key.">Codex</H>
            <AgentAccount b={b} heading={false} />
            <SettingRow title="Billing" desc={!b.login?.loggedIn ? 'Known once you are signed in.' : b.login.billing === 'api' ? 'Pay per token with an API key. Codex reports tokens but no dollar cost, so helm shows no cost and its dollar budgets do not apply to Codex.' : 'A ChatGPT plan. Usage is limited by plan windows, not dollars; helm shows them and can pause agents at the percentage set under Usage.'}>
              {b.login?.loggedIn ? <Badge tone="ready" dot>{b.login.billing === 'api' ? 'API tokens' : 'ChatGPT plan'}</Badge> : null}
            </SettingRow>
            {b.login?.loggedIn && b.login.billing !== 'api' ? (
              <SettingRow title="Current plan usage" desc="Reported by Codex as it works.">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}>
                  <Meter label="5-hour window" value={p.fiveHour?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={p.fiveHour ? `${Math.round(p.fiveHour.util * 100)}% · resets ${untilReset(p.fiveHour.resetsAt)}` : 'no data yet'} />
                  <Meter label="Weekly" value={p.weekly?.util ?? 0} max={1} warnAt={st.warnAt / 100} detail={p.weekly ? `${Math.round(p.weekly.util * 100)}% · resets ${untilReset(p.weekly.resetsAt)}` : 'no data yet'} />
                </div>
              </SettingRow>
            ) : null}
            <SettingRow title="Permission modes" desc="How the mode chosen for a session (under Agents, or in the session) is given to Codex. Ask before commands: asks unless a command is trusted, can edit inside the worktree. Allow edits: works inside the worktree and asks only to go beyond it. Plan only: read-only. Allow everything: no approvals, no sandbox." />
            <SettingRow title="Memory" desc="Codex reads AGENTS.md in the repository and in ~/.codex, and keeps its own notes in ~/.codex/memories. They are in the repository's Memory tab, under Codex, and Remember on a message adds to AGENTS.md." />
            <SettingRow title="Subagents" desc="Codex starts its own helpers. The per-session limit under Agents is passed to Codex as its cap on concurrent threads (the session itself counts as one). The repository-wide limit is not applied to Codex." />
            <SettingRow title="Not available with Codex" desc="Remote Control (Claude Code only) and a dollar cost for each session: Codex reports tokens but no cost." />
          </>; })() : null}
          {sec === 'automations' ? <AutomationsSection /> : null}
          {sec === 'mcp' ? <><H sub="Tools and data sources Claude can use in every repository. Add one to a single repository from its MCP tab.">MCP servers</H><McpServers repoId={null} servers={st.mcpServers || []} /></> : null}
          {sec === 'phone' ? <PhoneSection st={{ ...st, githubUser: app.user?.login }} set={set} state={app.p2p} /> : null}
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
            <SettingRow title="Show message text" desc="Desktop notifications include what the agent said or asked. Turn off to show only the session name, for example when sharing your screen."><Switch checked={st.notifyPreview} onChange={(v: boolean) => set({ notifyPreview: v })} /></SettingRow>
            <EmailSection st={st} set={set} passwordSet={app.outboundSecrets.emailPassword} />
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
            <SettingRow title="Keep the computer awake" desc="Stops it sleeping while agents are working, so a long run is not cut short. It sleeps normally when they are idle."><Switch checked={st.keepAwake} onChange={(v: boolean) => set({ keepAwake: v })} /></SettingRow>
            <SettingRow title="Start at login" desc="Opens helm when you sign in to this computer."><Switch checked={st.startAtLogin} onChange={(v: boolean) => set({ startAtLogin: v })} /></SettingRow>
            <SettingRow title="Start in the tray" desc="Opens without the window, leaving the tray icon. Needs the tray icon."><Switch checked={st.startMinimised} onChange={(v: boolean) => set({ startMinimised: v })} /></SettingRow>
            </>}
          </> : null}
          {sec === 'shortcuts' ? <ShortcutsSection st={st} set={set} /> : null}
          {sec === 'custom-shortcuts' ? <CustomShortcutsSection st={st} set={set} /> : null}
          {sec === 'transfer' ? <TransferSection /> : null}
          {sec === 'sync' ? <SyncSection st={st} /> : null}
          {sec === 'about' ? <>
            <H sub="Updates, and what to send if something goes wrong.">About and support</H>
            {hosted ? null : <>
            <SettingRow title="Version" desc={app.update.state === 'dev' ? 'This is a development build, which does not update itself.' : app.update.state === 'ready' ? `Version ${app.update.version} is downloaded and installs when helm restarts.` : app.update.state === 'downloading' ? `Downloading ${app.update.version ?? 'an update'}${app.update.percent != null ? ' · ' + app.update.percent + '%' : ''}` : app.update.state === 'error' ? 'Could not check for updates: ' + app.update.error : app.update.state === 'current' ? 'helm is up to date.' : app.update.state === 'checking' ? 'Checking…' : undefined}>
              {app.update.state === 'ready' ? <Button variant="primary" icon="arrow-clockwise" onClick={() => void api.installUpdate()}>Restart to update</Button> : <Button icon="arrows-clockwise" disabled={app.update.state === 'dev' || app.update.state === 'checking' || app.update.state === 'downloading'} onClick={() => void api.checkForUpdates()}>Check for updates</Button>}
            </SettingRow>
            <SettingRow title="Update automatically" desc="Look for a new version when helm starts and every few hours, download it in the background, and install it the next time helm quits."><Switch checked={st.autoUpdate} onChange={(v: boolean) => set({ autoUpdate: v })} /></SettingRow>
            </>}
            <SettingRow title="Keep the activity log for" desc="Older events are removed. The sessions and their conversations are not affected."><Select value={String(st.activityDays)} onChange={(e: any) => set({ activityDays: +e.target.value })} options={[{ value: '0', label: 'Never' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '180', label: '180 days' }, { value: '365', label: '365 days' }]} /></SettingRow>
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
            {hosted ? null : <SettingRow title="Interface zoom" desc="Scales the whole interface."><Select value={String(st.uiScale)} onChange={(e: any) => set({ uiScale: +e.target.value })} options={[{ value: '80', label: '80%' }, { value: '90', label: '90%' }, { value: '100', label: '100%' }, { value: '110', label: '110%' }, { value: '125', label: '125%' }, { value: '150', label: '150%' }]} /></SettingRow>}
            <SettingRow title="Open on" desc="The page shown when helm opens."><Select value={st.startPage} onChange={(e: any) => set({ startPage: e.target.value })} options={[{ value: 'last', label: 'Where I left off' }, { value: 'overview', label: 'Overview' }, { value: 'inbox', label: 'Needs you' }]} /></SettingRow>
            <SettingRow title="Time format" desc="12 or 24 hour clock for times shown in helm. Automatic follows your computer."><Select value={st.timeFormat} onChange={(e: any) => set({ timeFormat: e.target.value })} options={[{ value: '24', label: '24 hour' }, { value: '12', label: '12 hour' }, { value: 'auto', label: 'Automatic' }]} /></SettingRow>
            <SettingRow title="Fold tool calls" desc="Groups tool calls into one line and shows an edit as just its header, until you open them. Commands are already folded when long."><Switch checked={st.collapseTools} onChange={(v: boolean) => set({ collapseTools: v })} /></SettingRow>
          </> : null}
        </div>
      </div>
      <Dialog open={signOut} width={440} title="Sign out of GitHub?" description="Your sessions and worktrees stay on this machine." onClose={() => setSignOut(false)}
        footer={<><Button variant="ghost" onClick={() => setSignOut(false)}>Cancel</Button><Button variant="danger" onClick={() => { setSignOut(false); void api.signOut(); }}>Sign out</Button></>} />
    </div>
  );
}
