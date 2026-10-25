import type { Session } from './types';

/** Two branches (or a branch and its base) that would not merge cleanly, or that edit the same files. */
export interface Conflict {
  repoId: string;
  /** A session id. */
  a: string;
  /** Another session id, or `origin/<base>` when it is the base branch that has moved. */
  b: string;
  files: string[];
  /** conflict: git says the merge would conflict. overlap: both edit these files, which git could not check. */
  kind: 'conflict' | 'overlap';
  at: number;
}

/** The conflicted paths in the output of `git merge-tree --write-tree --name-only --no-messages`: a tree id, then one path per line. */
export function parseMergeTree(out: string): string[] {
  const lines = out.split('\n');
  const files: string[] = [];
  for (const l of lines.slice(1)) {
    if (!l.trim()) break;
    if (!files.includes(l)) files.push(l);
  }
  return files;
}

/** Files two sessions both changed. The fallback when git is too old for `merge-tree --write-tree`. */
export function overlap(a: Session, b: Session): string[] {
  const mine = new Set(Object.keys(a.filesTouched || {}));
  return Object.keys(b.filesTouched || {}).filter((f) => mine.has(f));
}

/** Sessions worth comparing: still going, with a worktree and something changed. */
export const forecastable = (s: Session) => !s.archivedAt && !s.mergedAt && !s.worktreeGone && (s.files > 0 || s.commits.length > 0);
