import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendInstruction } from '../src/core/memory';
import { mentionedPaths, memoryHealth, memoryReads, similarity, type MemoryFile } from '../src/shared/memoryhealth';

const NOW = new Date(2026, 9, 21).getTime();
const DAY = 86_400_000;
const mem = (file: string, over: Partial<MemoryFile> = {}): MemoryFile => ({ path: '/m/' + file, file, name: file.replace('.md', ''), description: '', type: 'feedback', modified: NOW - 60 * DAY, index: false, text: '', ...over });

describe('memory reads', () => {
  it('finds memory files that were read or cat-ed, wherever the project folder is', () => {
    const events: any[] = [
      { k: 'tools', items: [['Read', '/home/u/.claude/projects/-x-y/memory/feedback_testing.md', '12 lines'], ['Grep', 'memory/other.md', ''], ['Read', 'C:\\Users\\u\\.claude\\projects\\C--x\\memory\\project_goals.md', '']] },
      { k: 'bash', id: '1', cmd: 'cat ~/.claude/projects/-x-y/memory/user_role.md', out: '', ok: true, meta: '', done: true },
      { k: 'tools', items: [['Read', 'src/memory.ts', '']] }
    ];
    expect(memoryReads(events).sort()).toEqual(['feedback_testing.md', 'project_goals.md', 'user_role.md']);
  });
});

describe('mentioned paths', () => {
  it('keeps repository-looking paths and drops everything else', () => {
    const t = 'Use `src/cart.ts:42` and `package.json`, not `npm test`, `https://x.dev/a.js`, `~/.zshrc`, `/etc/hosts`, `src/*.ts`, `v1.2.3`, `a b.txt`, `./lib/x.go`.';
    expect(mentionedPaths(t)).toEqual(['src/cart.ts', 'package.json', 'lib/x.go']);
  });
});

describe('similarity', () => {
  it('is high for near-duplicates and low for different things', () => {
    expect(similarity('always run the integration tests before merging branches', 'run integration tests before merging any branches always')).toBeGreaterThan(0.6);
    expect(similarity('prefer tabs over spaces in go files', 'the deploy pipeline uses github actions workflows')).toBeLessThan(0.2);
    expect(similarity('', 'anything')).toBe(0);
  });
});

describe('memory health', () => {
  const base = { now: NOW, recentSessions: 10, exists: (p: string) => p === 'src/there.ts' };
  it('flags an old memory that no recent session read, but not one that was read, nor one that is new', () => {
    const out = memoryHealth({ ...base, memories: [mem('old.md'), mem('read.md'), mem('new.md', { modified: NOW - DAY })], usage: { 'read.md': { sessions: 2, last: NOW - 2 * DAY } } });
    expect(out.filter((i) => i.kind === 'stale').map((i) => i.path)).toEqual(['/m/old.md']);
  });
  it('needs enough sessions before calling anything stale', () => {
    expect(memoryHealth({ ...base, recentSessions: 2, memories: [mem('old.md')], usage: {} })).toEqual([]);
  });
  it('flags a mention of a file that is gone', () => {
    const out = memoryHealth({ ...base, memories: [mem('a.md', { modified: NOW, text: 'See `src/there.ts` and `src/gone.ts`' })], usage: {} });
    expect(out).toEqual([{ path: '/m/a.md', kind: 'missing', text: expect.stringContaining('src/gone.ts') }]);
  });
  it('flags two memories of one type that read alike, both ways round', () => {
    const t = 'always run the integration tests before merging branches into main';
    const out = memoryHealth({ ...base, memories: [mem('a.md', { modified: NOW, name: 'tests', text: t }), mem('b.md', { modified: NOW, name: 'tests-again', text: t + ' please' }), mem('c.md', { modified: NOW, type: 'user', text: t })], usage: {} });
    expect(out.filter((i) => i.kind === 'similar').map((i) => i.path).sort()).toEqual(['/m/a.md', '/m/b.md']);
  });
  it('ignores the index file', () => {
    expect(memoryHealth({ ...base, memories: [mem('MEMORY.md', { index: true })], usage: {} })).toEqual([]);
  });
});

describe('appendInstruction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'helm-claude-md-'));
  it('creates the file with the section', async () => {
    const f = join(dir, 'new', 'CLAUDE.md');
    expect(await appendInstruction(f, 'Run `npm test` before committing')).toBe(true);
    expect(readFileSync(f, 'utf8')).toBe('## Learned in helm\n\n- Run `npm test` before committing\n');
  });
  it('adds a section after existing content, and a bullet to an existing section before the next heading', async () => {
    const f = join(dir, 'CLAUDE.md');
    writeFileSync(f, '# Project\n\nUse pnpm.\n');
    await appendInstruction(f, 'first');
    expect(readFileSync(f, 'utf8')).toBe('# Project\n\nUse pnpm.\n\n## Learned in helm\n\n- first\n');
    writeFileSync(f, '# P\n\n## Learned in helm\n\n- one\n\n## Other\n\ntext\n');
    await appendInstruction(f, 'two');
    expect(readFileSync(f, 'utf8')).toBe('# P\n\n## Learned in helm\n\n- one\n- two\n\n## Other\n\ntext\n');
  });
  it('does not add the same line twice, flattens newlines, and refuses nothing', async () => {
    const f = join(dir, 'dup.md');
    await appendInstruction(f, 'a\nb');
    expect(await appendInstruction(f, 'a b')).toBe(false);
    await expect(appendInstruction(f, '  ')).rejects.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

import { diagnostics, scrub } from '../src/shared/diagnostics';

describe('diagnostics bundle', () => {
  const settings: any = { billing: 'api', defaultModel: 'sonnet', permMode: 'ask', deliver: 'pr', mergeMethod: 'merge', afterMerge: 'archive', maxRunning: 0, maxSubagentsSession: 4, maxSubagentsRepo: 8, remoteControl: false, tray: true, autoUpdate: true, claudePath: '/home/danny/bin/claude' };
  const session: any = { id: 'fix-cart', repoId: 'acme/shop', status: 'error', model: 'opus', permMode: 'all', commits: [1], files: 2, lastAccess: 5, task: 'SECRET TASK about the unannounced product', error: 'failed in /home/danny/code/shop with ghp_abcdefghijklmnopqrstuvwxyz0123456789' };
  const input = { now: 0, app: { version: '0.1.0', electron: '45', node: '22', chrome: '140', platform: 'linux', arch: 'x64', os: '6.1', packaged: true }, agents: [{ label: 'Claude Code', version: '2.0' }], gitVersion: '2.43', home: '/home/danny', settings, repos: [{ id: 'acme/shop', private: true, defaultBranch: 'main', localPath: '/home/danny/code/shop' } as any], sessions: [session], log: ['2026 ERROR boom at /home/danny/x token=abc123', 'ok'] };
  it('leaves out task text and paths, and masks secrets and the home folder', () => {
    const out = diagnostics(input);
    expect(out).not.toContain('SECRET TASK');
    expect(out).not.toContain('/home/danny');
    expect(out).not.toContain('ghp_abc');
    expect(out).not.toContain('abc123');
    expect(out).toContain('fix-cart · acme/shop · error · opus');
    expect(out).toContain('custom Claude path yes');
    expect(out).toContain('helm 0.1.0');
  });
  it('scrubs Windows-style home folders too', () => {
    expect(scrub('C:\\Users\\Danny\\code\\x failed', 'C:\\Users\\Danny')).toBe('~\\code\\x failed');
  });
});
