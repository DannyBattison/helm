import type { HelmEvents } from '../../src/shared/types';

/** Messages between the web client and the server, as JSON over one WebSocket. Who is on the other end is decided before it opens, by the sign-in cookie. */
export type ClientMessage = { t: 'call'; id: number; name: string; args: unknown[] };

export type ServerMessage =
  | { t: 'ready' }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; channel: keyof HelmEvents; payload: unknown };

/** API calls that act on the user's own computer; the web client does these itself or refuses. */
export const CLIENT_SIDE = ['chooseFolder', 'openFolder', 'openExternal', 'copyText'] as const;
