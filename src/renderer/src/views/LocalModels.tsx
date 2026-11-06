import React from 'react';
import type { BackendInfo, LocalRuntime, Settings as SettingsT } from '@shared/types';
import { api } from '../api';
import { Badge, Button, Dialog, Meter } from '../ui';
import { toast, useApp } from '../store';

const set = (patch: Partial<SettingsT>) => void api.updateSettings(patch);

/** The local model server and its models, for the agent that runs on them (Qwen Code). */
export function LocalModels({ b, row: SettingRow, field: Field }: { b: BackendInfo; row: React.ComponentType<any>; field: React.ComponentType<any> }) {
  const app = useApp();
  const st = app.settings;
  const [rt, setRt] = React.useState<LocalRuntime | null>(null);
  const [busy, setBusy] = React.useState('');
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const hosted = !!window.helmBridge.hosted;
  const refresh = React.useCallback(() => api.localRuntime().then(setRt).catch(() => undefined), []);
  // Downloads take minutes: look often while one is running, and now and then otherwise.
  const pulling = !!rt?.pulls.some((p) => !p.error);
  React.useEffect(() => { void refresh(); const t = setInterval(refresh, pulling ? 1500 : 6000); return () => clearInterval(t); }, [refresh, pulling]);
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e: any) { toast({ tone: 'error', title: 'Local models', description: String(e?.message || e) }); } finally { setBusy(''); void refresh(); }
  };
  const have = new Set((rt?.models || []).map((m) => m.name));
  const pull = (name: string) => act('pull:' + name, () => api.localModelPull(name));
  return (
    <>
      <SettingRow title="Model server" desc={!rt ? 'Checking…' : rt.state === 'running' ? `Ollama is running at ${rt.url}.` : rt.state === 'stopped' ? 'Ollama is installed but not running.' : 'Ollama was not found. Install it from ollama.com, then come back here. Any server with an OpenAI-compatible API works if you set its address below.'}>
        {rt?.state === 'running' ? <Badge tone="ready" dot>running</Badge> : null}
        {rt?.state === 'stopped' ? <Button size="sm" variant="secondary" loading={busy === 'start'} onClick={() => act('start', () => api.localRuntimeStart())}>Start</Button> : null}
        {rt?.state === 'missing' && !hosted ? <Button size="sm" variant="secondary" loading={busy === 'install'} onClick={() => api.ollamaInstallCommand().then(setConfirm)}>Install Ollama</Button> : null}
        {rt?.state === 'missing' ? <Button size="sm" variant="ghost" iconRight="arrow-square-out" onClick={() => api.openExternal('https://ollama.com/download')}>ollama.com</Button> : null}
      </SettingRow>
      <Dialog open={confirm !== null} width={460} title="Install Ollama?" description={<>Helm will download and run Ollama's own installer from ollama.com on this computer:<pre className="selectable" style={{ margin: '8px 0', padding: 8, borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', font: '400 12px/1.5 var(--font-mono)', whiteSpace: 'pre-wrap' }}>{confirm}</pre>It installs for this user on Windows, into Applications on a Mac, and as a system service on Linux, where it needs administrator rights.</>} onClose={() => setConfirm(null)}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="primary" onClick={() => { setConfirm(null); void act('install', () => api.ollamaInstall()); }}>Install</Button></>} />
      <SettingRow title="Server address" desc="Leave empty for Ollama on this computer.">
        <Field value={st.ollamaUrl} onCommit={(v: string) => set({ ollamaUrl: v.trim() })} placeholder="http://localhost:11434" style={{ width: 260 }} />
      </SettingRow>
      <SettingRow title="Context size" desc="How much the model can hold in mind at once, in tokens. Agents need a lot: Ollama's own default is small and silently cuts off long prompts, so helm runs models with this instead. Larger uses more memory.">
        <Field value={st.qwenContext} format={(v: number) => String(v)} parse={(x: string) => { const n = parseInt(x, 10); return Number.isFinite(n) && n >= 4096 && n <= 262144 ? n : undefined; }} onCommit={(v: number) => set({ qwenContext: v })} style={{ width: 100 }} />
      </SettingRow>
      {rt?.state === 'running' ? <>
        <SettingRow title="Downloaded models" desc={rt.models.length ? 'These are offered when you start a session on this agent.' : 'None yet. Download one below.'} />
        {rt.models.map((m) => (
          <SettingRow key={m.name} title={m.name} desc={`${m.sizeGb} GB`}>
            <Button size="sm" variant="ghost" loading={busy === 'rm:' + m.name} onClick={() => act('rm:' + m.name, () => api.localModelRemove(m.name))}>Remove</Button>
          </SettingRow>
        ))}
        <SettingRow title="Recommended models" desc={`This computer has about ${rt.ramGb} GB of memory. Models under about 7B are weak at the tool use an agent needs.`} />
        {rt.recommended.map((r) => {
          const p = rt.pulls.find((x) => x.name === r.name);
          return (
            <SettingRow key={r.name} title={<span>{r.label} <Badge mono>{r.name}</Badge></span>} desc={`${r.sizeGb} GB download, wants ${r.minRamGb} GB of memory${r.fits ? '' : ' (more than this computer has)'}. ${r.note}`}>
              {have.has(r.name) ? <Badge tone="ready" dot>downloaded</Badge>
                : p && !p.error ? <div style={{ width: 160 }}><Meter label={p.status || 'downloading'} value={p.percent} max={100} detail={`${p.percent}%`} /></div>
                : <Button size="sm" variant="secondary" onClick={() => pull(r.name)}>{p?.error ? 'Try again' : 'Download'}</Button>}
            </SettingRow>
          );
        })}
        {rt.pulls.filter((p) => p.error).map((p) => (
          <SettingRow key={p.name} title={`Could not download ${p.name}`} desc={p.error}><Button size="sm" variant="ghost" onClick={() => act('d:' + p.name, () => api.localModelDismiss(p.name))}>Dismiss</Button></SettingRow>
        ))}
      </> : null}
    </>
  );
}
