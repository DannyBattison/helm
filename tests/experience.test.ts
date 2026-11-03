import { describe, expect, it } from 'vitest';
import { experienceOf, experiencePolicy } from '../src/shared/experience';
import { defaultSettings } from '../src/core/store';

describe('experience presets', () => {
  it('defaults new and unknown preferences to the full Advanced layout', () => {
    expect(defaultSettings().experience).toBe('advanced');
    for (const value of [undefined, null, '', 'unexpected', 'advanced']) expect(experienceOf(value)).toBe('advanced');
  });
  it('reduces presentation without mutating operational preferences', () => {
    const settings = { ...defaultSettings(), experience: 'simple' as const, permMode: 'all' as const, weeklyLimit: 123 };
    const before = structuredClone(settings);
    expect(experiencePolicy(settings)).toMatchObject({ simple: true, board: false, reports: false, detailedUsage: false });
    expect(settings).toEqual(before);
    expect(experiencePolicy({ experience: 'standard' })).toMatchObject({ activity: true, reports: false, simple: false });
    expect(experiencePolicy({ experience: 'advanced' })).toMatchObject({ board: true, reports: true, detailedUsage: true });
  });
});
