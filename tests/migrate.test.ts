import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyImport, buildExport, parseExport } from '../src/core/migrate';
import { Store } from '../src/core/store';

const mk = async () => { const s = new Store(); await s.load(await mkdtemp(join(tmpdir(), 'helm-mig-'))); return s; };

describe('import and export', () => {
  it('moves state and transcripts but no secrets', async () => {
    const a = await mk();
    a.data.user = { login: 'me', name: null, email: null, avatar: null, orgs: [] };
    a.data.repos.push({ id: 'o/r', owner: 'o', name: 'r' } as any);
    a.data.sessions.push({ id: 's1', repoId: 'o/r', status: 'working', worktree: '/nope/x', subagents: [], tokens: { input: 0, output: 0, cacheRead: 0 } } as any);
    a.data.settings.worktreeRoot = '/old/root';
    a.data.settings.defaultModel = 'opus';
    await writeFile(join(a.root, 'transcripts', 's1.json'), '[{"k":"text"}]');
    await writeFile(join(a.root, 'auth.bin'), 'SECRET');
    const text = await buildExport(a);
    expect(text).not.toContain('SECRET');
    expect(Object.keys(parseExport(text).files)).toEqual(['transcripts/s1.json']);
    expect((parseExport(text).state as any).user).toBeUndefined();

    const b = await mk();
    const keepRoot = b.data.settings.worktreeRoot;
    expect(await applyImport(b, text)).toEqual({ repos: 1, sessions: 1, files: 1 });
    expect(b.data.user).toBeNull();
    expect(b.data.sessions[0]).toMatchObject({ status: 'idle', worktreeGone: true });
    expect(b.data.settings.defaultModel).toBe('opus');
    expect(b.data.settings.worktreeRoot).toBe(keepRoot);
    expect(await readFile(join(b.root, 'transcripts', 's1.json'), 'utf8')).toBe('[{"k":"text"}]');
    expect(await applyImport(b, text)).toEqual({ repos: 0, sessions: 0, files: 0 });
    expect(b.data.sessions).toHaveLength(1);
  });

  it('rejects other files and escaping paths', async () => {
    expect(() => parseExport('{"a":1}')).toThrow(/not a helm export/);
    const b = await mk();
    const evil = JSON.stringify({ format: 'helm-export', version: 1, exportedAt: 0, state: {}, files: { 'transcripts/../../evil.json': { enc: 'utf8', data: 'x' }, 'auth.bin': { enc: 'utf8', data: 'x' } } });
    expect((await applyImport(b, evil)).files).toBe(0);
  });
});
