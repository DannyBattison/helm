import type { PullRequest, Session } from './types';

/** Why a queued session is waiting, or null when it may start. `running` is how many sessions are working right now. */
export function queueBlock(s: Session, all: Session[], running: number, maxRunning: number): string | null {
  const q = s.queued;
  if (!q) return null;
  if (q.after) {
    const dep = all.find((x) => x.id === q.after);
    // A session that no longer exists cannot be waited for.
    if (dep && !dep.mergedAt) return `Waiting for ${dep.customTitle || dep.title || dep.id} to merge`;
  }
  if (maxRunning > 0 && running >= maxRunning) return `Waiting for a free slot (${running} of ${maxRunning} running)`;
  return null;
}

/** The queued sessions in the order they would start: oldest first. */
export const queueOrder = (all: Session[]) => all.filter((s) => s.queued && !s.archivedAt).sort((a, b) => a.startedAt - b.startedAt);

/** How long a pull request with no checks at all is given to start some before it is merged anyway. */
export const CHECKS_GRACE = 2 * 60_000;

/** What to do next with a queued merge: leave it waiting, merge now, or give up for a reason the user should see. */
export type QueuedMergeStep = { do: 'wait' } | { do: 'merged' } | { do: 'merge' } | { do: 'fail'; error: string };

export function queuedMergeStep(pr: Pick<PullRequest, 'number' | 'state' | 'draft' | 'checks' | 'checkRuns'>, since: number, now: number): QueuedMergeStep {
  if (pr.state === 'merged') return { do: 'merged' };
  if (pr.state === 'closed') return { do: 'fail', error: `Pull request #${pr.number} was closed without being merged.` };
  if (pr.draft) return { do: 'fail', error: `Pull request #${pr.number} is a draft. Mark it ready for review on GitHub, then try again.` };
  if (pr.checks === 'failing') {
    const bad = (pr.checkRuns || []).filter((c) => c.state === 'failing').map((c) => c.name);
    return { do: 'fail', error: `Checks failed on pull request #${pr.number}${bad.length ? ': ' + bad.join(', ') : ''}.` };
  }
  if (pr.checks === 'pending' || (pr.checks === 'none' && now - since < CHECKS_GRACE)) return { do: 'wait' };
  return { do: 'merge' };
}

/** Whether a pull request meets the auto-merge setting: open, not a draft, its checks passing, and for `approved` a review approving it and none asking for changes. */
export function autoMergeReady(pr: Pick<PullRequest, 'state' | 'draft' | 'checks'>, mode: 'off' | 'checks' | 'approved', approved: boolean): boolean {
  if (mode === 'off' || pr.state !== 'open' || pr.draft || pr.checks !== 'passing') return false;
  return mode === 'checks' || approved;
}

/** Reviews, oldest first, to whether the pull request stands approved: each reviewer's latest verdict counts, and any asking for changes blocks it. */
export function approvedByReviews(reviews: { user: string; state: string }[]): boolean {
  const latest = new Map<string, string>();
  for (const r of reviews) if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED' || r.state === 'DISMISSED') latest.set(r.user, r.state);
  const states = [...latest.values()];
  return states.includes('APPROVED') && !states.includes('CHANGES_REQUESTED');
}
