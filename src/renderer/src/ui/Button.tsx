import React from 'react';

const SIZES = { sm: { h: 24, px: 8, fs: 12, gap: 5, ic: 14 }, md: { h: 28, px: 10, fs: 13, gap: 6, ic: 15 }, lg: { h: 32, px: 14, fs: 13, gap: 7, ic: 16 } };
const VARIANTS = {
  primary: { bg: 'var(--accent)', hover: 'var(--accent-hover)', press: 'var(--accent-press)', fg: 'var(--text-on-accent)', ring: 'none' },
  secondary: { bg: 'var(--bg-raised)', hover: 'var(--bg-active)', press: 'var(--bg-active)', fg: 'var(--text-1)', ring: 'inset 0 0 0 1px var(--border-strong)' },
  ghost: { bg: 'transparent', hover: 'var(--bg-hover)', press: 'var(--bg-active)', fg: 'var(--text-2)', ring: 'none' },
  danger: { bg: 'var(--status-error-bg)', hover: 'var(--status-error-bg)', press: 'var(--status-error-bg)', fg: 'var(--status-error-text)', ring: 'inset 0 0 0 1px var(--status-error)' },
};

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, kbd, loading = false, disabled = false, fullWidth = false, children, style, onClick, type = 'button', ...rest }: any) {
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const v = VARIANTS[variant] || VARIANTS.secondary;
  const off = disabled || loading;
  return (
    <button type={type} className="helm-tap-btn" disabled={off} onClick={onClick}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => { setHover(false); setPress(false); }}
      onPointerDown={() => setPress(true)} onPointerUp={() => setPress(false)} onPointerCancel={() => setPress(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap, height: s.h, padding: '0 ' + s.px + 'px',
        width: fullWidth ? '100%' : undefined, border: 'none', borderRadius: 'var(--radius-md)', boxShadow: v.ring,
        background: off ? v.bg : press ? v.press : hover ? v.hover : v.bg,
        color: hover && variant === 'ghost' && !off ? 'var(--text-1)' : v.fg,
        font: '500 ' + s.fs + 'px/1 var(--font-sans)', whiteSpace: 'nowrap', cursor: off ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        transition: 'background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)', ...style,
      }} {...rest}>
      {loading ? <i className="ph ph-circle-notch" style={{ fontSize: s.ic, animation: 'helm-spin .8s linear infinite' }} /> : icon ? <i className={'ph ph-' + icon} style={{ fontSize: s.ic }} /> : null}
      {children}
      {iconRight ? <i className={'ph ph-' + iconRight} style={{ fontSize: s.ic }} /> : null}
      {kbd ? <span style={{ font: '400 11px/1.5 var(--font-mono)', opacity: 0.6, marginLeft: 2 }}>{kbd}</span> : null}
    </button>
  );
}
