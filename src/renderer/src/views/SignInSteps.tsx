import React from 'react';
import { api } from '../api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

const small: React.CSSProperties = { font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' };

/**
 * The same two steps for every agent: open the sign-in page, then finish it. Only the second differs: Claude shows a code to paste
 * back here, Codex is given one here to enter on its page.
 */
export function SignInSteps({ backend, step, code, setCode, busy, error, onOpen, onPaste, onSubmit, onCancel }: {
  backend: { label: string }; step: { url: string; code?: string; needsCode: boolean }; code: string; setCode(v: string): void; busy: boolean; error?: React.ReactNode;
  onOpen(): void; onPaste(): void; onSubmit(): void; onCancel(): void;
}) {
  return <>
    <Step n={1} title="Open the sign-in page">
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" style={{ flex: 1 }} iconRight="arrow-square-out" onClick={onOpen}>Open {backend.label} sign-in</Button>
        <CopyButton text={step.url} label="Copy link" />
      </div>
      <span style={small}>If the tab did not open, use the button or copy the link into a browser.</span>
    </Step>
    {step.needsCode ? (
      <Step n={2} title="Paste the code it shows">
        <div style={{ display: 'flex', gap: 8 }}>
          <Input mono autoFocus style={{ flex: 1 }} value={code} onChange={(e: any) => setCode(e.target.value)} onKeyDown={(e: any) => { if (e.key === 'Enter' && code.trim() && !busy) onSubmit(); }} placeholder="Paste the code here" />
          <Button size="sm" variant="secondary" icon="clipboard-text" onClick={onPaste}>Paste</Button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="primary" style={{ flex: 1 }} loading={busy} disabled={!code.trim()} onClick={onSubmit}>Continue</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </Step>
    ) : (
      <Step n={2} title="Enter this code there">
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '12px 10px', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', font: '600 24px/1.2 var(--font-mono)', letterSpacing: '0.12em', color: 'var(--text-1)', userSelect: 'all' }}>{step.code}</div>
          {step.code ? <CopyButton text={step.code} label="Copy code" /> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ ...small, flex: 1 }}>Waiting for you to finish. This carries on by itself.</span>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </Step>
    )}
    {error}
  </>;
}

/** One numbered step of a sign-in. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ flex: 'none', width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'var(--bg-active)', color: 'var(--text-2)', font: '600 11px/1 var(--font-mono)', marginTop: 1 }}>{n}</span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: '500 13px/1.5 var(--font-sans)', color: 'var(--text-1)' }}>{title}</span>
        {children}
      </div>
    </div>
  );
}

/** Copies something, and says so for a moment. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => void api.copyText(text).then(() => { setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1500); }).catch(() => undefined);
  return <Button variant="secondary" icon={done ? 'check' : 'copy'} onClick={copy} style={{ flex: 'none' }}>{done ? 'Copied' : label}</Button>;
}
