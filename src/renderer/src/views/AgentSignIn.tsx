import React from 'react';
import type { BackendInfo } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Button, Dialog, Input } from '../ui';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const text: React.CSSProperties = { margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' };
const small: React.CSSProperties = { font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' };

/** What the user is told about signing in to each agent. */
const HINT: Record<string, string> = {
  claude: 'Use your own account, on a server only you use: Anthropic\'s terms limit sharing a subscription login with other people or apps.',
  codex: 'Use your own ChatGPT account. A Plus, Pro, Business or Enterprise plan includes Codex.'
};

/**
 * The whole sign-in for one agent. Claude ends with a code pasted back here; Codex shows a code to enter on the page it
 * opens, and helm notices when that is done. Calls `onDone` once the agent reports it is signed in.
 */
export function AgentSignInPanel({ backend, onDone }: { backend: BackendInfo; onDone?(): void }) {
  const app = useApp();
  const [step, setStep] = React.useState<{ url: string; code?: string; needsCode: boolean } | null>(null);
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(backend.login?.error || '');
  const signedIn = !!app.backends.find((b) => b.id === backend.id)?.login?.loggedIn;
  const done = React.useRef(onDone);
  done.current = onDone;
  React.useEffect(() => { if (signedIn && step) { setStep(null); done.current?.(); } }, [signedIn, step]);
  // Leaving halfway should not leave a sign-in waiting.
  React.useEffect(() => () => { void api.agentLoginCancel(backend.id).catch(() => undefined); }, [backend.id]);

  const start = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await api.agentLoginStart(backend.id);
      setStep(r);
      void api.openExternal(r.url);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const submit = async () => {
    setErr(''); setBusy(true);
    try { await api.agentLoginCode(backend.id, code); }
    catch (e) { setErr(errText(e)); setStep(null); setCode(''); }
    finally { setBusy(false); }
  };
  const startOver = () => { void api.agentLoginCancel(backend.id); setStep(null); setCode(''); setErr(''); };
  const error = err ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--status-error-text)' }}>{err}</span> : null;

  if (!backend.installed) {
    return <p style={text}>{backend.label} is not installed on this machine, so it cannot be signed in. Install it, or set its path under Settings → Agents.</p>;
  }
  if (!step) {
    return <>
      <Button size="lg" variant="primary" fullWidth loading={busy} onClick={start}>Sign in with {backend.label}</Button>
      {error}
      {HINT[backend.id] ? <span style={small}>{HINT[backend.id]}</span> : null}
    </>;
  }
  if (step.needsCode) {
    return <>
      <p style={text}>We opened {backend.label} in a new tab. Approve the sign-in there, and it shows a code. Paste it here to finish. If the tab did not open, use the button below.</p>
      <Button variant="secondary" fullWidth iconRight="arrow-square-out" onClick={() => api.openExternal(step.url)}>Open {backend.label} again</Button>
      <Input mono autoFocus value={code} onChange={(e: any) => setCode(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && code.trim() && !busy) void submit(); }} placeholder="Paste the code here" />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" style={{ flex: 1 }} loading={busy} disabled={!code.trim()} onClick={submit}>Continue</Button>
        <Button variant="ghost" onClick={startOver}>Start over</Button>
      </div>
      {error}
    </>;
  }
  return <>
    <p style={text}>Open the page below, sign in to {backend.label}, and enter this code when it asks. This window carries on by itself once you have.</p>
    {step.code ? (
      <button type="button" title="Copy the code" onClick={() => void api.copyText(step.code!)} style={{ all: 'unset', cursor: 'copy', textAlign: 'center', padding: '14px 10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', font: '600 26px/1.2 var(--font-mono)', letterSpacing: '0.12em', color: 'var(--text-1)' }}>{step.code}</button>
    ) : null}
    <Button variant="secondary" fullWidth iconRight="arrow-square-out" onClick={() => api.openExternal(step.url)}>Open {backend.label} sign-in</Button>
    <span style={small}>Waiting for you to finish…</span>
    <Button variant="ghost" onClick={startOver}>Cancel</Button>
    {error}
  </>;
}

/** A sign-in in a dialog, for the account rows in Settings. */
export function AgentSignInDialog({ backendId, onClose }: { backendId: string; onClose(): void }) {
  const app = useApp();
  const b = app.backends.find((x) => x.id === backendId);
  if (!b) return null;
  return (
    <Dialog width={420} title={`Sign in to ${b.label}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 20px 20px' }}>
        <AgentSignInPanel backend={b} onDone={onClose} />
      </div>
    </Dialog>
  );
}
