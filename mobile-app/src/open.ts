/** Where a tapped notification should take you: a session on one of the computers. */
export interface Target { instance: string; session: string; kind: string }

/** The link a notification carries on Android (an intent the app is registered for); the same fields iOS puts in the notification's extra. */
export const openUrl = (t: Target) => `helm://open?instance=${encodeURIComponent(t.instance)}&session=${encodeURIComponent(t.session)}&kind=${encodeURIComponent(t.kind)}`;

export function parseOpenUrl(url: string | undefined | null): Target | null {
  try {
    const u = new URL(url || '');
    if (u.protocol !== 'helm:' || u.hostname !== 'open') return null;
    return fromExtra({ instance: u.searchParams.get('instance'), session: u.searchParams.get('session'), kind: u.searchParams.get('kind') });
  } catch { return null; }
}

/** From a local notification's `extra` (as the app wrote it, or as the background task did). */
export function fromExtra(x: any): Target | null {
  const instance = String(x?.instance ?? x?.instanceId ?? '');
  const session = String(x?.session ?? x?.sessionId ?? '');
  return instance && session ? { instance, session, kind: String(x?.kind ?? '') } : null;
}

/**
 * What to do with a target given what is on screen: `go` to it now (the right computer is open), `switch` (another is open, or the list is
 * showing: open that computer and then go to it), or `ignore` (that computer is not in the list any more).
 */
export function plan(t: Target, known: { id: string; kind: string }[], openNow: string | null): 'go' | 'switch' | 'ignore' {
  if (!known.some((i) => i.id === t.instance && i.kind === 'desktop')) return 'ignore';
  return openNow === t.instance ? 'go' : 'switch';
}
