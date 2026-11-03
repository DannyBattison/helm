import React from 'react';
import { StatusDot } from './StatusDot';

export function TreeItem({ label, icon, depth = 0, expandable = false, expanded = false, onToggle, selected = false, status, meta, mono = false, trailing, onClick, style }: any) {
  const [hover, setHover] = React.useState(false);

  return (
    <div role="button" tabIndex={0} aria-expanded={expandable ? expanded : undefined} onKeyDown={(e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
      else if (expandable && ((e.key === 'ArrowRight' && !expanded) || (e.key === 'ArrowLeft' && expanded))) { e.preventDefault(); (onToggle || onClick)?.(); }
    }} className="helm-tap-row" aria-current={selected ? 'page' : undefined} onClick={onClick} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }} onPointerLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px 0 ' + (8 + depth * 14) + 'px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: selected ? 'var(--bg-selected)' : hover ? 'var(--bg-hover)' : 'transparent', color: selected ? 'var(--text-1)' : 'var(--text-2)', ...style }}>
      <span role={expandable && onToggle ? 'button' : undefined} tabIndex={expandable && onToggle ? 0 : undefined} aria-label={expandable && onToggle ? (expanded ? 'Collapse' : 'Expand') + ' group' : undefined} onKeyDown={(e) => { if (expandable && onToggle && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); onToggle(); } }} className={expandable && onToggle ? 'helm-tree-caret' : undefined} onClick={expandable && onToggle ? (e) => { e.stopPropagation(); onToggle(); } : undefined}
        style={{ width: 12, flex: 'none', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>
        {expandable ? <i className={'ph ph-caret-' + (expanded ? 'down' : 'right')} style={{ fontSize: 11 }} /> : null}
      </span>
      {status ? <StatusDot status={status} size={10} />
        : icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, flex: 'none', color: selected ? 'var(--accent-text)' : 'var(--text-3)' }} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: mono ? '400 12px/1.5 var(--font-mono)' : '400 13px/1.5 var(--font-sans)', color: selected || hover ? 'var(--text-1)' : undefined }}>{label}</span>
      {meta != null ? <span style={{ font: '400 12px/1.5 var(--font-mono)', color: 'var(--text-3)', flex: 'none' }}>{meta}</span> : null}
      {trailing}
    </div>
  );
}
