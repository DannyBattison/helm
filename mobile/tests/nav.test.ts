import { describe, expect, it } from 'vitest';
import { back, tapTab } from '../src/nav';

describe('the two tabs', () => {
  it('Settings is always one tap away, from the list or from inside a computer (which stays connected)', () => {
    expect(tapTab('servers', 'settings', false)).toEqual({ view: 'settings' });
    expect(tapTab('instance', 'settings', true)).toEqual({ view: 'settings' });
  });
  it('Servers goes back to a computer that is still open, and otherwise to the list', () => {
    expect(tapTab('settings', 'servers', true)).toEqual({ view: 'instance' });
    expect(tapTab('settings', 'servers', false)).toEqual({ view: 'servers' });
    expect(tapTab('servers', 'servers', false)).toEqual({ view: 'servers' });
  });
  it('tapping Servers while inside a computer leaves it, which needs a fresh page', () => {
    expect(tapTab('instance', 'servers', true)).toEqual({ view: 'servers', reload: true });
  });
});

describe('the Android back button', () => {
  it('steps out of a sub-screen, then off the other tab, then leaves the app', () => {
    expect(back('servers', false, true)).toEqual({ view: 'servers' });
    expect(back('servers', false, false)).toBe('minimize');
    expect(back('settings', false, false)).toEqual({ view: 'servers' });
    expect(back('settings', true, false)).toEqual({ view: 'instance' });
    expect(back('instance', true, false)).toEqual({ view: 'servers', reload: true });
  });
});
