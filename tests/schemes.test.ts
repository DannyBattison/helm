import { describe, expect, it } from 'vitest';
import { schemeVars } from '../src/shared/schemes';

describe('schemeVars', () => {
  it('sets nothing for the default look', () => {
    expect(schemeVars({ scheme: 'helm' }, true)).toEqual({});
  });
  it('tints surfaces and derives the accent family', () => {
    const v = schemeVars({ scheme: 'ocean' }, true);
    expect(v['--bg-app']).toMatch(/^hsl\(215/);
    expect(v['--accent']).toBe('#58a6ff');
    expect(v['--accent-muted']).toMatch(/^rgba\(88,166,255/);
  });
  it('lets an accent and status colours override, ignoring bad values', () => {
    const v = schemeVars({ scheme: 'helm', accent: '#ffffff', status: { ready: '#00ff00', error: 'red' } }, false);
    expect(v['--accent']).toBe('#ffffff');
    expect(v['--text-on-accent']).toBe('#14141a');
    expect(v['--status-ready']).toBe('#00ff00');
    expect(v['--status-error']).toBeUndefined();
  });
});
