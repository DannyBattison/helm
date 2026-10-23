import React from 'react';

/** A grey placeholder bar that pulses while content loads, so the layout does not jump when it arrives. */
export function Skeleton({ w = '100%', h = 10, r = 4, style }: any) {
  return <span aria-hidden style={{ display: 'block', width: w, height: h, borderRadius: r, background: 'var(--bg-active)', animation: 'helm-pulse 1.6s var(--ease-in-out) infinite', ...style }} />;
}
