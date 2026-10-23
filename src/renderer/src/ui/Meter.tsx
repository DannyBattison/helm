import React from 'react';

export function Meter({ value = 0, max = 100, label, detail, tone, warnAt = 0.8, height = 4, style }: any) {
  const r = Math.max(0, Math.min(1, max ? value / max : 0));
  const color = tone ? (tone === 'accent' ? 'var(--accent)' : 'var(--status-' + tone + ')') : r >= 1 ? 'var(--status-error)' : r >= warnAt ? 'var(--status-attention)' : 'var(--text-2)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, ...style }}>
      {label || detail ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, font: '400 12px/1.2 var(--font-sans)' }}>
          <span style={{ color: 'var(--text-2)' }}>{label}</span>
          <span style={{ font: '400 11.5px/1.2 var(--font-mono)', color: 'var(--text-1)' }}>{detail}</span>
        </div>
      ) : null}
      <div style={{ height, borderRadius: 999, background: 'var(--bg-active)', overflow: 'hidden' }}>
        <div style={{ width: r * 100 + '%', height: '100%', borderRadius: 999, background: color, transition: 'width var(--dur-slow) var(--ease-out)' }} />
      </div>
    </div>
  );
}
