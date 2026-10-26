import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ChangesSummary, DiffHunk, FileChange } from '../shared/types';
import { run } from './util';

let token: string | null = null;
export const setGitToken = (t: string | null) => { token = t; };

function env(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    // GIT_CONFIG_PARAMETERS in its 'key=value' form works on every git; GIT_CONFIG_COUNT needs 2.31+.
    const header = 'AUTHORIZATION: basic ' + Buffer.from('x-access-token:' + token).toString('base64');
    e.GIT_CONFIG_PARAMETERS = [e.GIT_CONFIG_PARAMETERS, `'http.https://github.com/.extraheader=${header}'`].filter(Boolean).join(' ');
  }
  return e;
}

export const git = (cwd: string, ...args: string[]) => run('git', ['-c', 'core.quotepath=off', ...args], { cwd, env: env() });
export const gitOk = (cwd: string, ...args: string[]) => git(cwd, ...args).then(() => true, () => false);

export async function clone(url: string, dest: string) {
  await mkdir(dirname(dest), { recursive: true });
  await run('git', ['clone', url, dest], { env: env() });
}

export function parseGithubUrl(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export async function remoteSlug(path: string): Promise<string | null> {
  try {
    return parseGithubUrl(await git(path, 'remote', 'get-url', 'origin'));
  } catch {
    return null;
  }
}

export async function defaultBranch(path: string): Promise<string> {
  try {
    const ref = (await git(path, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).trim();
    return ref.replace(/^origin\//, '');
  } catch {
    for (const b of ['main', 'master']) if (await gitOk(path, 'rev-parse', '--verify', 'origin/' + b)) return b;
    return (await git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  }
}

export async function userIdentity(path?: string): Promise<{ name: string | null; email: string | null }> {
  const get = (k: string) => run('git', ['config', '--get', k], { cwd: path }).then((s) => s.trim() || null, () => null);
  return { name: await get('user.name'), email: await get('user.email') };
}

export async function addWorktree(repoPath: string, wt: string, branch: string, base: string) {
  await mkdir(dirname(wt), { recursive: true });
  await git(repoPath, 'worktree', 'add', wt, '-b', branch, base);
}

export async function removeWorktree(repoPath: string, wt: string, branch?: string) {
  await git(repoPath, 'worktree', 'remove', '--force', wt).catch(() => undefined);
  await git(repoPath, 'worktree', 'prune').catch(() => undefined);
  // git can leave an empty directory behind on Windows
  await rm(wt, { recursive: true, force: true }).catch(() => undefined);
  if (branch) await git(repoPath, 'branch', '-D', branch).catch(() => undefined);
}

export async function mergeBase(wt: string, base: string): Promise<string> {
  return (await git(wt, 'merge-base', 'HEAD', base)).trim();
}

const GENERATED = [/(^|\/)package-lock\.json$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)yarn\.lock$/, /(^|\/)go\.sum$/, /(^|\/)Cargo\.lock$/, /\.min\.(js|css)$/, /(^|\/)openapi\.ya?ml$/, /\.snap$/];
export const isGenerated = (p: string) => GENERATED.some((r) => r.test(p));

async function untracked(wt: string): Promise<string[]> {
  return (await git(wt, 'ls-files', '--others', '--exclude-standard')).split('\n').filter(Boolean);
}

async function lineCount(file: string): Promise<number> {
  try {
    const t = await readFile(file, 'utf8');
    return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0;
  } catch {
    return 0;
  }
}

/** Everything the session changed relative to its base: commits plus uncommitted work. */
export async function changes(wt: string, base: string): Promise<ChangesSummary> {
  const mb = await mergeBase(wt, base).catch(() => base);
  const files: FileChange[] = [];
  const num = await git(wt, 'diff', '--numstat', '-M', mb);
  const names = await git(wt, 'diff', '--name-status', '-M', mb);
  const status = new Map<string, string>();
  for (const l of names.split('\n').filter(Boolean)) {
    const parts = l.split('\t');
    status.set(parts[parts.length - 1], parts[0][0]);
  }
  for (const l of num.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = l.split('\t');
    let path = rest.join('\t');
    const rn = path.match(/^(.*)\{.* => (.*)\}(.*)$/);
    if (rn) path = (rn[1] + rn[2] + rn[3]).replace('//', '/');
    else if (path.includes(' => ')) path = path.split(' => ')[1];
    const binary = a === '-';
    files.push({ path, add: binary ? 0 : +a, del: binary ? 0 : +d, status: (status.get(path) as any) || 'M', generated: isGenerated(path), binary });
  }
  for (const p of await untracked(wt)) files.push({ path: p, add: await lineCount(join(wt, p)), del: 0, status: 'A', generated: isGenerated(p) });
  const log = (await git(wt, 'log', '--format=%h%x09%s', `${mb}..HEAD`)).split('\n').filter(Boolean).map((l) => {
    const [hash, ...m] = l.split('\t');
    return { hash, msg: m.join('\t') };
  });
  const dirty = (await git(wt, 'status', '--porcelain')).split('\n').filter(Boolean).length;
  return { files, base: mb, commits: log, dirty };
}

export function parseDiff(text: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let cur: DiffHunk | null = null;
  let o = 0;
  let n = 0;
  for (const raw of text.split('\n')) {
    const h = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      cur = { header: raw, lines: [] };
      hunks.push(cur);
      o = +h[1];
      n = +h[2];
      continue;
    }
    if (!cur || raw.startsWith('\\')) continue;
    const c = raw[0];
    if (c === '+') cur.lines.push(['+', null, n++, raw.slice(1)]);
    else if (c === '-') cur.lines.push(['-', o++, null, raw.slice(1)]);
    else if (c === ' ') cur.lines.push([' ', o++, n++, raw.slice(1)]);
  }
  return hunks;
}

export async function fileDiff(wt: string, base: string, path: string): Promise<DiffHunk[]> {
  const mb = await mergeBase(wt, base).catch(() => base);
  const tracked = (await gitOk(wt, 'cat-file', '-e', `HEAD:${path}`)) || (await gitOk(wt, 'ls-files', '--error-unmatch', path));
  if (!tracked) {
    const text = await readFile(join(wt, path), 'utf8').catch(() => '');
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.length ? [{ header: `@@ -0,0 +1,${lines.length} @@ new file`, lines: lines.map((t, i) => ['+', null, i + 1, t] as [string, number | null, number | null, string]) }] : [];
  }
  return parseDiff(await git(wt, 'diff', '-U4', '-M', mb, '--', path));
}

export async function dirtyFiles(wt: string): Promise<{ path: string; status: string }[]> {
  const out = await git(wt, 'status', '--porcelain', '-uall');
  return out.split('\n').filter(Boolean).map((l) => {
    const code = l.slice(0, 2);
    const path = l.slice(3).replace(/^.* -> /, '');
    const s = code.includes('?') || code.includes('A') ? 'A' : code.includes('D') ? 'D' : 'M';
    return { path, status: s };
  });
}

export const fileExists = (p: string) => stat(p).then(() => true, () => false);

export async function commitDiff(repo: string, hash: string, path: string): Promise<DiffHunk[]> {
  return parseDiff(await git(repo, 'show', '-U4', '-M', '--format=', hash, '--', path));
}

export async function listFiles(wt: string): Promise<string[]> {
  try {
    const out = await git(wt, 'ls-files', '--cached', '--others', '--exclude-standard');
    return [...new Set(out.split('\n').filter(Boolean))];
  } catch {
    // Not a git folder (a free agent working in a folder of its own): walk it instead.
    const found: string[] = [];
    const stack = [''];
    while (stack.length && found.length < 5000) {
      const dir = stack.pop()!;
      let entries;
      try { entries = await readdir(join(wt, dir), { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (e.name === '.git' || e.name === 'node_modules' || e.isSymbolicLink()) continue;
        const p = dir ? dir + '/' + e.name : e.name;
        if (e.isDirectory()) stack.push(p); else found.push(p);
      }
    }
    return found.sort();
  }
}

/** A new folder for a free agent, with local git and an empty first commit so changes can be shown against it. */
export async function initScratch(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const env = { ...process.env, GIT_AUTHOR_NAME: 'helm', GIT_AUTHOR_EMAIL: 'helm@localhost', GIT_COMMITTER_NAME: 'helm', GIT_COMMITTER_EMAIL: 'helm@localhost' };
  await run('git', ['init', '-q'], { cwd: dir, env });
  await run('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir, env });
  await run('git', ['commit', '-q', '--allow-empty', '-m', 'helm: start of free agent'], { cwd: dir, env });
}

export async function searchFiles(wt: string, query: string, matchCase: boolean): Promise<{ path: string; line: number; text: string }[]> {
  if (!query.trim()) return [];
  const args = ['grep', '-n', '-I', '--no-color', '-F', '--untracked', ...(matchCase ? [] : ['-i']), '-e', query];
  let out = '';
  try { out = await git(wt, ...args); } catch { return []; } // exit code 1 means no matches
  const hits: { path: string; line: number; text: string }[] = [];
  for (const l of out.split('\n')) {
    const m = l.match(/^(.+?):(\d+):(.*)$/);
    if (m) hits.push({ path: m[1], line: +m[2], text: m[3].slice(0, 240) });
    if (hits.length >= 400) break;
  }
  return hits;
}
