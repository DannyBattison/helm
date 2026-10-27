import React from 'react';
import { AgentLogo, hasAgentLogo } from './AgentLogo';

/** `backend` names the agent (claude, codex) so its own mark is drawn in place of the generic robot. */
export function Avatar({ src, name = '', size = 20, agent = false, backend, style }: any) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const base = { width: size, height: size, flex: 'none', borderRadius: agent ? 'var(--radius-sm)' : '50%', display: 'inline-grid', placeItems: 'center', overflow: 'hidden', ...style };
  if (agent && hasAgentLogo(backend)) {
    // Claude's mark keeps its orange; the OpenAI mark is plain, so it takes the text colour and works in both themes.
    const claude = backend === 'claude';
    return <span title={name} style={{ ...base, background: claude ? 'color-mix(in srgb, #D97757 16%, transparent)' : 'var(--bg-active)', color: claude ? '#D97757' : 'var(--text-1)' }}><AgentLogo backend={backend} size={Math.round(size * 0.64)} /></span>;
  }
  if (agent) return <span title={name} style={{ ...base, background: 'var(--accent-muted)', color: 'var(--accent-text)' }}><i className="ph ph-robot" style={{ fontSize: size * 0.62 }} /></span>;
  if (src) return <img src={src} alt={name} style={{ ...base, objectFit: 'cover' }} />;
  return <span title={name} style={{ ...base, background: 'var(--bg-active)', color: 'var(--text-2)', font: '600 ' + Math.round(size * 0.45) + 'px/1 var(--font-sans)' }}>{initial}</span>;
}
