import React from 'react';

export function TreeItem({ label, icon, depth = 0, expandable = false, expanded = false, selected = false, status, meta, mono = false, trailing, onClick, style }: any) {
  const [hover, setHover] = React.useState(false);
  return (
    <div role="treeitem" aria-selected={selected} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 8px 0 ' + (8 + depth * 14) + 'px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: selected ? 'var(--bg-selected)' : hover ? 'var(--bg-hover)' : 'transparent', color: selected ? 'var(--text-1)' : 'var(--text-2)', ...style }}>
      <span style={{ width: 12, flex: 'none', display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>
        {expandable ? <i className={'ph ph-caret-' + (expanded ? 'down' : 'right')} style={{ fontSize: 11 }} /> : null}
      </span>
      {status ? <span style={{ width: 7, height: 7, flex: 'none', borderRadius: '50%', background: 'var(--status-' + status + ')', animation: status === 'working' ? 'helm-pulse 1.6s var(--ease-in-out) infinite' : undefined }} />
        : icon ? <i className={'ph ph-' + icon} style={{ fontSize: 14, flex: 'none', color: selected ? 'var(--accent-text)' : 'var(--text-3)' }} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: mono ? '400 12px/1 var(--font-mono)' : '400 13px/1 var(--font-sans)', color: selected || hover ? 'var(--text-1)' : undefined }}>{label}</span>
      {meta != null ? <span style={{ font: '400 11px/1 var(--font-mono)', color: 'var(--text-3)', flex: 'none' }}>{meta}</span> : null}
      {trailing}
    </div>
  );
}
