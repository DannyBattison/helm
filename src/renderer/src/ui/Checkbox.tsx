import React from 'react';

export function Checkbox({ checked, defaultChecked = false, label, description, disabled = false, onChange, style }) {
  const [inner, setInner] = React.useState(defaultChecked);
  const on = checked ?? inner;
  const toggle = () => { if (disabled) return; setInner(!on); onChange && onChange(!on); };
  return (
    <label onClick={toggle} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <span role="checkbox" aria-checked={on} style={{ width: 14, height: 14, marginTop: 2, flex: 'none', borderRadius: 'var(--radius-xs)', display: 'grid', placeItems: 'center',
        background: on ? 'var(--accent)' : 'var(--bg-input)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--border-strong)', transition: 'background var(--dur-fast) var(--ease-out)' }}>
        {on ? <i className="ph ph-check" style={{ fontSize: 10, color: 'var(--text-on-accent)', fontWeight: 700 }} /> : null}
      </span>
      {label || description ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {label ? <span style={{ font: '400 13px/1.35 var(--font-sans)', color: 'var(--text-1)' }}>{label}</span> : null}
          {description ? <span style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
