import { comboKeys, matchesCombo, shortcutOf } from '@shared/shortcuts';
import { platform } from './api';
import { getUI, useApp } from './store';

const isMac = () => platform() === 'darwin';

/** Whether a key press is the shortcut for an action. Reads the current setting, so it is safe in a handler set up once. */
export function isShortcut(e: KeyboardEvent | React.KeyboardEvent, id: string): boolean {
  return matchesCombo(e, shortcutOf(getUI().app?.settings.shortcuts, id), isMac());
}

/** The keys to show for an action, such as ['⌘', 'K'], following the setting. */
export function useShortcutKeys(id: string): string[] {
  return comboKeys(shortcutOf(useApp().settings.shortcuts, id), isMac());
}
