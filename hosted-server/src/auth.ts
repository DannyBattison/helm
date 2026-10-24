import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares tokens in constant time, whatever their lengths. */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** A WebSocket opened by a page on another origin carries the visitor's browser, not ours. Same-origin pages and non-browser clients (no Origin) pass. */
export function originAllowed(origin: string | undefined, host: string | undefined, extra: string[] = []): boolean {
  if (!origin) return true;
  if (extra.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}
