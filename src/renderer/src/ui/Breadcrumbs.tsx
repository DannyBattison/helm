import React from 'react';

/** `compact` (phones) shows earlier crumbs as their icon alone, so the last one, the page you are on, keeps the room. */
export function Breadcrumbs({ items = [], mono = false, compact = false, style }: any) {
  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, font: mono ? '400 12px/1 var(--font-mono)' : '400 12px/1 var(--font-sans)', color: 'var(--text-3)', ...style }}>
      {items.map((it, i) => {
        const last = i === items.length - 1;
        const o = typeof it === 'string' ? { label: it } : it;
        const short = compact && !last;
        return (
          <React.Fragment key={i}>
            {i > 0 ? <i className="ph ph-caret-right" style={{ fontSize: 10, color: 'var(--text-disabled)', flex: 'none' }} /> : null}
            <span onClick={o.onClick} title={short && typeof o.label === 'string' ? o.label : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, flex: last ? '0 1 auto' : 'none', maxWidth: short && !o.icon ? 80 : undefined, padding: short && o.onClick ? '6px 2px' : undefined, color: last ? 'var(--text-1)' : 'var(--text-3)', cursor: o.onClick ? 'pointer' : 'default', whiteSpace: 'nowrap', overflow: last || short ? 'hidden' : undefined, textOverflow: 'ellipsis' }}>
              {o.icon ? <i className={'ph ph-' + o.icon} style={{ fontSize: short ? 15 : 13, flex: 'none' }} /> : null}
              {short && o.icon ? null : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.label}</span>}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
