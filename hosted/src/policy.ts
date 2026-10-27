import type { AppState } from '../../src/shared/types';

/** The only calls someone who has not signed in may make: what helm's own sign-in screen uses. Everything else needs a signed-in connection. */
export const BEFORE_SIGN_IN = ['getState', 'signInStart', 'signInWait', 'signInToken'] as const;

export const callAllowed = (signedIn: boolean, name: unknown): boolean => signedIn || (typeof name === 'string' && (BEFORE_SIGN_IN as readonly string[]).includes(name));

/** Settings that say something about the server: where it keeps things, what it runs, what it has allowed. */
const PRIVATE_SETTINGS = ['claudePath', 'codexPath', 'worktreeRoot', 'cloneRoot', 'copyFiles', 'companionUrl', 'terminalShellCustom', 'alwaysAllow', 'alwaysAsk'];

/**
 * What the sign-in screen is shown before anyone has signed in: the real state with the person, repositories, sessions, activity and
 * anything that describes the server taken out. The screen only needs to know that nobody is signed in, and how to look.
 */
export function signedOutState(s: AppState): AppState {
  const settings: Record<string, unknown> = { ...(s.settings as any) };
  for (const k of PRIVATE_SETTINGS) if (k in settings) settings[k] = Array.isArray(settings[k]) ? [] : '';
  return { ...s, agentLogin: undefined, user: null, repos: [], sessions: [], activity: [], automations: [], weekSpend: {}, lifetime: {}, tokensToday: 0, plan: { at: 0 }, home: '', settings: settings as any } as AppState;
}

/** Allows at most `max` sign-in starts per address per minute: each one is a request to GitHub, and starting one cancels another person's. */
export function signInLimiter(max = 10, now: () => number = Date.now) {
  const seen = new Map<string, number[]>();
  return (ip: string): boolean => {
    const t = now();
    const recent = (seen.get(ip) || []).filter((x) => t - x < 60_000);
    if (recent.length >= max) { seen.set(ip, recent); return false; }
    seen.set(ip, [...recent, t]);
    return true;
  };
}
