import React from 'react';

export function SegmentedControl({ options = [], value, defaultValue, size = 'md', onChange, style }: any) {
  const norm = options.map(o => (typeof o === 'string' ? { value: o, label: o } : o));
  const [inner, setInner] = React.useState(defaultValue ?? (norm[0] && norm[0].value));
  const cur = value ?? inner;
  const h = size === 'sm' ? 22 : 26;
  return (
    <div role="tablist" className="helm-hscroll" style={{ display: 'inline-flex', maxWidth: '100%', flex: '0 1 auto', minWidth: 0, padding: 2, gap: 2, borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', boxShadow: 'inset 0 0 0 1px var(--border)', ...style }}>
      {norm.map(o => {
        const on = o.value === cur;
        return (
          <button key={o.value} type="button" role="tab" className="helm-tap-seg" aria-selected={on} onClick={() => { setInner(o.value); onChange && onChange(o.value); }}
            style={{ height: h - 4 + 'px', flex: 'none', padding: o.count != null ? '0 3px 0 10px' : '0 10px', display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              background: on ? 'var(--bg-active)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--border-strong)' : 'none',
              color: on ? 'var(--text-1)' : 'var(--text-3)', font: '500 12px/1.5 var(--font-sans)', whiteSpace: 'nowrap' }}>
            {o.icon ? <i className={'ph ph-' + o.icon} style={{ fontSize: 13 }} /> : null}
            {o.label}
            {o.count != null ? <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 18, height: 16, padding: '0 5px', boxSizing: 'border-box', borderRadius: 'var(--radius-sm)', background: on ? 'var(--bg-input)' : 'var(--bg-hover)', color: on ? 'var(--text-2)' : 'var(--text-3)', font: '500 11px/1 var(--font-sans)', fontVariantNumeric: 'tabular-nums' }}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
