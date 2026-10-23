import React from 'react';

export function Select({ value, defaultValue, options = [], icon, mono = false, size = 'md', disabled = false, onChange, style }) {
  const h = size === 'sm' ? 24 : size === 'lg' ? 32 : 28;
  return (
    <label style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: h, padding: '0 26px 0 8px', borderRadius: 'var(--radius-md)',
      background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border-strong)', opacity: disabled ? 0.5 : 1, ...style }}>
      {icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, color: 'var(--text-3)' }} /> : null}
      <select value={value} defaultValue={defaultValue} disabled={disabled} onChange={onChange}
        style={{ appearance: 'none', WebkitAppearance: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)', padding: 0,
          font: mono ? '400 12px/1 var(--font-mono)' : '500 13px/1 var(--font-sans)', cursor: 'pointer', minWidth: 0, flex: 1 }}>
        {options.map(o => { const opt = typeof o === 'string' ? { value: o, label: o } : o; return <option key={opt.value} value={opt.value}>{opt.label}</option>; })}
      </select>
      <i className="ph ph-caret-up-down" style={{ position: 'absolute', right: 7, fontSize: 13, color: 'var(--text-3)', pointerEvents: 'none' }} />
    </label>
  );
}
