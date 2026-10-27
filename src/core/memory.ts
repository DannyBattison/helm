import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { ProjectMemory, MemoryEntry } from '../shared/types';

/** Which agent's notes and instructions: Claude Code's (CLAUDE.md, a memory folder per project) or Codex's (AGENTS.md, one memory folder for you). */
export type MemoryAgent = 'claude' | 'codex';

/** Codex keeps everything under CODEX_HOME, `~/.codex` unless that is set. */
export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

/** Claude Code keeps a project's notes under ~/.claude/projects/<path with every non-alphanumeric turned into a dash>/memory. */
export async function memoryDir(repoPath: string, agent: MemoryAgent = 'claude'): Promise<string | null> {
  // Codex writes what it learns to one folder for all projects, once it has learned anything.
  if (agent === 'codex') { const d = join(codexHome(), 'memories'); return existsSync(d) ? d : null; }
  const root = join(homedir(), '.claude', 'projects');
  const want = resolve(repoPath).replace(/[^a-zA-Z0-9]/g, '-');
  let names: string[];
  try { names = await readdir(root); } catch { return null; }
  const hit = names.find((n) => n === want) || names.find((n) => n.toLowerCase() === want.toLowerCase());
  return hit ? join(root, hit, 'memory') : null;
}

/** The small `---` header Claude puts on each memory: name, description and type. */
function frontmatter(text: string): { name?: string; description?: string; type?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const k = /^\s{0,2}(name|description|type):\s*(.*)$/.exec(line);
    if (k) out[k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

async function entry(kind: MemoryEntry['kind'], path: string, label: string): Promise<MemoryEntry | null> {
  try {
    const [st, text] = await Promise.all([stat(path), readFile(path, 'utf8')]);
    const fm = kind === 'memory' ? frontmatter(text) : {};
    return { kind, path, file: label, name: fm.name || label.replace(/\.md$/, ''), description: fm.description || '', type: fm.type || '', modified: st.mtimeMs, size: st.size, index: label === 'MEMORY.md' };
  } catch { return null; }
}

export async function projectMemory(repoPath: string, agent: MemoryAgent = 'claude'): Promise<ProjectMemory> {
  const dir = await memoryDir(repoPath, agent);
  const memories: MemoryEntry[] = [];
  if (dir && existsSync(dir)) {
    for (const f of (await readdir(dir)).filter((n) => n.endsWith('.md'))) {
      const e = await entry('memory', join(dir, f), f);
      if (e) memories.push(e);
    }
  }
  const candidates: [string, string][] = agent === 'codex' ? [
    [join(repoPath, 'AGENTS.md'), 'AGENTS.md'],
    [join(repoPath, 'AGENTS.override.md'), 'AGENTS.override.md'],
    [join(codexHome(), 'AGENTS.md'), '~/.codex/AGENTS.md'],
    [join(codexHome(), 'AGENTS.override.md'), '~/.codex/AGENTS.override.md']
  ] : [
    [join(repoPath, 'CLAUDE.md'), 'CLAUDE.md'],
    [join(repoPath, 'CLAUDE.local.md'), 'CLAUDE.local.md'],
    [join(repoPath, '.claude', 'CLAUDE.md'), '.claude/CLAUDE.md'],
    [join(homedir(), '.claude', 'CLAUDE.md'), '~/.claude/CLAUDE.md']
  ];
  const instructions = (await Promise.all(candidates.map(([p, l]) => entry('instructions', p, l)))).filter(Boolean) as MemoryEntry[];
  return { dir, memories, instructions };
}

/** Only files the listing itself offers can be read, written or deleted, so a path from the renderer cannot reach anything else. */
async function allowed(repoPath: string, path: string, agent: MemoryAgent): Promise<MemoryEntry> {
  const m = await projectMemory(repoPath, agent);
  const e = [...m.memories, ...m.instructions].find((x) => x.path === path);
  if (!e) throw new Error('That file is not part of this project\'s memory.');
  return e;
}

export async function readMemory(repoPath: string, path: string, agent: MemoryAgent = 'claude'): Promise<string> {
  return readFile((await allowed(repoPath, path, agent)).path, 'utf8');
}

export async function writeMemory(repoPath: string, path: string, text: string, agent: MemoryAgent = 'claude'): Promise<void> {
  await writeFile((await allowed(repoPath, path, agent)).path, text, 'utf8');
}

export async function deleteMemory(repoPath: string, path: string, agent: MemoryAgent = 'claude'): Promise<void> {
  // Codex keeps its notes in a database as well as files, so deleting a file here would only put the two out of step.
  if (agent === 'codex') throw new Error('Codex manages its own memory; edit it, or turn it off in Codex\'s settings.');
  const e = await allowed(repoPath, path, agent);
  if (e.kind !== 'memory' || e.index) throw new Error('Only memory files can be deleted here.');
  await rm(e.path);
  // Take its line out of the index, so the index does not point at nothing.
  const dir = await memoryDir(repoPath, agent);
  const idx = dir && join(dir, 'MEMORY.md');
  if (idx && existsSync(idx)) {
    const base = e.path.split(/[\/]/).pop()!;
    const text = await readFile(idx, 'utf8');
    await writeFile(idx, text.split('\n').filter((l) => !l.includes(`(${base})`)).join('\n'), 'utf8');
  }
}

const NOTES = '## Learned in helm';

/**
 * Adds a line to the "Learned in helm" list at the end of an instructions file, making the file and the list if they do not
 * exist. A line that is already there is not added twice. Returns whether anything was written.
 */
export async function appendInstruction(file: string, line: string): Promise<boolean> {
  const bullet = '- ' + line.replace(/\s*\n\s*/g, ' ').trim();
  if (bullet.length < 3) throw new Error('There is nothing to add.');
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch { /* new file */ }
  const lines = text.split(/\r?\n/);
  if (lines.some((l) => l.trim() === bullet)) return false;
  const at = lines.findIndex((l) => l.trim() === NOTES);
  if (at < 0) {
    text = (text.replace(/\s+$/, '') + (text.trim() ? '\n\n' : '') + `${NOTES}\n\n${bullet}\n`);
  } else {
    let end = lines.length;
    for (let i = at + 1; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) { end = i; break; }
    // Insert after the last non-blank line of the section.
    let last = end - 1;
    while (last > at && !lines[last].trim()) last--;
    lines.splice(last + 1, 0, bullet);
    text = lines.join('\n');
    if (!text.endsWith('\n')) text += '\n';
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return true;
}
