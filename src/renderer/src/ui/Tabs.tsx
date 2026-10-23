import React from 'react';

export function Tabs({ tabs = [], value, defaultValue, onChange, onClose, closable = false, variant = 'underline', style }: any) {
  const [inner, setInner] = React.useState(defaultValue ?? (tabs[0] && tabs[0].value));
  const cur = value ?? inner;
  const editor = variant === 'editor';
  return (
    <div role="tablist" style={{ display: 'flex', alignItems: 'stretch', gap: editor ? 0 : 16, height: editor ? 34 : 32, borderBottom: '1px solid var(--border)', padding: editor ? 0 : '0 12px', overflow: 'hidden', ...style }}>
      {tabs.map(t => {
        const on = t.value === cur;
        return (
          <div key={t.value} role="tab" aria-selected={on} onClick={() => { setInner(t.value); onChange && onChange(t.value); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -1,
              padding: editor ? '0 10px 0 12px' : 0,
              background: editor ? (on ? 'var(--bg-editor)' : 'transparent') : 'transparent',
              borderRight: editor ? '1px solid var(--border-subtle)' : 'none',
              borderBottom: editor ? (on ? '1px solid var(--bg-editor)' : '1px solid transparent') : on ? '2px solid var(--accent)' : '2px solid transparent',
              boxShadow: editor && on ? 'inset 0 1px 0 var(--accent)' : 'none',
              color: on ? 'var(--text-1)' : 'var(--text-3)', font: editor ? '400 12px/1 var(--font-mono)' : '500 13px/1 var(--font-sans)' }}>
            {t.icon ? <i className={'ph ph-' + t.icon} style={{ fontSize: 14 }} /> : null}
            {t.label}
            {t.count != null ? <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{t.count}</span> : null}
            {t.dirty ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-2)' }} /> : null}
            {closable ? <i className="ph ph-x" onClick={e => { e.stopPropagation(); onClose && onClose(t.value); }} style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 2, opacity: on ? 1 : 0.6, cursor: 'pointer' }} /> : null}
          </div>
        );
      })}
    </div>
  );
}
