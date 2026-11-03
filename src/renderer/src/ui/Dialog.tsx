import React from 'react';
import { useNarrow } from './resize';

export function Dialog({ open = true, title, description, children, footer, width = 520, onClose, inline = false, style }: any) {
  const narrow = useNarrow();
  const id = React.useId();
  const dialog = React.useRef<HTMLDivElement>(null);
  // Close only if the press began on the scrim too: a text selection dragged out of a field and released over it must not dismiss the dialog.
  const pressed = React.useRef(false);
  const live = open && !inline && !!onClose;
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!live) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || [])].filter((el) => el.getClientRects().length > 0);
    if (!dialog.current?.contains(document.activeElement)) (focusable()[0] || dialog.current)?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Tab' && !document.querySelector('[role="listbox"], [role="menu"]')) {
      const list = focusable(), first = list[0], last = list[list.length - 1];
      if (!first) { e.preventDefault(); dialog.current?.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); close.current?.(); } };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, [live]);
  if (!open) return null;
  const box = (
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal={inline ? undefined : true} aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined} style={{ width, maxWidth: '100%', minWidth: 0, maxHeight: inline ? undefined : narrow ? 'calc(100dvh - 24px)' : 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', borderRadius: 'var(--radius-xl)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)', animation: 'helm-in var(--dur-slow) var(--ease-out)', ...style }}>
      <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: narrow ? '14px 10px 0 16px' : '16px 16px 0 20px' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div id={`${id}-title`} style={{ font: '600 16px/1.5 var(--font-sans)', color: 'var(--text-1)' }}>{title}</div>
          {description ? <div id={`${id}-description`} style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-2)' }}>{description}</div> : null}
        </div>
        {onClose ? <button type="button" className="helm-tap-icon" aria-label="Close" onClick={onClose} style={{ width: 26, height: 26, border: 'none', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer' }}><i className="ph ph-x" style={{ fontSize: 15 }} /></button> : null}
      </header>
      {children ? <div style={{ padding: narrow ? '14px 16px' : '16px 20px', overflow: 'auto', minHeight: 0, flex: '0 1 auto' }}>{children}</div> : <div style={{ height: 16 }} />}
      {footer ? <footer style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '12px 16px', borderTop: '1px solid var(--border-subtle)' }}>{footer}</footer> : null}
    </div>
  );
  if (inline) return box;
  return <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', background: 'var(--scrim)', padding: narrow ? 12 : 24 }} onMouseDown={e => { pressed.current = e.target === e.currentTarget; }} onClick={e => { const down = pressed.current; pressed.current = false; if (down && e.target === e.currentTarget && onClose) onClose(); }}>{box}</div>;
}
