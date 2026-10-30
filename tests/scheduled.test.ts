import { describe, expect, it } from 'vitest';
import { nextAfter, parseLocal, toLocal, validateScheduled } from '../src/shared/scheduled';

const at = (s: string) => new Date(s).getTime();

describe('scheduled prompts', () => {
  it('a one-off has no next slot', () => expect(nextAfter(at('2026-03-02T09:00'), 'none', at('2026-03-02T10:00'))).toBeNull());
  it('repeats hourly, skipping missed slots', () => expect(nextAfter(at('2026-03-02T09:00'), 'hour', at('2026-03-02T11:30'))).toBe(at('2026-03-02T12:00')));
  it('repeats daily', () => expect(nextAfter(at('2026-03-02T09:00'), 'day', at('2026-03-02T09:00'))).toBe(at('2026-03-03T09:00')));
  it('weekdays skip the weekend', () => expect(nextAfter(at('2026-03-06T09:00'), 'weekday', at('2026-03-06T09:30'))).toBe(at('2026-03-09T09:00')));
  it('weekly', () => expect(nextAfter(at('2026-03-02T09:00'), 'week', at('2026-03-02T09:30'))).toBe(at('2026-03-09T09:00')));
  it('round-trips local time', () => expect(parseLocal(toLocal(at('2026-03-02T09:15')))).toBe(at('2026-03-02T09:15')));
  it('validates', () => {
    expect(validateScheduled(' ', 5, 1)).toMatch(/prompt/);
    expect(validateScheduled('x', NaN, 1)).toMatch(/when/);
    expect(validateScheduled('x', 1, 5)).toMatch(/future/);
    expect(validateScheduled('x', 9, 5)).toBeNull();
  });
});
