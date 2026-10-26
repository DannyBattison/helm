import { describe, expect, it } from 'vitest';
import { TUTORIAL_HINTS, currentHint } from '../src/shared/tutorial';

describe('currentHint', () => {
  it('shows the first hint that has not been dismissed', () => {
    expect(currentHint(true, [])).toBe(TUTORIAL_HINTS[0]);
    expect(currentHint(true, [TUTORIAL_HINTS[0]])).toBe(TUTORIAL_HINTS[1]);
  });
  it('shows nothing when switched off or when all are dismissed', () => {
    expect(currentHint(false, [])).toBeNull();
    expect(currentHint(true, [...TUTORIAL_HINTS])).toBeNull();
  });
});
