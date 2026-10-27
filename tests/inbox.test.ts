import { describe, expect, it } from 'vitest';
import { inbox, inboxKey, keyAction } from '../src/shared/inbox';
import { trayEntries } from '../src/shared/tray';
import { CHECKS_GRACE, queuedMergeStep } from '../src/shared/queue';
import type { Session } from '../src/shared/types';

const sess = (o: Partial<Session> = {}): Session => ({ id: 's1', repoId: 'a/b', status: 'working', startedAt: 1, lastAccess: 1, task: 't', ...o } as Session);

describe('inbox artifacts', () => {
  const art = (name: string, at: number, dismissed?: boolean) => ({ name, label: name, at, dismissed });
  it('lists each undismissed artifact as its own item, with its own key', () => {
    const items = inbox([sess({ artifacts: [art('a.png', 5), art('b.pdf', 3), art('old.png', 1, true)] })]);
    expect(items.map((i) => i.artifact?.name)).toEqual(['b.pdf', 'a.png']);
    expect(new Set(items.map(inboxKey)).size).toBe(2);
  });
  it('shows an artifact next to what else the session needs, after the urgent things', () => {
    const items = inbox([sess({ id: 'x', artifacts: [art('a.png', 1)] }), sess({ id: 'y', status: 'error', endedAt: 9 })]);
    expect(items.map((i) => i.kind)).toEqual(['error', 'artifact']);
  });
  it('drops an archived session\'s artifacts', () => {
    expect(inbox([sess({ archivedAt: 5, artifacts: [art('a.png', 1)] })])).toEqual([]);
  });
  it('keys: d downloads, x dismisses, and the tray leaves artifacts out', () => {
    const [item] = inbox([sess({ artifacts: [art('a.png', 1)] })]);
    expect(keyAction(item, 'd')).toEqual({ do: 'download' });
    expect(keyAction(item, 'x')).toEqual({ do: 'dismiss' });
    expect(keyAction(item, 'a')).toBeNull();
    expect(trayEntries([sess({ artifacts: [art('a.png', 1)] })]).total).toBe(0);
  });
});

describe('inbox queued merges', () => {
  const failed = sess({ status: 'ready', prUrl: 'u', queuedMerge: { method: 'squash', deleteBranch: false, since: 1, error: 'Checks failed', errorAt: 7 } });
  it('flags a failed queued merge, but not one that is still waiting', () => {
    const [item] = inbox([failed]);
    expect(item).toMatchObject({ kind: 'merge', since: 7 });
    expect(inbox([sess({ status: 'ready', prUrl: 'u', queuedMerge: { method: 'squash', deleteBranch: false, since: 1 } })])).toEqual([]);
  });
  it('keys: r retries, x cancels', () => {
    const [item] = inbox([failed]);
    expect(keyAction(item, 'r')).toEqual({ do: 'retryMerge' });
    expect(keyAction(item, 'x')).toEqual({ do: 'cancelMerge' });
  });
});

describe('queuedMergeStep', () => {
  const pr = (o: any = {}) => ({ number: 7, state: 'open', draft: false, checks: 'passing', ...o });
  it('waits while checks run, and gives a pull request with no checks two minutes to start some', () => {
    expect(queuedMergeStep(pr({ checks: 'pending' }), 0, 1e9)).toEqual({ do: 'wait' });
    expect(queuedMergeStep(pr({ checks: 'none' }), 1000, 1000 + CHECKS_GRACE - 1)).toEqual({ do: 'wait' });
    expect(queuedMergeStep(pr({ checks: 'none' }), 1000, 1000 + CHECKS_GRACE)).toEqual({ do: 'merge' });
  });
  it('merges when the checks pass', () => {
    expect(queuedMergeStep(pr(), 0, 0)).toEqual({ do: 'merge' });
  });
  it('notices a merge made elsewhere', () => {
    expect(queuedMergeStep(pr({ state: 'merged' }), 0, 0)).toEqual({ do: 'merged' });
  });
  it('fails, saying why, for failing checks, a closed pull request and a draft', () => {
    const runs = [{ name: 'build', state: 'failing', url: '' }, { name: 'lint', state: 'passing', url: '' }, { name: 'test', state: 'failing', url: '' }];
    expect(queuedMergeStep(pr({ checks: 'failing', checkRuns: runs }), 0, 0)).toEqual({ do: 'fail', error: 'Checks failed on pull request #7: build, test.' });
    expect(queuedMergeStep(pr({ checks: 'failing' }), 0, 0)).toEqual({ do: 'fail', error: 'Checks failed on pull request #7.' });
    expect(queuedMergeStep(pr({ state: 'closed' }), 0, 0)).toMatchObject({ do: 'fail', error: expect.stringContaining('closed') });
    expect(queuedMergeStep(pr({ draft: true }), 0, 0)).toMatchObject({ do: 'fail', error: expect.stringContaining('draft') });
  });
});
