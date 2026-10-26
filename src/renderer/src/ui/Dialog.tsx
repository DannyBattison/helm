import React from 'react';
import { useNarrow } from './resize';

export function Dialog({ open = true, title, description, children, footer, width = 520, onClose, inline = false, style }: any) {
  const narrow = useNarrow();
  if (!open) return null;
  const box = (
    <div role="dialog" aria-modal="true" style={{ width, maxWidth: '100%', minWidth: 0, maxHeight: inline ? undefined : narrow ? 'calc(100dvh - 24px)' : 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-xl)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)', animation: 'helm-in var(--dur-slow) var(--ease-out)', ...style }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: narrow ? '14px 10px 0 16px' : '16px 16px 0 20px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ font: '600 16px/1.3 var(--font-sans)', color: 'var(--text-1)' }}>{title}</div>
          {description ? <div style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{description}</div> : null}
        </div>
        {onClose ? <button type="button" className="helm-tap-icon" aria-label="Close" onClick={onClose} style={{ width: 26, height: 26, border: 'none', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}><i className="ph ph-x" style={{ fontSize: 15 }} /></button> : null}
      </header>
      {children ? <div style={{ padding: narrow ? '14px 16px' : '16px 20px', overflow: 'auto', minHeight: 0, flex: '0 1 auto' }}>{children}</div> : <div style={{ height: 16 }} />}
      {footer ? <footer style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>{footer}</footer> : null}
    </div>
  );
  if (inline) return box;
  return <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', background: 'var(--scrim)', padding: narrow ? 12 : 24 }} onClick={e => { if (e.target === e.currentTarget && onClose) onClose(); }}>{box}</div>;
}
