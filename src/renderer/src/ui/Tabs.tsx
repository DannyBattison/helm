import React from 'react';

export function Tabs({ tabs = [], value, defaultValue, onChange, onClose, closable = false, variant = 'underline', style }: any) {
  const [inner, setInner] = React.useState(defaultValue ?? (tabs[0] && tabs[0].value));
  const cur = value ?? inner;
  const editor = variant === 'editor';
  // On a phone the strip scrolls sideways: keep the chosen tab in view (without moving anything else on the page).
  const strip = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const measure = React.useCallback(() => {
    const el = strip.current; if (!el) return;
    const next = { left: el.scrollLeft > 2, right: el.scrollWidth - el.clientWidth - el.scrollLeft > 2 };
    setEdges((old) => old.left === next.left && old.right === next.right ? old : next);
  }, []);
  React.useEffect(() => {
    measure();
    if (!strip.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure); observer.observe(strip.current);
    return () => observer.disconnect();
  }, [measure, tabs.length]);
  React.useEffect(() => {
    const c = strip.current, el = c?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!c || !el || c.scrollWidth <= c.clientWidth) return;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    c.scrollTo({ left: c.scrollLeft + (er.left - cr.left) - (cr.width - er.width) / 2 });
  }, [cur]);
  return (
    <div ref={strip} onScroll={measure} role="tablist" className="helm-hscroll helm-tap-tabbar" style={{ display: 'flex', alignItems: 'stretch', gap: editor ? 0 : 16, height: editor ? 34 : 32, borderBottom: '1px solid var(--border)', padding: editor ? 0 : '0 12px', maskImage: edges.left || edges.right ? `linear-gradient(to right, ${edges.left ? 'transparent' : '#000'}, #000 20px, #000 calc(100% - 20px), ${edges.right ? 'transparent' : '#000'})` : undefined, ...style }}>
      {tabs.map(t => {
        const on = t.value === cur;
        return (
          <div key={t.value} role="tab" aria-selected={on} tabIndex={on ? 0 : -1} onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (keys.includes(e.key)) {
              e.preventDefault(); const i = tabs.findIndex((t) => t.value === cur);
              const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
              setInner(tabs[next].value); onChange?.(tabs[next].value);
              strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
            } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setInner(t.value); onChange?.(t.value); }
          }} onClick={() => { setInner(t.value); onChange && onChange(t.value); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1, flex: 'none',
              padding: editor ? '0 10px 0 12px' : 0,
              background: editor ? (on ? 'var(--bg-editor)' : 'transparent') : 'transparent',
              borderRight: editor ? '1px solid var(--border-subtle)' : 'none',
              borderBottom: editor ? (on ? '1px solid var(--bg-editor)' : '1px solid transparent') : on ? '2px solid var(--accent)' : '2px solid transparent',
              boxShadow: editor && on ? 'inset 0 1px 0 var(--accent)' : 'none',
              color: on ? 'var(--text-1)' : 'var(--text-3)', font: editor ? '400 12px/1.5 var(--font-mono)' : '500 13px/1.5 var(--font-sans)' }}>
            {t.icon ? <i aria-hidden="true" className={'ph ph-' + t.icon} style={{ fontSize: 14 }} /> : null}
            {t.label}
            {t.count != null ? <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{t.count}</span> : null}
            {t.dirty ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-2)' }} /> : null}
            {closable ? <button type="button" aria-label={'Close ' + t.label} className="ph ph-x helm-tap-x" onClick={e => { e.stopPropagation(); onClose && onClose(t.value); }} style={{ border: 0, background: 'transparent', fontSize: 12, color: 'var(--text-3)', marginLeft: 2, opacity: on ? 1 : 0.6, cursor: 'pointer' }} /> : null}
          </div>
        );
      })}
    </div>
  );
}
