import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lets a test choose the next random session indexes; everything else stays random.
const forced = vi.hoisted(() => ({ next: [] as number[][] }));
vi.mock('@noble/hashes/utils.js', async (orig) => {
  const actual = await orig<typeof import('@noble/hashes/utils.js')>();
  return { ...actual, randomBytes: (n?: number) => (n === 4 && forced.next.length ? Uint8Array.from(forced.next.shift()!) : actual.randomBytes(n)) };
});

import { mkHost, mkPhone, pair } from './p2p-proto-harness';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('host: choosing a session index', () => {
  it('draws again when the index is already in use by another link', async () => {
    const t = mkHost();
    const a = mkPhone(t.identity), b = mkPhone(t.identity, undefined, { host: '198.51.100.8', port: 1 });
    forced.next = [[0, 0, 0, 42]];
    await pair(t, a, flush);
    expect(a.hostIdx).toBe(42);
    forced.next = [[0, 0, 0, 42], [0, 0, 0, 42], [0, 0, 0, 43]];
    await pair(t, b, flush);
    expect(b.hostIdx).toBe(43);
    expect(forced.next).toEqual([]);
    expect(t.h.links).toBe(2);
  });

  it('may reuse an index once its link has ended', async () => {
    const t = mkHost();
    const a = mkPhone(t.identity), b = mkPhone(t.identity, undefined, { host: '198.51.100.8', port: 1 });
    forced.next = [[0, 0, 0, 7]];
    await pair(t, a, flush);
    t.h.close();
    forced.next = [[0, 0, 0, 7]];
    await pair(t, b, flush);
    expect(b.hostIdx).toBe(7);
  });
});
