import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Settings } from '../shared/types';
import type { Store } from './store';

/**
 * Moving helm to another machine or server: everything it knows (repositories, sessions, transcripts, usage, settings, uploaded
 * artifacts) as one JSON file. Sign-ins and passwords are not in it: they live in `*.bin` files and `user`, which are never read here.
 */
export const EXPORT_FORMAT = 'helm-export';
export const EXPORT_VERSION = 1;

/** Settings that describe the machine they were set on, so an import keeps the destination's own. */
const MACHINE_SETTINGS: (keyof Settings)[] = ['claudePath', 'worktreeRoot', 'freeRoot', 'cloneRoot', 'terminalShell', 'terminalShellCustom', 'companionEnabled', 'companionUrl', 'githubClientId', 'tray', 'autoUpdate'];
/** State kept as lists of records without an id of their own. */
const LISTS = ['usage', 'audit', 'daily'] as const;
/** Folders and files in the data directory that belong in an export. Caches, logs and `*.bin` secrets do not. */
const FOLDERS = ['transcripts', 'repo-artifacts'];
const FILES = ['activity.jsonl', 'activity.old.jsonl'];
const TEXT = /\.(json|jsonl|md|txt|csv|yml|yaml)$/i;

interface FileEntry { enc: 'utf8' | 'base64'; data: string }
export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  state: Record<string, unknown>;
  /** Paths relative to the data directory, with forward slashes. */
  files: Record<string, FileEntry>;
}
export interface ImportResult { repos: number; sessions: number; files: number }

async function walk(root: string, rel: string, out: string[]) {
  for (const e of await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const p = rel + '/' + e.name;
    if (e.isDirectory()) await walk(root, p, out);
    else if (e.isFile() && !e.name.endsWith('.tmp')) out.push(p);
  }
}

export async function buildExport(store: Store): Promise<string> {
  await store.flushAll();
  const { user: _user, ...state } = store.data;
  const names: string[] = FILES.filter((f) => existsSync(join(store.root, f)));
  for (const f of FOLDERS) await walk(store.root, f, names);
  const files: Record<string, FileEntry> = {};
  for (const n of names) {
    const buf = await readFile(join(store.root, n)).catch(() => null);
    if (buf) files[n] = TEXT.test(n) ? { enc: 'utf8', data: buf.toString('utf8') } : { enc: 'base64', data: buf.toString('base64') };
  }
  const bundle: ExportBundle = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: Date.now(), state, files };
  return JSON.stringify(bundle);
}

export function parseExport(text: string): ExportBundle {
  let b: any;
  try { b = JSON.parse(text); } catch { throw new Error('That is not a helm export file.'); }
  if (!b || b.format !== EXPORT_FORMAT || typeof b.state !== 'object' || !b.state || typeof b.files !== 'object' || !b.files) throw new Error('That is not a helm export file.');
  if (typeof b.version !== 'number' || b.version > EXPORT_VERSION) throw new Error('This export was made by a newer version of helm. Update helm and try again.');
  return b as ExportBundle;
}

/** A path from the file that stays inside the data directory and under one of the folders above. */
function target(root: string, name: string): string | null {
  if (typeof name !== 'string' || name.includes('\0') || name.includes('\\')) return null;
  const top = name.split('/')[0];
  if (!(FOLDERS.includes(top) || FILES.includes(name))) return null;
  if (name.split('/').some((x) => x === '..' || x === '' || x === '.')) return null;
  const full = resolve(root, name);
  return full.startsWith(resolve(root) + sep) ? full : null;
}

const key = (x: unknown) => JSON.stringify(x);

/**
 * Adds an export to what is here. Nothing already here is replaced or removed: repositories, sessions and automated agents whose id exists
 * stay as they are, and files already on disk are kept. Machine-specific settings stay too. Sessions come in stopped, and flagged as having
 * no worktree here when the folder is not on this machine.
 */
export async function applyImport(store: Store, text: string): Promise<ImportResult> {
  const b = parseExport(text);
  const d = store.data;
  const inc = b.state as any;
  const result: ImportResult = { repos: 0, sessions: 0, files: 0 };

  const have = new Set(d.repos.map((r) => r.id));
  for (const r of Array.isArray(inc.repos) ? inc.repos : []) if (r?.id && !have.has(r.id)) { d.repos.push(r); have.add(r.id); result.repos++; }

  const known = new Set(d.sessions.map((s) => s.id));
  for (const s of Array.isArray(inc.sessions) ? inc.sessions : []) {
    if (!s?.id || known.has(s.id)) continue;
    s.subagents ||= [];
    for (const a of s.subagents) if (a.status === 'working') { a.status = 'stopped'; a.endedAt = a.endedAt ?? Date.now(); }
    if (s.status === 'working' || s.status === 'attention') { s.status = 'idle'; s.step = 'Imported'; s.ask = undefined; s.queued = undefined; }
    if (!s.worktreeGone && s.worktree && !existsSync(s.worktree) && !(s.free && !s.free.managed)) s.worktreeGone = true;
    d.sessions.push(s); known.add(s.id); result.sessions++;
  }

  const agents = new Set(d.automations.map((a) => a.id));
  for (const a of Array.isArray(inc.automations) ? inc.automations : []) if (a?.id && !agents.has(a.id)) { d.automations.push(a); agents.add(a.id); }

  for (const k of LISTS) {
    const mine = d[k] as unknown[], seen = new Set(mine.map(key));
    for (const x of Array.isArray(inc[k]) ? inc[k] : []) if (!seen.has(key(x))) mine.push(x);
  }
  d.usage.sort((a, b) => a.t - b.t);
  d.daily.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const k of ['totals', 'extArchive', 'automationSeen'] as const) d[k] = { ...(inc[k] || {}), ...d[k] } as any;

  if (inc.settings && typeof inc.settings === 'object') {
    const mine = d.settings as any;
    const keep = Object.fromEntries(MACHINE_SETTINGS.map((k) => [k, mine[k]]));
    d.settings = { ...mine, ...inc.settings, ...keep };
  }

  for (const [name, f] of Object.entries(b.files)) {
    const dest = target(store.root, name);
    if (!dest || !f || typeof f.data !== 'string' || existsSync(dest)) continue;
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.enc === 'base64' ? Buffer.from(f.data, 'base64') : f.data);
    result.files++;
  }
  store.forgetTranscripts();
  await store.flush();
  return result;
}
