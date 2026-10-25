import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
});

describe('the repository layout', () => {
  it('keeps Electron out of src/, so the hosted server can run the core', () => {
    const offenders = files('src').filter((f) => /from\s+['"]electron(-[a-z]+)?['"]|require\(['"]electron/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('keeps the desktop and hosted folders out of src/', () => {
    const offenders = files('src').filter((f) => /from\s+['"](\.\.\/)+(desktop|hosted)\//.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
