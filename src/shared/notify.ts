import type { Settings } from './types';

export type NotifyKind = 'attention' | 'ready' | 'failed';

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Whether `at` falls inside quiet hours. The window may cross midnight (22:00 to 08:00). */
export function inQuietHours(q: Settings['quiet'], at: Date): boolean {
  if (!q.enabled) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  const from = minutes(q.from), to = minutes(q.to);
  if (from === to) return false;
  return from < to ? now >= from && now < to : now >= from || now < to;
}

/** What to do with a notification: show it with or without sound, or not at all. Window focus is the caller's business. */
export function notifyDecision(st: Pick<Settings, 'quiet' | 'notifyRepo' | 'notifyAttention' | 'notifyReady' | 'notifyFailed'>, kind: NotifyKind, repoId: string, at = new Date()): { show: boolean; sound: boolean } {
  const pref = kind === 'attention' ? st.notifyAttention : kind === 'ready' ? st.notifyReady : st.notifyFailed;
  if (!pref.desktop) return { show: false, sound: false };
  const rule = st.notifyRepo[repoId] || 'all';
  if (rule === 'off') return { show: false, sound: false };
  if (rule === 'attention' && kind !== 'attention') return { show: false, sound: false };
  if (inQuietHours(st.quiet, at)) {
    // Quiet hours silence sound always, and notifications unless an agent is blocked and the user asked to hear about that.
    return { show: kind === 'attention' && st.quiet.allowAttention, sound: false };
  }
  return { show: true, sound: pref.sound };
}
