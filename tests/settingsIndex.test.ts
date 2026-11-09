import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingsIndex } from '../src/renderer/src/settingsIndex';

const read = (f: string) => readFileSync(new URL('../src/renderer/src/views/' + f, import.meta.url), 'utf8');
const index = settingsIndex(read('Settings.tsx'), read('RepoSettings.tsx'));

describe('settingsIndex', () => {
  it('finds a setting row on the page it sits on', () => {
    expect(index.worktrees.toLowerCase()).toContain('worktree');
    expect(index.appearance).toContain('Interface font');
    expect(index.notifications).toBeTruthy();
  });
  it('covers pages whose rows live in components of their own', () => {
    expect(index.transfer).toBeTruthy();
    expect(index.sync).toBeTruthy();
    expect(index.appearance).toContain('Code font');
  });
  it('indexes repository settings for every repository page', () => {
    expect(index.repo).toBeTruthy();
    expect(index.defaults).toContain(index.repo.slice(0, 20));
  });
  it('no longer has the organisation toggle', () => {
    expect(Object.values(index).join(' ')).not.toContain('Show organisation in the sidebar');
  });
});
