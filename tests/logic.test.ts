import { describe, expect, it } from 'vitest';
import type { Session } from '../src/shared/types';
import { parseDiff, parseGithubUrl, isGenerated } from '../src/main/git';
import { commandPattern, globMatch, hasShellControl, weekStart } from '../src/main/util';
import { fmtTokens, laneData, NOW_AT } from '../src/renderer/src/lib';

describe('always-allow patterns', () => {
  it('derives a pattern from a simple command', () => {
    expect(commandPattern('pnpm test --update-snapshots')).toBe('pnpm test *');
    expect(commandPattern('go test ./...')).toBe('go test *');
    expect(commandPattern('make')).toBe('make *');
  });

  it('refuses to derive a pattern from chained or redirected commands', () => {
    expect(commandPattern('echo hi && rm -rf /')).toBeUndefined();
    expect(commandPattern('cat a | sh')).toBeUndefined();
    expect(commandPattern('echo $(whoami)')).toBeUndefined();
    expect(commandPattern('echo x > file')).toBeUndefined();
  });

  it('detects shell control characters', () => {
    expect(hasShellControl('pnpm test')).toBe(false);
    for (const c of ['a; b', 'a && b', 'a | b', 'a `b`', 'a $(b)', 'a > b', 'a\nb']) expect(hasShellControl(c)).toBe(true);
  });

  it('matches globs where * is anything', () => {
    expect(globMatch('pnpm test *', 'pnpm test --watch')).toBe(true);
    expect(globMatch('pnpm test *', 'pnpm install')).toBe(false);
    expect(globMatch('go test ./...', 'go test ./...')).toBe(true);
    expect(globMatch('a.b *', 'aXb c')).toBe(false);
  });
});

describe('git parsing', () => {
  it('parses unified diffs with line numbers', () => {
    const h = parseDiff(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -3,3 +3,4 @@ fn', ' a', '-b', '+B', '+C', ' d', '\\ No newline at end of file'].join('\n'));
    expect(h).toHaveLength(1);
    expect(h[0].lines).toEqual([[' ', 3, 3, 'a'], ['-', 4, null, 'b'], ['+', null, 4, 'B'], ['+', null, 5, 'C'], [' ', 5, 6, 'd']]);
  });

  it('reads owner/name from GitHub remotes', () => {
    expect(parseGithubUrl('https://github.com/acme/api.git')).toBe('acme/api');
    expect(parseGithubUrl('git@github.com:acme/api.git')).toBe('acme/api');
    expect(parseGithubUrl('https://example.com/acme/api')).toBeNull();
  });

  it('flags generated files', () => {
    expect(isGenerated('pnpm-lock.yaml')).toBe(true);
    expect(isGenerated('api/openapi.yaml')).toBe(true);
    expect(isGenerated('src/index.ts')).toBe(false);
  });
});

describe('overview helpers', () => {
  const now = Date.UTC(2026, 9, 23, 10, 0);
  const min = (m: number) => now - m * 60000;
  const s = { timeline: [{ t: min(60), status: 'working' }, { t: min(20), status: 'attention' }], commits: [{ hash: 'a', at: min(30) }, { hash: 'b', at: min(500) }], endedAt: undefined } as unknown as Session;

  it('places segments on a 104-minute window ending at now', () => {
    const { segs, marks } = laneData(s, now);
    expect(segs[0][2]).toBe('working');
    expect(segs[0][0]).toBeCloseTo(NOW_AT - 60);
    expect(segs[0][1]).toBeCloseTo(NOW_AT - 20);
    expect(segs[1][1]).toBeCloseTo(NOW_AT);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toBeCloseTo(NOW_AT - 30);
  });

  it('formats token counts', () => {
    expect(fmtTokens(412000)).toBe('412k');
    expect(fmtTokens(2460000)).toBe('2.46M');
    expect(fmtTokens(950)).toBe('950');
  });

  it('starts the week on Monday', () => {
    const w = new Date(weekStart(new Date(2026, 9, 23, 15).getTime()));
    expect(w.getDay()).toBe(1);
    expect(w.getHours()).toBe(0);
  });
});
