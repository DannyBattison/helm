import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';
import { parseEnv } from '../src/core/util';
import { approvedByReviews, autoMergeReady } from '../src/shared/queue';

describe('parseEnv', () => {
  it('reads NAME=value lines, skipping comments, blanks and bad names', () => {
    expect(parseEnv('A=1\n# c\n\nexport B = "two words"\n1BAD=x\nC=\'q\'\nnoequals')).toEqual({ A: '1', B: 'two words', C: 'q' });
  });
  it('copes with Windows line endings and empty values', () => {
    expect(parseEnv('A=\r\nB=2\r\n')).toEqual({ A: '', B: '2' });
  });
});

describe('auto-merge', () => {
  const pr = { state: 'open' as const, draft: false, checks: 'passing' as const };
  it('is off when off, and needs passing checks on an open pull request that is not a draft', () => {
    expect(autoMergeReady(pr, 'off', true)).toBe(false);
    expect(autoMergeReady(pr, 'checks', false)).toBe(true);
    expect(autoMergeReady({ ...pr, checks: 'pending' }, 'checks', true)).toBe(false);
    expect(autoMergeReady({ ...pr, checks: 'none' }, 'checks', true)).toBe(false);
    expect(autoMergeReady({ ...pr, draft: true }, 'checks', true)).toBe(false);
    expect(autoMergeReady({ ...pr, state: 'merged' }, 'checks', true)).toBe(false);
  });
  it('also needs an approval in approved mode', () => {
    expect(autoMergeReady(pr, 'approved', false)).toBe(false);
    expect(autoMergeReady(pr, 'approved', true)).toBe(true);
  });
  it('counts each reviewer’s latest verdict, and any request for changes blocks', () => {
    expect(approvedByReviews([])).toBe(false);
    expect(approvedByReviews([{ user: 'a', state: 'APPROVED' }])).toBe(true);
    expect(approvedByReviews([{ user: 'a', state: 'APPROVED' }, { user: 'b', state: 'CHANGES_REQUESTED' }])).toBe(false);
    expect(approvedByReviews([{ user: 'b', state: 'CHANGES_REQUESTED' }, { user: 'b', state: 'APPROVED' }])).toBe(true);
    expect(approvedByReviews([{ user: 'a', state: 'APPROVED' }, { user: 'a', state: 'COMMENTED' }])).toBe(true);
    expect(approvedByReviews([{ user: 'a', state: 'APPROVED' }, { user: 'a', state: 'DISMISSED' }])).toBe(false);
  });
});

describe('activity log retention', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'helm-prune-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it('removes events older than the limit and keeps newer ones', async () => {
    const s = new Store();
    await s.load(dir);
    const day = 86_400_000;
    s.log({ kind: 'k', t: Date.now() - 40 * day } as any);
    s.log({ kind: 'k', t: Date.now() - 2 * day } as any);
    await s.pruneLog(30);
    const left = await s.readLog();
    expect(left).toHaveLength(1);
  });
  it('does nothing when set to keep it for good', async () => {
    const s = new Store();
    await s.load(dir);
    s.log({ kind: 'k', t: 1 } as any);
    await s.pruneLog(0);
    expect(await s.readLog()).toHaveLength(1);
  });
});

describe('new settings defaults', () => {
  it('keep the behaviour from before they existed', async () => {
    const s = new Store();
    const d = s.data.settings;
    expect(d).toMatchObject({ defaultEffort: 'default', stallMinutes: 0, budgetAction: 'pause', autoMerge: 'off', pushWhen: 'commit', commitTrailer: true, fetchBeforeSession: true, timeFormat: '24', startPage: 'last', uiScale: 100, confirmDestructive: true });
  });
});

import { signingConfig } from '../src/core/git';
describe('commit signing', () => {
  it('maps the choice to git configuration, and leaves git’s own alone by default', () => {
    expect(signingConfig('config')).toEqual([]);
    expect(signingConfig('on')).toEqual(['commit.gpgsign=true']);
    expect(signingConfig('off')).toEqual(['commit.gpgsign=false']);
  });
});
