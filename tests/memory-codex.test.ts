import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteMemory, memoryDir, projectMemory, readMemory, writeMemory } from '../src/core/memory';

// Codex keeps AGENTS.md in the repository and in CODEX_HOME, and its own notes in CODEX_HOME/memories.
let home: string, repo: string, saved: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'helm-codex-home-'));
  repo = mkdtempSync(join(tmpdir(), 'helm-codex-repo-'));
  saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
});
afterEach(() => {
  if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved;
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('Codex memory and instructions', () => {
  it('finds nothing until Codex has written something', async () => {
    expect(await memoryDir(repo, 'codex')).toBeNull();
    const m = await projectMemory(repo, 'codex');
    expect(m).toEqual({ dir: null, memories: [], instructions: [] });
  });

  it('lists AGENTS.md files and the notes in the memories folder', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), '# Repo rules\nrun tests\n');
    writeFileSync(join(home, 'AGENTS.md'), 'be brief\n');
    mkdirSync(join(home, 'memories'));
    writeFileSync(join(home, 'memories', 'MEMORY.md'), '- the user prefers tabs\n');
    writeFileSync(join(home, 'memories', 'memory_summary.md'), 'summary\n');
    writeFileSync(join(home, 'memories', 'notes.txt'), 'not markdown');
    const m = await projectMemory(repo, 'codex');
    expect(m.instructions.map((e) => e.file)).toEqual(['AGENTS.md', '~/.codex/AGENTS.md']);
    expect(m.memories.map((e) => e.file).sort()).toEqual(['MEMORY.md', 'memory_summary.md']);
    expect(m.memories.find((e) => e.file === 'MEMORY.md')!.index).toBe(true);
    expect(m.dir).toBe(join(home, 'memories'));
  });

  it('reads and edits only the files it lists, and leaves Claude\'s files out', async () => {
    writeFileSync(join(repo, 'AGENTS.md'), 'old');
    writeFileSync(join(repo, 'CLAUDE.md'), 'claude only');
    await writeMemory(repo, join(repo, 'AGENTS.md'), 'new', 'codex');
    expect(await readMemory(repo, join(repo, 'AGENTS.md'), 'codex')).toBe('new');
    await expect(readMemory(repo, join(repo, 'CLAUDE.md'), 'codex')).rejects.toThrow(/not part of/);
    await expect(readMemory(repo, join(repo, 'AGENTS.md'), 'claude')).rejects.toThrow(/not part of/);
  });

  it('does not delete Codex\'s notes: it manages them itself', async () => {
    mkdirSync(join(home, 'memories'));
    writeFileSync(join(home, 'memories', 'raw_memories.md'), 'x');
    await expect(deleteMemory(repo, join(home, 'memories', 'raw_memories.md'), 'codex')).rejects.toThrow(/manages its own memory/);
  });
});
