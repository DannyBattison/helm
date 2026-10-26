import React from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { IconButton } from './IconButton';

/** A picture over the whole window, with its name, size and a download button. Esc, the close button or a click outside it closes. */
export function Lightbox({ src, name, size, alt, onDownload, onClose }: { src: string; name: string; size: string; alt?: string; onDownload?(): void; onClose(): void }) {
  // Close only if the press began outside the picture too, so a drag that ends over the backdrop does not dismiss it.
  const pressed = React.useRef(false);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={name}
      onMouseDown={(e) => { pressed.current = e.target === e.currentTarget; }}
      onClick={(e) => { const down = pressed.current; pressed.current = false; if (down && e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16, background: 'rgba(0,0,0,0.82)', animation: 'helm-fade-in var(--dur-slow) var(--ease-out)' }}>
      <img src={src} alt={alt || name} style={{ maxWidth: '100%', maxHeight: 'calc(100dvh - 120px)', minHeight: 0, objectFit: 'contain', borderRadius: 'var(--radius-md)', background: 'var(--bg-editor)', boxShadow: 'var(--shadow-dialog)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: '100%', padding: '6px 6px 6px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-dialog)' }}>
        <span style={{ font: '500 13px/1.5 var(--font-mono)', color: 'var(--text-1)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-3)', flex: 'none' }}>{size}</span>
        {onDownload ? <Button size="sm" variant="secondary" icon="download-simple" onClick={onDownload}>Download</Button> : null}
        <IconButton icon="x" label="Close" onClick={onClose} />
      </div>
    </div>,
    document.body
  );
}
