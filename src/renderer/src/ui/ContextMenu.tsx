import React from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  /** A thin rule above this item. */
  separator?: boolean;
  onClick(): void;
}

/** A right-click (or long-press) menu at the pointer. Closes on a click elsewhere, Escape, scrolling or resizing. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose(): void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ left: x, top: y });
  const [hi, setHi] = React.useState(-1);
  // A long press opens the menu under the finger, and the touch that ends it must not pick an item.
  const openedAt = React.useRef(Date.now());
  React.useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  React.useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      const live = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => live[(live.indexOf(h) + 1) % live.length]); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => live[(live.indexOf(h) - 1 + live.length) % live.length]); }
      else if (e.key === 'Enter' && hi >= 0) { e.preventDefault(); onClose(); items[hi].onClick(); }
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); window.removeEventListener('resize', onClose); window.removeEventListener('blur', onClose); window.removeEventListener('scroll', onClose, true); };
  }, [items, hi]);
  return createPortal(
    <div ref={ref} role="menu" onContextMenu={(e) => e.preventDefault()} style={{ position: 'fixed', zIndex: 500, minWidth: 200, maxHeight: 'calc(100dvh - 16px)', overflowY: 'auto', padding: 4, borderRadius: 'var(--radius-lg)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-popover)', animation: 'helm-in var(--dur) var(--ease-out)', ...pos }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {it.separator ? <div style={{ height: 1, margin: '4px 6px', background: 'var(--border-subtle)' }} /> : null}
          <div role="menuitem" className="helm-tap-row" aria-disabled={it.disabled} onMouseEnter={() => !it.disabled && setHi(i)} onClick={() => { if (it.disabled || Date.now() - openedAt.current < 400) return; onClose(); it.onClick(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 10px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap', font: '400 13px/1.5 var(--font-sans)', cursor: it.disabled ? 'default' : 'pointer', opacity: it.disabled ? 0.45 : 1,
              background: hi === i ? 'var(--bg-hover)' : 'transparent', color: it.danger ? 'var(--status-error-text)' : 'var(--text-1)' }}>
            <i className={'ph ph-' + (it.icon || 'dot')} style={{ fontSize: 14, color: it.danger ? 'var(--status-error-text)' : 'var(--text-3)', width: 14, visibility: it.icon ? 'visible' : 'hidden' }} />
            {it.label}
          </div>
        </React.Fragment>
      ))}
    </div>, document.body);
}
