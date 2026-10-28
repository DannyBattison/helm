import { describe, expect, it } from 'vitest';
import { percent, without, withProgress, type UploadItem } from '../src/renderer/src/uploads';

const item = (key: string, size: number, sent = 0): UploadItem => ({ key, repoId: 'r', name: key + '.bin', size, sent });

describe('upload tracking', () => {
  it('updates one upload and drops it when done', () => {
    const list = [item('a', 100), item('b', 50)];
    const next = withProgress(list, 'a', 40);
    expect(next.map((x) => x.sent)).toEqual([40, 0]);
    expect(without(next, 'a').map((x) => x.key)).toEqual(['b']);
  });
  it('reports a percentage, and 100 for an empty file', () => {
    expect(percent(item('a', 200, 50))).toBe(25);
    expect(percent(item('a', 0))).toBe(100);
  });
});
