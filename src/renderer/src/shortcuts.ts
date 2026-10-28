import { comboKeys, matchesCombo, routeOfTarget, shortcutOf } from '@shared/shortcuts';
import type { CustomShortcut } from '@shared/types';
import { platform } from './api';
import { getUI, go, setUI, useApp, type Route } from './store';

const isMac = () => platform() === 'darwin';

/** Whether a key press is the shortcut for an action. Reads the current setting, so it is safe in a handler set up once. */
export function isShortcut(e: KeyboardEvent | React.KeyboardEvent, id: string): boolean {
  return matchesCombo(e, shortcutOf(getUI().app?.settings.shortcuts, id), isMac());
}

/** The keys to show for an action, such as ['⌘', 'K'], following the setting. */
export function useShortcutKeys(id: string): string[] {
  return comboKeys(shortcutOf(useApp().settings.shortcuts, id), isMac());
}

/** The new session dialog's starting point for the page you are on: the repository of a repository page or of a session. */
export function repoHere(): { repoId?: string } {
  const { route, app } = getUI();
  if (route.screen === 'repo') return { repoId: route.id };
  if (route.screen === 'external') return { repoId: route.repoId };
  if (route.screen === 'session') { const s = app?.sessions.find((x) => x.id === route.id); return s && !s.free ? { repoId: s.repoId } : {}; }
  return {};
}

/** Does what a shortcut you made yourself is set to do: opens the new session dialog prefilled, or goes to a page. */
export function runCustomShortcut(c: CustomShortcut) {
  if (c.action.kind === 'newSession') { setUI({ newSession: { ...(c.action.preset.repoId ? null : repoHere()), ...c.action.preset } }); return; }
  const route = routeOfTarget(c.action.target);
  if (route) go(route as Route);
}
