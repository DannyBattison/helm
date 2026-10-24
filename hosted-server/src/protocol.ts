import type { HelmEvents } from '../../src/shared/types';

/** Messages between the web client and the server, as JSON over one WebSocket. */
export type ClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'call'; id: number; name: string; args: unknown[] };

export type ServerMessage =
  | { t: 'ready' }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'event'; channel: keyof HelmEvents; payload: unknown };

/** Close code for a wrong or missing token. The client stops retrying and asks again. */
export const CLOSE_UNAUTHORIZED = 4401;

/** API calls that act on the user's own computer; the web client does these itself or refuses. */
export const CLIENT_SIDE = ['chooseFolder', 'openFolder', 'openExternal', 'copyText'] as const;
