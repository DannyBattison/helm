import React from 'react';
import type { BackendInfo } from '@shared/types';
import { api } from '../api';
import { useApp } from '../store';
import { Button, Dialog } from '../ui';
import { SignInSteps } from './SignInSteps';

const errText = (e: any) => String(e?.message || e).replace(/^Error invoking remote method '\w+': Error: /, '');
const text: React.CSSProperties = { margin: 0, font: '400 13px/1.55 var(--font-sans)', color: 'var(--text-2)' };
const small: React.CSSProperties = { font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' };

/** What the user is told about signing in to each agent. */
const HINT: Record<string, string> = {
  claude: 'Use your own account, on a server only you use: Anthropic\'s terms limit sharing a subscription login with other people or apps.',
  codex: 'Use your own ChatGPT account. A Plus, Pro, Business or Enterprise plan includes Codex.'
};

/**
 * The whole sign-in for one agent, in the same two steps for each. Claude ends with a code pasted back here; Codex shows a code to
 * enter on the page it opens, and helm notices when that is done. Calls `onDone` once the agent reports it is signed in.
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
    return <p style={text}>{backend.label} is not installed on this machine, so it cannot be signed in. Install it, or set its path under Settings → Accounts.</p>;
  }
  if (!step) {
    return <>
      <Button size="lg" variant="primary" fullWidth loading={busy} onClick={start}>Sign in with {backend.label}</Button>
      {error}
      {HINT[backend.id] ? <span style={small}>{HINT[backend.id]}</span> : null}
    </>;
  }
  const paste = async () => { try { const t = (await api.readClipboard()).trim(); if (t) setCode(t); } catch { /* the browser may refuse; typing works */ } };
  return <SignInSteps backend={backend} step={step} code={code} setCode={setCode} busy={busy} error={error} onOpen={() => void api.openExternal(step.url)} onPaste={paste} onCopy={(t) => api.copyText(t)} onSubmit={submit} onCancel={startOver} />;
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
