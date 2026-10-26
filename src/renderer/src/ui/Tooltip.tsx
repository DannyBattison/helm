import React from 'react';

export function Tooltip({ content, kbd, side = 'top', open, children, style }: any) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  const pos = side === 'bottom' ? { top: '100%', marginTop: 6 } : { bottom: '100%', marginBottom: 6 };
  return (
    <span onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ position: 'relative', display: 'inline-flex', ...style }}>
      {children}
      {show ? (
        <span role="tooltip" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', ...pos, zIndex: 50, display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '5px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-popover)', whiteSpace: 'nowrap',
          font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-1)', pointerEvents: 'none', animation: 'helm-in var(--dur) var(--ease-out)' }}>
          {content}
          {kbd ? <span style={{ font: '400 11px/1.5 var(--font-mono)', color: 'var(--text-3)' }}>{kbd}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
