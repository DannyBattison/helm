import React from 'react';

export function Kbd({ keys = [], style }: any) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (
    <span style={{ display: 'inline-flex', gap: 3, ...style }}>
      {list.map((k, i) => (
        <kbd key={i} style={{ minWidth: 18, height: 18, padding: '0 4px', display: 'inline-grid', placeItems: 'center', borderRadius: 'var(--radius-xs)',
          background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border), inset 0 -1px 0 var(--border-strong)',
          font: '500 10.5px/1 var(--font-mono)', color: 'var(--text-2)' }}>{k}</kbd>
      ))}
    </span>
  );
}
