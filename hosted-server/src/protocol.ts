import type { HelmEvents } from '../../src/shared/types';

/** Messages between the web client and the server, as JSON over one WebSocket. A page without a valid cookie may connect, but may only use helm's own sign-in until it has signed in with an allowed username. */
export type ClientMessage = { t: 'call'; id: number; name: string; args: unknown[] };

export type ServerMessage =
  | { t: 'ready' }
  /** Sent to a page that has just signed in and been let in: it exchanges this for its cookie at /auth/claim. */
  | { t: 'session'; claim: string }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; channel: keyof HelmEvents; payload: unknown };

/** API calls that act on the user's own computer; the web client does these itself or refuses. */
export const CLIENT_SIDE = ['chooseFolder', 'openFolder', 'openExternal', 'copyText'] as const;
