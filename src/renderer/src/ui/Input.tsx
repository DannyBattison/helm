import React from 'react';

export function Input({ value, defaultValue, placeholder, icon, kbd, mono = false, size = 'md', invalid = false, disabled = false, onChange, style, inputStyle, type = 'text' }) {
  const [focus, setFocus] = React.useState(false);
  const h = size === 'sm' ? 24 : size === 'lg' ? 32 : 28;
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, height: h, padding: '0 8px', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)',
      boxShadow: invalid ? 'inset 0 0 0 1px var(--status-error)' : focus ? 'inset 0 0 0 1px var(--accent), 0 0 0 2px var(--focus-ring)' : 'inset 0 0 0 1px var(--border)',
      opacity: disabled ? 0.5 : 1, transition: 'box-shadow var(--dur-fast) var(--ease-out)', ...style }}>
      {icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, color: 'var(--text-3)' }} /> : null}
      <input type={type} value={value} defaultValue={defaultValue} placeholder={placeholder} disabled={disabled} onChange={onChange}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ flex: 1, minWidth: 0, height: '100%', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-1)',
          font: mono ? '400 12px/1 var(--font-mono)' : '400 13px/1 var(--font-sans)', padding: 0, ...inputStyle }} />
      {kbd ? <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)' }}>{kbd}</span> : null}
    </label>
  );
}
