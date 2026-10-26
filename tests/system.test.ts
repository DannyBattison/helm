import { describe, expect, it } from 'vitest';
import { bytesText, cpuTimes, cpuUse, durationText, parseLimit } from '../src/shared/system';

describe('system status', () => {
  it('works out CPU use between readings', () => {
    expect(cpuUse(null, { busy: 10, total: 100 })).toBeNull();
    expect(cpuUse({ busy: 10, total: 100 }, { busy: 10, total: 100 })).toBeNull();
    expect(cpuUse({ busy: 10, total: 100 }, { busy: 60, total: 200 })).toBe(0.5);
  });
  it('sums core times', () => {
    const c = { times: { user: 1, nice: 0, sys: 2, idle: 7, irq: 0 } };
    expect(cpuTimes([c, c])).toEqual({ busy: 6, total: 20 });
  });
  it('ignores unlimited cgroup limits', () => {
    expect(parseLimit('max\n', 8e9)).toBeNull();
    expect(parseLimit('9223372036854771712', 8e9)).toBeNull();
    expect(parseLimit('2147483648\n', 8e9)).toBe(2147483648);
    expect(parseLimit(null, 8e9)).toBeNull();
  });
  it('formats', () => {
    expect(bytesText(1.5e9)).toBe('1.5 GB');
    expect(durationText(90061)).toBe('1d 1h');
    expect(durationText(300)).toBe('5m');
  });
});
