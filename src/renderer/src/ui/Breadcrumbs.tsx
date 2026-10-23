import React from 'react';

export function Breadcrumbs({ items = [], mono = false, style }) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, font: mono ? '400 12px/1 var(--font-mono)' : '400 12px/1 var(--font-sans)', color: 'var(--text-3)', ...style }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const o = typeof it === 'string' ? { label: it } : it;
        return (
          <React.Fragment key={i}>
            {i > 0 ? <i className="ph ph-caret-right" style={{ fontSize: 10, color: 'var(--text-disabled)' }} /> : null}
            <span onClick={o.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: last ? 'var(--text-1)' : 'var(--text-3)', cursor: o.onClick ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: last ? 'hidden' : undefined, textOverflow: 'ellipsis' }}>
              {o.icon ? <i className={'ph ph-' + o.icon} style={{ fontSize: 13 }} /> : null}{o.label}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
