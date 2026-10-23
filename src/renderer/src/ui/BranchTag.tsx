import React from 'react';

export function BranchTag({ name, base, worktree = false, kind = 'branch', style }) {
  const icon = kind === 'commit' ? 'git-commit' : kind === 'pr' ? 'git-pull-request' : worktree ? 'tree-structure' : 'git-branch';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 20, padding: '0 6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-raised)', boxShadow: 'inset 0 0 0 1px var(--border)',
      font: '400 11.5px/1 var(--font-mono)', color: 'var(--text-2)', whiteSpace: 'nowrap', maxWidth: '100%', ...style }}>
      <i className={'ph ph-' + icon} style={{ fontSize: 12, color: 'var(--text-3)', flex: 'none' }} />
      {base ? <><span style={{ color: 'var(--text-3)' }}>{base}</span><i className="ph ph-arrow-left" style={{ fontSize: 10, color: 'var(--text-3)' }} /></> : null}
      <span style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    </span>
  );
}
