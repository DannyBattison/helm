import React from 'react';
import { ControlLabel } from './ControlLabel';

export function Checkbox({ checked, defaultChecked = false, label, description, disabled = false, onChange, style, 'aria-label': ariaLabel }: any) {
  const [inner, setInner] = React.useState(defaultChecked);
  const on = checked ?? inner;
  const rowLabel = React.useContext(ControlLabel);
  const toggle = () => { if (disabled) return; setInner(!on); onChange && onChange(!on); };
  return (
    <label className="helm-tap-label" onClick={(e) => e.stopPropagation()} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, ...style }}>
      <input type="checkbox" role="checkbox" checked={on} disabled={disabled} aria-label={ariaLabel || (typeof label === 'string' ? label : rowLabel) || (label ? undefined : 'Checkbox')} onChange={toggle} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: disabled ? 'default' : 'pointer' }} />
      <span aria-hidden="true" className="helm-tap-check" style={{ width: 14, height: 14, marginTop: 2, flex: 'none', borderRadius: 'var(--radius-xs)', display: 'grid', placeItems: 'center',
        background: on ? 'var(--accent)' : 'var(--bg-input)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--border-strong)', transition: 'background var(--dur-fast) var(--ease-out)' }}>
        {on ? <i className="ph ph-check" style={{ fontSize: 10, color: 'var(--text-on-accent)', fontWeight: 700 }} /> : null}
      </span>
      {label || description ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {label ? <span style={{ font: '400 13px/1.5 var(--font-sans)', color: 'var(--text-1)' }}>{label}</span> : null}
          {description ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
