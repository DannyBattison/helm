import React from 'react';

const TONES = {
  neutral: ['var(--bg-active)', 'var(--text-2)'],
  accent: ['var(--accent-muted)', 'var(--accent-text)'],
  working: ['var(--status-working-bg)', 'var(--status-working-text)'],
  attention: ['var(--status-attention-bg)', 'var(--status-attention-text)'],
  ready: ['var(--status-ready-bg)', 'var(--status-ready-text)'],
  idle: ['var(--status-idle-bg)', 'var(--status-idle-text)'],
  error: ['var(--status-error-bg)', 'var(--status-error-text)'],
};

export function Badge({ tone = 'neutral', dot = false, mono = false, icon, children, style }: any) {
  const [bg, fg] = TONES[tone] || TONES.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 18, padding: '0 6px', borderRadius: 'var(--radius-xs)', background: bg, color: fg,
      font: mono ? '500 11px/1.5 var(--font-mono)' : '500 11px/1.5 var(--font-sans)', whiteSpace: 'nowrap', ...style }}>
      {dot ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} /> : null}
      {icon ? <i className={'ph ph-' + icon} style={{ fontSize: 12 }} /> : null}
      {children}
    </span>
  );
}
