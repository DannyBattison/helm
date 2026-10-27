import React from 'react';
import { usePulse } from './pulse';

const COLOR = { working: 'var(--status-working)', attention: 'var(--status-attention)', ready: 'var(--status-ready)', idle: 'var(--status-idle)', error: 'var(--status-error)' };

export function StatusDot({ status = 'idle', size = 8, pulse, style }: any) {
  const p = pulse ?? status === 'working';
  const animation = usePulse(p);
  return <span aria-label={status} style={{ display: 'inline-block', flex: 'none', width: size, height: size, borderRadius: '50%', background: COLOR[status] || COLOR.idle,
    animation, ...style }} />;
}
