import { describe, expect, it } from 'vitest';
import { comboFromEvent, comboKeys, comboProblem, matchesCombo, normalizeCombo, SHORTCUT_ACTIONS, shortcutConflict, shortcutOf } from '../src/shared/shortcuts';

const ev = (o: Partial<Parameters<typeof comboFromEvent>[0]>) => ({ key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });

describe('shortcuts', () => {
  it('turns a key press into a combo, with Mod as Cmd on a Mac and Ctrl elsewhere', () => {
    expect(comboFromEvent(ev({ key: 'k', code: 'KeyK', metaKey: true }), true)).toBe('Mod+K');
    expect(comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), false)).toBe('Mod+K');
    expect(comboFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), true)).toBe('Ctrl+K');
    expect(comboFromEvent(ev({ key: 'p', code: 'KeyP', ctrlKey: true, shiftKey: true }), false)).toBe('Mod+Shift+P');
  });
  it('ignores a lone modifier and reads Alt+letter from the physical key', () => {
    expect(comboFromEvent(ev({ key: 'Control', ctrlKey: true }), false)).toBeNull();
    expect(comboFromEvent(ev({ key: '˜', code: 'KeyN', altKey: true }), true)).toBe('Alt+N');
  });
  it('names special keys and the plus key', () => {
    expect(comboFromEvent(ev({ key: '`', ctrlKey: true }), false)).toBe('Mod+`');
    expect(comboFromEvent(ev({ key: 'ArrowUp', altKey: true }), false)).toBe('Alt+Up');
    expect(comboFromEvent(ev({ key: '+', ctrlKey: true }), false)).toBe('Mod++');
  });
  it('compares spellings of the same combo as equal', () => {
    expect(normalizeCombo('shift+mod+p'.replace('shift', 'Shift').replace('mod', 'Mod'))).toBe('Mod+Shift+P');
    expect(normalizeCombo('Mod+k')).toBe('Mod+K');
    expect(matchesCombo(ev({ key: 'n', code: 'KeyN', ctrlKey: true }), 'Mod+N', false)).toBe(true);
    expect(matchesCombo(ev({ key: 'n', code: 'KeyN', ctrlKey: true, altKey: true }), 'Mod+N', false)).toBe(false);
    expect(matchesCombo(ev({ key: 'n', code: 'KeyN' }), '', false)).toBe(false);
  });
  it('shows keys for the platform', () => {
    expect(comboKeys('Mod+Shift+K', true)).toEqual(['⌘', '⇧', 'K']);
    expect(comboKeys('Mod+Shift+K', false)).toEqual(['Ctrl', 'Shift', 'K']);
    expect(comboKeys('Mod++', false)).toEqual(['Ctrl', '+']);
  });
  it('rejects a bare letter but allows a bare function or arrow key', () => {
    expect(comboProblem('K')).toMatch(/Add/);
    expect(comboProblem('Shift+K')).toMatch(/Add/);
    expect(comboProblem('Alt+K')).toBeNull();
    expect(comboProblem('F5')).toBeNull();
  });
  it('uses an override, then the default, and finds conflicts', () => {
    expect(shortcutOf({}, 'palette')).toBe('Mod+K');
    expect(shortcutOf({ palette: 'Mod+J' }, 'palette')).toBe('Mod+J');
    expect(shortcutOf({ palette: '' }, 'palette')).toBe('');
    expect(shortcutConflict({}, 'palette', 'mod+n')?.id).toBe('newSession');
    expect(shortcutConflict({}, 'palette', 'Mod+Y')).toBeUndefined();
  });
  it('has no duplicate defaults', () => {
    const d = SHORTCUT_ACTIONS.map((a) => normalizeCombo(a.default));
    expect(new Set(d).size).toBe(d.length);
  });
});
