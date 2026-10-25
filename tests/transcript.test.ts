import { describe, expect, it } from 'vitest';
import { findBash } from '../src/main/util';

const bash = (id: string) => ({ k: 'bash', id });

describe('finding a command in a transcript', () => {
  it('uses the place it was given when that is right', () => {
    expect(findBash([{ k: 'user' }, bash('a'), bash('b')], 'b', 2)).toBe(2);
  });
  it('finds it by id when the transcript was rebuilt and it moved', () => {
    expect(findBash([{ k: 'user' }, bash('b')], 'b', 5)).toBe(1);
    expect(findBash([bash('x'), bash('b')], 'b', 0)).toBe(1);
  });
  it('says so when it is gone, instead of pointing at nothing', () => {
    expect(findBash([{ k: 'user' }], 'b', 3)).toBe(-1);
    expect(findBash([], 'b', 0)).toBe(-1);
    expect(findBash([null, undefined, bash('a')], 'b', 1)).toBe(-1);
  });
  it('does not take a different command that happens to be in the slot', () => {
    expect(findBash([bash('a'), bash('c')], 'b', 1)).toBe(-1);
  });
});
