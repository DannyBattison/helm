import React from 'react';

const ICON = { attention: 'bell-ringing', ready: 'check-circle', error: 'warning-circle', working: 'robot', neutral: 'info' };

export function Toast({ tone = 'neutral', title, description, actions, onClose, style }: any) {
  const color = tone === 'neutral' ? 'var(--text-2)' : 'var(--status-' + tone + ')';
  return (
    <div role="status" style={{ width: 360, maxWidth: '100%', display: 'flex', gap: 10, padding: '10px 10px 10px 12px', borderRadius: 'var(--radius-lg)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-toast)', animation: 'helm-in var(--dur-slow) var(--ease-out)', ...style }}>
      <i className={'ph-fill ph-' + (ICON[tone] || ICON.neutral)} style={{ fontSize: 16, color, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ font: '600 13px/1.3 var(--font-sans)', color: 'var(--text-1)' }}>{title}</div>
        {description ? <div style={{ font: '400 12px/1.45 var(--font-sans)', color: 'var(--text-2)' }}>{description}</div> : null}
        {actions ? <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>{actions}</div> : null}
      </div>
      {onClose ? <button type="button" className="helm-tap-icon" aria-label="Dismiss" onClick={onClose} style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: 0 }}><i className="ph ph-x" style={{ fontSize: 13 }} /></button> : null}
    </div>
  );
}
