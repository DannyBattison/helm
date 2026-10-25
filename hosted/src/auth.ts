/**
 * A WebSocket opened by a page on another origin carries the visitor's browser (and their cookie), not ours: only the page this server
 * serves may open one. A request with no Origin is not a browser, and has no cookie to ride on, so it fails the sign-in check instead.
 */
export function originAllowed(origin: string | undefined, host: string | undefined, extra: string[] = []): boolean {
  if (!origin) return false;
  if (extra.includes(origin)) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}
