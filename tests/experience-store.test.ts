import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Store } from '../src/core/store';

it('migrates old settings to Advanced and persists an explicitly reduced layout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'helm-experience-'));
  try {
    await writeFile(join(dir, 'helm.json'), JSON.stringify({ settings: { weeklyLimit: 27 }, sessions: [], repos: [] }));
    const store = new Store(); await store.load(dir);
    expect(store.data.settings.experience).toBe('advanced');
    expect(store.data.settings.weeklyLimit).toBe(27);
    store.data.settings.experience = 'simple'; await store.flush();
    const restored = new Store(); await restored.load(dir);
    expect(restored.data.settings.experience).toBe('simple');
    expect(restored.data.settings.weeklyLimit).toBe(27);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
