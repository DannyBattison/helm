import React from 'react';

export function Panel({ title, icon, actions, padded = true, children, style, bodyStyle }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'inset 0 0 0 1px var(--border)', ...style }}>
      {title || actions ? (
        <header style={{ height: 34, flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px 0 12px', borderBottom: '1px solid var(--border-subtle)' }}>
          {icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, color: 'var(--text-3)' }} /> : null}
          <span style={{ font: '600 12px/1 var(--font-sans)', color: 'var(--text-1)', flex: 1, minWidth: 0 }}>{title}</span>
          {actions ? <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{actions}</div> : null}
        </header>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, padding: padded ? 12 : 0, ...bodyStyle }}>{children}</div>
    </section>
  );
}
