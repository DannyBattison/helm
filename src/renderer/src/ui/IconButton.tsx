import React from 'react';

export function IconButton({ icon, label, size = 'md', active = false, badge = false, disabled = false, onClick, style, hoverColor, accent = false }: any) {
  const [hover, setHover] = React.useState(false);
  const d = size === 'sm' ? 22 : size === 'lg' ? 32 : 28;
  const ic = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  return (
    <button type="button" className="helm-tap-icon" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => setHover(false)}
      style={{ position: 'relative', width: d, height: d, display: 'inline-grid', placeItems: 'center', border: 'none', borderRadius: 'var(--radius-md)',
        background: accent && !disabled ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : active ? 'var(--bg-active)' : hover && !disabled ? 'var(--bg-hover)' : 'transparent',
        color: accent && !disabled ? 'var(--accent)' : hover && !disabled && hoverColor ? hoverColor : active || hover ? 'var(--text-1)' : 'var(--text-2)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        boxShadow: accent && hover && !disabled ? '0 0 10px 2px color-mix(in srgb, var(--accent) 55%, transparent)' : undefined,
        transition: 'background var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)', padding: 0, ...style }}>
      <i className={'ph ph-' + icon} style={{ fontSize: ic }} />
      {badge ? <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: 'var(--status-attention)', boxShadow: '0 0 0 2px var(--bg-app)' }} /> : null}
    </button>
  );
}
