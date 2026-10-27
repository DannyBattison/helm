/** Which agents are turned on in Settings. At least one always is, and the default agent is always one of them. */
export function normalizeEnabled(next: string[] | undefined, known: string[], prev: string[] | undefined): string[] {
  const wanted = (next || []).filter((id, i, a) => known.includes(id) && a.indexOf(id) === i);
  if (wanted.length) return known.filter((id) => wanted.includes(id));
  // Nothing left on: keep what was on before, else the first agent.
  const before = (prev || []).filter((id) => known.includes(id));
  return before.length ? known.filter((id) => before.includes(id)) : known.slice(0, 1);
}

/** The agent new sessions use: the chosen default when it is on, else the first that is. */
export function defaultAgent(defaultBackend: string, enabled: string[], known: string[]): string {
  return enabled.includes(defaultBackend) ? defaultBackend : enabled[0] ?? known[0] ?? defaultBackend;
}
