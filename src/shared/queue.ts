import type { Session } from './types';

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
