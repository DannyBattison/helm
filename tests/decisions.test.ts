import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Each decision is its own file in decisions/, so branches never touch the same file. Legacy entries are D-NNN-slug.md
// (numbered 1, 2, 3, … with no gaps); new ones are YYYY-MM-DD-slug.md, identified by file name, not by a sequential number.
const dir = new URL('../decisions/', import.meta.url);
const files = readdirSync(dir).filter((f) => f !== 'README.md');
const read = (f: string) => readFileSync(new URL(f, dir), 'utf8');

describe('decisions/', () => {
  it('only holds files named D-NNN-slug.md or YYYY-MM-DD-slug.md', () => {
    for (const f of files) expect(f).toMatch(/^(D-\d{3}|\d{4}-\d\d-\d\d)-[a-z0-9]+(-[a-z0-9]+)*\.md$/);
  });

  it('has no conflict markers', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/^(<<<<<<<|=======|>>>>>>>)/m);
  });

  it('numbers legacy decisions 1, 2, 3, … and matches each heading to its file name', () => {
    const legacy = files.filter((f) => f.startsWith('D-')).sort();
    legacy.forEach((f, i) => {
      expect(f.slice(0, 5), f).toBe(`D-${String(i + 1).padStart(3, '0')}`);
      expect(read(f).split('\n')[0], f).toMatch(new RegExp(`^## D-${i + 1} · \\d{4}-\\d\\d-\\d\\d · \\S`));
    });
  });

  it('gives each dated decision a heading with the date from its file name', () => {
    for (const f of files.filter((f) => !f.startsWith('D-'))) {
      expect(read(f).split('\n')[0], f).toMatch(new RegExp(`^## ${f.slice(0, 10)} · \\S`));
    }
  });
});
