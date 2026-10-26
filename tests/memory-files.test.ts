import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteMemory, memoryDir, projectMemory, readMemory, writeMemory } from '../src/core/memory';
import { flushLog, installLogging, logFile, logLine, recentLog } from '../src/core/log';

let home: string, repo: string, mem: string, oldHome: string | undefined, oldProfile: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'helm-home-'));
  oldHome = process.env.HOME; oldProfile = process.env.USERPROFILE;
  process.env.HOME = home; process.env.USERPROFILE = home;
  repo = join(home, 'code', 'my.repo');
  mkdirSync(repo, { recursive: true });
  mem = join(home, '.claude', 'projects', resolve(repo).replace(/[^a-zA-Z0-9]/g, '-'), 'memory');
  mkdirSync(mem, { recursive: true });
});
afterEach(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
  rmSync(home, { recursive: true, force: true });
});

describe('project memory', () => {
  it('finds the memory folder, case-insensitively, and null when there is none', async () => {
    expect(await memoryDir(repo)).toBe(mem);
    expect(await memoryDir(join(home, 'elsewhere'))).toBeNull();
  });

  it('lists memories with their frontmatter, and instruction files', async () => {
    writeFileSync(join(mem, 'a.md'), '---\nname: "Alpha"\ndescription: first one\ntype: user\n---\nbody');
    writeFileSync(join(mem, 'MEMORY.md'), '- [Alpha](a.md) - hook\n- [Beta](b.md) - other\n');
    writeFileSync(join(mem, 'skip.txt'), 'x');
    writeFileSync(join(repo, 'CLAUDE.md'), 'rules');
    const m = await projectMemory(repo);
    const a = m.memories.find((x) => x.file === 'a.md')!;
    expect(a).toMatchObject({ name: 'Alpha', description: 'first one', type: 'user', index: false });
    expect(m.memories.find((x) => x.file === 'MEMORY.md')!.index).toBe(true);
    expect(m.memories).toHaveLength(2);
    expect(m.instructions.map((x) => x.file)).toEqual(['CLAUDE.md']);
  });

  it('reads and writes only files in the listing', async () => {
    writeFileSync(join(mem, 'a.md'), 'one');
    await writeMemory(repo, join(mem, 'a.md'), 'two');
    expect(await readMemory(repo, join(mem, 'a.md'))).toBe('two');
    await expect(readMemory(repo, '/etc/passwd')).rejects.toThrow(/not part/);
    await expect(writeMemory(repo, join(home, 'x.md'), 'x')).rejects.toThrow();
  });

  it('deletes a memory and its line in the index, but not the index or instructions', async () => {
    writeFileSync(join(mem, 'a.md'), 'one');
    writeFileSync(join(mem, 'MEMORY.md'), '- [Alpha](a.md) - hook\n- [Beta](b.md) - other');
    await deleteMemory(repo, join(mem, 'a.md'));
    expect(existsSync(join(mem, 'a.md'))).toBe(false);
    expect(readFileSync(join(mem, 'MEMORY.md'), 'utf8')).toBe('- [Beta](b.md) - other');
    await expect(deleteMemory(repo, join(mem, 'MEMORY.md'))).rejects.toThrow(/Only memory/);
    writeFileSync(join(repo, 'CLAUDE.md'), 'rules');
    await expect(deleteMemory(repo, join(repo, 'CLAUDE.md'))).rejects.toThrow(/Only memory/);
  });
});

describe('log', () => {
  it('keeps a ring of recent lines and writes them to the file once logging is installed', async () => {
    logLine('info', 'before');
    expect(recentLog().at(-1)).toMatch(/INFO before/);
    const dir = join(home, 'logs');
    mkdirSync(dir);
    const warn = console.warn;
    console.warn = () => undefined;
    await installLogging(dir);
    console.warn('careful', new Error('boom'), { a: 1 });
    console.warn = warn;
    logLine('error', 'two\nlines');
    await new Promise((r) => setTimeout(r, 100));
    expect(logFile()).toBe(join(dir, 'helm.log'));
    const text = readFileSync(logFile(), 'utf8');
    expect(text).toContain('helm started');
    expect(text).toContain('WARN careful');
    expect(text).toContain('ERROR two\n    lines');
    for (let i = 0; i < 450; i++) logLine('info', 'x' + i);
    expect(recentLog().length).toBe(400);
    await flushLog();
  });
});
