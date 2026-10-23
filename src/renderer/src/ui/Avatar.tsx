import React from 'react';

export function Avatar({ src, name = '', size = 20, agent = false, style }: any) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const base = { width: size, height: size, flex: 'none', borderRadius: agent ? 'var(--radius-sm)' : '50%', display: 'inline-grid', placeItems: 'center', overflow: 'hidden', ...style };
  if (agent) return <span title={name} style={{ ...base, background: 'var(--accent-muted)', color: 'var(--accent-text)' }}><i className="ph ph-robot" style={{ fontSize: size * 0.62 }} /></span>;
  if (src) return <img src={src} alt={name} style={{ ...base, objectFit: 'cover' }} />;
  return <span title={name} style={{ ...base, background: 'var(--bg-active)', color: 'var(--text-2)', font: '600 ' + Math.round(size * 0.45) + 'px/1 var(--font-sans)' }}>{initial}</span>;
}
