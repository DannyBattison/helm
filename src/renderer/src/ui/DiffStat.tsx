import React from 'react';

export function DiffStat({ additions = 0, deletions = 0, files, blocks = true, style }: any) {
  const total = additions + deletions;
  const n = 5;
  const g = total ? Math.round((additions / total) * n) : 0;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '400 11.5px/1 var(--font-mono)', whiteSpace: 'nowrap', ...style }}>
      {files != null ? <span style={{ color: 'var(--text-3)' }}>{files} {files === 1 ? 'file' : 'files'}</span> : null}
      <span style={{ color: 'var(--diff-add-fg)' }}>+{additions}</span>
      <span style={{ color: 'var(--diff-del-fg)' }}>−{deletions}</span>
      {blocks ? <span style={{ display: 'inline-flex', gap: 1.5 }}>{Array.from({ length: n }).map((_, i) => (
        <span key={i} style={{ width: 6, height: 6, borderRadius: 1, background: !total ? 'var(--bg-active)' : i < g ? 'var(--diff-add-fg)' : 'var(--diff-del-fg)' }} />
      ))}</span> : null}
    </span>
  );
}
