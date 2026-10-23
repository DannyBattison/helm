import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Two branches that each add a decision both pick the next number, and a merge keeps both. This catches that, so the second
// one gets renumbered after the merge instead of leaving a duplicate.
describe('DECISIONS.md', () => {
  const text = readFileSync(new URL('../DECISIONS.md', import.meta.url), 'utf8');
  const numbers = [...text.matchAll(/^## D-(\d+)\b/gm)].map((m) => +m[1]);

  it('has no conflict markers', () => {
    expect(text).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });

  it('numbers decisions 1, 2, 3, … in the order they appear', () => {
    const expected = numbers.map((_, i) => i + 1);
    expect(numbers).toEqual(expected);
  });
});
