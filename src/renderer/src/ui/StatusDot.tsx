import React from 'react';
import { usePulse } from './pulse';

const COLOR = { working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)', error: 'var(--status-error)' };

export function StatusDot({ status = 'idle', size = 8, pulse, style }: any) {
  const p = pulse ?? status === 'working';
  const animation = usePulse(p);
  const glyph = { working: 'circle-half', attention: 'warning', ready: 'check-circle', idle: 'minus-circle', error: 'x-circle' }[status] || 'circle';
  return <i role="img" aria-label={status === 'attention' ? 'Needs you' : status} className={'ph-fill ph-' + glyph} style={{ display: 'inline-block', flex: 'none', fontSize: Math.max(size, 12), lineHeight: 1, color: COLOR[status] || COLOR.idle, animation, ...style }} />;
}
