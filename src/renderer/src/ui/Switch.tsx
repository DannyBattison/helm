import React from 'react';
import { ControlLabel } from './ControlLabel';

export function Switch({ checked, defaultChecked = false, label, disabled = false, onChange, style, 'aria-label': ariaLabel }: any) {
  const [inner, setInner] = React.useState(defaultChecked);
  const on = checked ?? inner;
  const rowLabel = React.useContext(ControlLabel);
  const toggle = () => { if (disabled) return; setInner(!on); onChange && onChange(!on); };
  return (
    <label className="helm-tap-label" onClick={(e) => e.stopPropagation()} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} aria-label={ariaLabel || (typeof label === 'string' ? label : rowLabel) || (label ? undefined : 'Switch')} onChange={toggle} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: disabled ? 'default' : 'pointer' }} />
      <span aria-hidden="true" className="helm-tap-switch" style={{ position: 'relative', width: 26, height: 15, flex: 'none', borderRadius: 999,
        background: on ? 'var(--accent)' : 'var(--bg-active)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--border-strong)', transition: 'background var(--dur) var(--ease-out)' }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 13 : 2, width: 11, height: 11, borderRadius: '50%', background: on ? 'var(--text-on-accent)' : 'var(--text-2)',
          transition: 'left var(--dur) var(--ease-out)' }} />
      </span>
      {label ? <span style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-1)' }}>{label}</span> : null}
    </label>
  );
}
