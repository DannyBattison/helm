import React from 'react';
import { currentHint } from '@shared/tutorial';
import { api } from '../api';
import { useUI } from '../store';

/** A tutorial bubble pointing at its children, shown while tutorial mode is on and until it is dismissed. */
export function Hint({ id, side = 'bottom', children, title, text, style }: { id: string; side?: 'bottom' | 'right'; title: string; text: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const on = useUI((u) => { const s = u.app?.settings; return !!s && currentHint(s.tutorial, s.tutorialSeen) === id; });
  const seen = useUI((u) => u.app?.settings.tutorialSeen || []);
  const done = () => void api.updateSettings({ tutorialSeen: [...seen, id] });
  const skip = () => void api.updateSettings({ tutorial: false });
  const anchor = React.useRef<HTMLSpanElement>(null);
  const [box, setBox] = React.useState<DOMRect | null>(null);
  // The bubble is fixed to the window so a scrolling or clipped parent (the sidebar) cannot hide it.
  React.useLayoutEffect(() => {
    if (!on) return;
    const measure = () => setBox(anchor.current?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [on]);
  return (
    <span ref={anchor} className="no-drag" style={{ position: 'relative', display: 'inline-flex', ...style }}>
      {children}
      {on && box ? (
        <div role="status" className="no-drag" style={{ position: 'fixed', zIndex: 50, width: 240, ...(side === 'right' ? { left: box.right + 10, top: box.top } : { top: box.bottom + 10, right: Math.max(8, window.innerWidth - box.right) }), padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 'var(--radius-lg)', background: 'var(--accent)', color: '#fff', boxShadow: 'var(--shadow-dialog)', font: '400 12px/1.5 var(--font-sans)', textAlign: 'left', cursor: 'default', animation: 'helm-fade-in var(--dur-slow) var(--ease-out)' }}>
          <span aria-hidden style={{ position: 'absolute', width: 10, height: 10, background: 'var(--accent)', transform: 'rotate(45deg)', ...(side === 'right' ? { left: -4, top: 12 } : { top: -4, right: 16 }) }} />
          <strong style={{ font: '600 12px/1.4 var(--font-sans)' }}>{title}</strong>
          <span>{text}</span>
          <span style={{ display: 'flex', gap: 12, marginTop: 2 }}>
            <button type="button" onClick={done} style={{ padding: 0, border: 'none', background: 'none', color: '#fff', font: '600 12px/1.5 var(--font-sans)', cursor: 'pointer', textDecoration: 'underline' }}>Got it</button>
            <button type="button" onClick={skip} style={{ padding: 0, border: 'none', background: 'none', color: '#fff', opacity: 0.8, font: '400 12px/1.5 var(--font-sans)', cursor: 'pointer' }}>Turn off tips</button>
          </span>
        </div>
      ) : null}
    </span>
  );
}
