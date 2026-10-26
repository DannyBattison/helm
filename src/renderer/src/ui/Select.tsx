import React from 'react';
import { createPortal } from 'react-dom';

type Opt = { value: string; label: string };

/**
 * A styled listbox in place of the native <select>, which draws an OS-coloured list that ignores the tokens.
 * `onChange` receives `{ target: { value } }` so it can replace a native handler unchanged.
 */
export function Select({ value, defaultValue, options = [], icon, mono = false, size = 'md', disabled = false, onChange, style }: any) {
  const norm: Opt[] = options.map((o: any) => (typeof o === 'string' ? { value: o, label: o } : o));
  const [inner, setInner] = React.useState(defaultValue ?? norm[0]?.value);
  const cur = value ?? inner;
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const [pos, setPos] = React.useState<React.CSSProperties>({});
  const btn = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const h = size === 'sm' ? 24 : size === 'lg' ? 32 : 28;
  const label = norm.find((o) => o.value === cur)?.label ?? String(cur ?? '');

  const show = () => {
    if (disabled || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 200 && r.top > below;
    setPos({ left: r.left, minWidth: Math.min(Math.max(r.width, 140), window.innerWidth - 16), maxWidth: window.innerWidth - Math.max(r.left, 8) - 8, ...(up ? { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 12 } : { top: r.bottom + 4, maxHeight: below - 12 }) });
    setHi(Math.max(0, norm.findIndex((o) => o.value === cur)));
    setOpen(true);
  };
  const pick = (v: string) => {
    setInner(v);
    setOpen(false);
    onChange && onChange({ target: { value: v } });
    btn.current?.focus();
  };

  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const close = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', down);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  React.useEffect(() => { menu.current?.querySelector('[data-hi="true"]')?.scrollIntoView({ block: 'nearest' }); }, [hi, open]);

  const key = (e: React.KeyboardEvent) => {
    if (!open) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(i + 1, norm.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (norm[hi]) pick(norm[hi].value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const font = mono ? '400 12px/1.5 var(--font-mono)' : '500 13px/1.5 var(--font-sans)';
  return (
    <>
      <button ref={btn} type="button" className="helm-tap-field" disabled={disabled} onClick={() => (open ? setOpen(false) : show())} onKeyDown={key} aria-haspopup="listbox" aria-expanded={open}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: h, padding: '0 26px 0 8px', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-raised)',
          boxShadow: open ? 'inset 0 0 0 1px var(--accent), 0 0 0 2px var(--focus-ring)' : 'inset 0 0 0 1px var(--border-strong)', opacity: disabled ? 0.5 : 1, color: 'var(--text-1)', cursor: disabled ? 'default' : 'pointer', textAlign: 'left', minWidth: 0, ...style }}>
        {icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, color: 'var(--text-3)', flex: 'none' }} /> : null}
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font }}>{label}</span>
        <i className="ph ph-caret-up-down" style={{ position: 'absolute', right: 7, fontSize: 13, color: 'var(--text-3)', pointerEvents: 'none' }} />
      </button>
      {open ? createPortal(
        <div ref={menu} role="listbox" style={{ position: 'fixed', zIndex: 300, overflowY: 'auto', padding: 4, borderRadius: 'var(--radius-lg)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-popover)', animation: 'helm-in var(--dur) var(--ease-out)', ...pos }}>
          {norm.map((o, i) => {
            const on = o.value === cur;
            return (
              <div key={o.value} role="option" className="helm-tap-row" aria-selected={on} data-hi={i === hi} onMouseEnter={() => setHi(i)} onClick={() => pick(o.value)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px 0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: i === hi ? 'var(--bg-hover)' : 'transparent', color: on ? 'var(--text-1)' : 'var(--text-2)', font: mono ? '400 12px/1.5 var(--font-mono)' : '400 13px/1.5 var(--font-sans)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>
                {on ? <i className="ph ph-check" style={{ fontSize: 13, color: 'var(--accent-text)' }} /> : null}
              </div>
            );
          })}
        </div>, document.body) : null}
    </>
  );
}
