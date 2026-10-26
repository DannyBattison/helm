import { describe, expect, it } from 'vitest';
import { inbox, inboxKey, keyAction } from '../src/shared/inbox';
import { trayEntries } from '../src/shared/tray';
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
