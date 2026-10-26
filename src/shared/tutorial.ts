/** Tutorial bubbles, in the order a new user should meet them. Only the first one not yet dismissed is shown, so the screen is never crowded. */
export const TUTORIAL_HINTS = ['add-repo', 'search', 'new-session', 'play-pause', 'inbox'] as const;
export type TutorialHint = (typeof TUTORIAL_HINTS)[number];

export function currentHint(enabled: boolean, seen: string[]): TutorialHint | null {
  if (!enabled) return null;
  return TUTORIAL_HINTS.find((h) => !seen.includes(h)) ?? null;
}
