/**
 * Keyboard shortcuts that can be changed in Settings. A shortcut is written as a string such as `Mod+K`, `Alt+N` or `Ctrl+Shift+P`:
 * zero or more modifiers in the order Mod, Ctrl, Alt, Shift, Meta, then one key. `Mod` is Cmd on a Mac and Ctrl everywhere else, so a
 * shortcut means the same thing on every platform. Settings store only the shortcuts that differ from the default.
 */
export interface ShortcutAction {
  id: string;
  label: string;
  desc: string;
  default: string;
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'palette', label: 'Search', desc: 'Opens the search for sessions, repositories and commands.', default: 'Mod+K' },
  { id: 'newSession', label: 'New session', desc: 'Opens the new session dialog. Browsers keep Cmd/Ctrl+N for a new window, so use the alternative below there.', default: 'Mod+N' },
  { id: 'newSessionAlt', label: 'New session (alternative)', desc: 'A second shortcut for the same thing, for browsers that do not pass the first one on.', default: 'Alt+N' },
  { id: 'terminal', label: 'Terminal', desc: 'Shows or hides the terminal drawer.', default: 'Ctrl+`' },
  { id: 'quickOpen', label: 'Open a file', desc: 'In the Code tab: jump to a file by name.', default: 'Mod+P' },
  { id: 'saveFile', label: 'Save file', desc: 'In the Code tab: saves the open file.', default: 'Mod+S' }
];

const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];
const NAMED: Record<string, string> = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** The shortcut for an action: the user's, or the default. */
export function shortcutOf(overrides: Record<string, string> | undefined, id: string): string {
  return overrides?.[id] ?? SHORTCUT_ACTIONS.find((a) => a.id === id)?.default ?? '';
}

/** The shortcut a key press makes, or null while only modifiers are held. `mac`: Cmd is Mod and Ctrl is Ctrl; otherwise Ctrl is Mod and the Windows/Super key is Meta. */
export function comboFromEvent(e: { key: string; code?: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS', 'Dead'].includes(e.key)) return null;
  // Letters and digits come from the physical key: Alt+N types a different character on a Mac, and Shift changes the case.
  const fromCode = e.code && /^(Key[A-Z]|Digit\d)$/.test(e.code) ? e.code.slice(-1) : null;
  const key = fromCode ?? NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (mac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (!mac && e.metaKey) mods.push('Meta');
  return [...mods, key].join('+');
}

/** A shortcut split into its modifiers and its key. The key may itself be `+`, as in `Mod++`. */
function parseCombo(combo: string): { mods: string[]; key: string } {
  const key = combo.endsWith('+') ? '+' : combo.slice(combo.lastIndexOf('+') + 1);
  const head = combo.slice(0, combo.length - key.length).split('+').filter(Boolean);
  return { mods: head.map((m) => ORDER.find((o) => o.toLowerCase() === m.toLowerCase()) ?? m), key };
}

/** The same shortcut with its modifiers in the standard order and its key in the standard case, so two spellings compare equal. */
export function normalizeCombo(combo: string): string {
  const { mods, key } = parseCombo(combo);
  return [...ORDER.filter((m) => mods.includes(m)), key.length === 1 ? key.toUpperCase() : key].join('+');
}

export function matchesCombo(e: Parameters<typeof comboFromEvent>[0], combo: string, mac: boolean): boolean {
  return !!combo && comboFromEvent(e, mac) === normalizeCombo(combo);
}

/** The parts to show as keys: `Mod+K` is ⌘ K on a Mac and Ctrl K elsewhere. */
export function comboKeys(combo: string, mac: boolean): string[] {
  const { mods, key } = parseCombo(normalizeCombo(combo));
  return [...mods, key].map((p) => (p === 'Mod' ? (mac ? '⌘' : 'Ctrl') : p === 'Alt' && mac ? '⌥' : p === 'Shift' && mac ? '⇧' : p === 'Ctrl' && mac ? '⌃' : p === 'Meta' ? (mac ? '⌘' : 'Win') : p));
}

/** Whether a shortcut is usable: it needs a key, and a bare letter or digit would fire while typing, so it needs a modifier (other than Shift). */
export function comboProblem(combo: string): string | null {
  const { mods, key } = parseCombo(normalizeCombo(combo));
  if (!key) return 'Press a key';
  if (!mods.some((m) => m !== 'Shift') && (key.length === 1 || ['Space', 'Enter', 'Backspace', 'Tab'].includes(key))) return 'Add Ctrl, Alt or Cmd, or it would trigger while you type';
  return null;
}

/** The other action using this shortcut, if any. */
export function shortcutConflict(overrides: Record<string, string> | undefined, id: string, combo: string): ShortcutAction | undefined {
  const norm = normalizeCombo(combo);
  return SHORTCUT_ACTIONS.find((a) => a.id !== id && normalizeCombo(shortcutOf(overrides, a.id)) === norm);
}
