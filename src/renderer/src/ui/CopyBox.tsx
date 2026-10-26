import React from 'react';
import { api } from '../api';

/** Wraps a block of code or a command, and shows a Copy button in its corner while the pointer is over it. */
export function CopyBox({ text, children, style }: { text: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const [hover, setHover] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void api.copyText(text).then(() => { setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1500); });
  };
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'relative', ...style }}>
      {children}
      <button type="button" onClick={copy} aria-label={done ? 'Copied' : 'Copy'} title={done ? 'Copied' : 'Copy'}
        style={{ position: 'absolute', top: 6, right: 6, display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: '0 8px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', opacity: hover || done ? 1 : 0, pointerEvents: hover || done ? 'auto' : 'none',
          transition: 'opacity var(--dur-fast) var(--ease-out)', background: 'var(--bg-raised)', color: done ? 'var(--status-ready-text, var(--status-ready))' : 'var(--text-2)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', font: '500 11.5px/1.5 var(--font-sans)' }}>
        <i className={'ph ph-' + (done ? 'check' : 'copy')} style={{ fontSize: 13 }} />{done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
