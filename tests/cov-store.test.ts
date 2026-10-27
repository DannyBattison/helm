import { existsSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../src/core/store';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'helm-covstore-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('activity log rotation', () => {
  it('moves a log over 8 MB aside before appending, and keeps the new event', async () => {
    const s = new Store();
    await s.load(dir);
    const file = join(dir, 'activity.jsonl');
    writeFileSync(file, '');
    truncateSync(file, 8 * 1024 * 1024 + 1);
    s.log({ kind: 'k', t: 5 } as any);
    await s.readLog(); // waits for the write to land
    expect(existsSync(join(dir, 'activity.old.jsonl'))).toBe(true);
    const fresh = await s.readLog();
    expect(fresh.some((e) => e.t === 5)).toBe(true);
  });

  it('leaves a log under the limit in place', async () => {
    const s = new Store();
    await s.load(dir);
    s.log({ kind: 'k', t: 1 } as any);
    await s.readLog();
    expect(existsSync(join(dir, 'activity.old.jsonl'))).toBe(false);
  });
});
