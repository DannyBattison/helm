import React from 'react';

export function Stat({ label, value, detail, tone, style }: any) {
  const color = tone ? 'var(--status-' + tone + '-text)' : 'var(--text-1)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...style }}>
      <span style={{ font: '500 11px/1.5 var(--font-sans)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</span>
      <span style={{ font: '500 22px/1.5 var(--font-mono)', letterSpacing: '-0.02em', color }}>{value}</span>
      {detail ? <span style={{ font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{detail}</span> : null}
    </div>
  );
}
