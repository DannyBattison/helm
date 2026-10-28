import { describe, expect, it } from 'vitest';
import { cleanRepoSettings, effectiveSettings } from '../src/shared/repoSettings';
import { defaultSettings } from '../src/core/store';

describe('repository settings', () => {
  it('follow the defaults until a repository overrides them', () => {
    const d = defaultSettings();
    expect(effectiveSettings(d, undefined)).toBe(d);
    expect(effectiveSettings(d, {})).toBe(d);
    const e = effectiveSettings(d, { settings: { permMode: 'all', branchPrefix: 'bot/' } });
    expect(e.permMode).toBe('all');
    expect(e.branchPrefix).toBe('bot/');
    expect(e.defaultModel).toBe(d.defaultModel);
    // A later change to a default reaches a repository that has not overridden it.
    d.runTests = false;
    expect(effectiveSettings(d, { settings: { permMode: 'all' } }).runTests).toBe(false);
  });
  it('ignore keys that cannot be overridden', () => {
    const d = defaultSettings();
    const e = effectiveSettings(d, { settings: { weeklyLimit: 1, worktreeRoot: '/x', autoPush: false } as any });
    expect(e.weeklyLimit).toBe(d.weeklyLimit);
    expect(e.worktreeRoot).toBe(d.worktreeRoot);
    expect(e.autoPush).toBe(false);
    expect(cleanRepoSettings({ weeklyLimit: 1 })).toBeUndefined();
    expect(cleanRepoSettings(null)).toBeUndefined();
  });
});
