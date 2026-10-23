import { mkdir, readdir } from 'node:fs/promises';
import { basename, join, normalize } from 'node:path';
import type { FileChange, HistoryCommit, Repo, Session, WorktreeInfo } from '../shared/types';
import * as G from './git';
import * as GH from './github';
import type { Store } from './store';
import { expandHome } from './util';

export class RepoService {
  constructor(private store: Store, private changed: () => void) {}

  private get repos() { return this.store.data.repos; }
  find = (id: string) => this.repos.find((r) => r.id === id);
  must(id: string): Repo {
    const r = this.find(id);
    if (!r) throw new Error('Repository not found: ' + id);
    return r;
  }

  async addFromPath(path: string): Promise<Repo> {
    const slug = await G.remoteSlug(path);
    if (!slug) throw new Error('This folder has no GitHub remote. Push it to GitHub first.');
    const existing = this.find(slug);
    if (existing) return existing;
    const [owner, name] = slug.split('/');
    let info = { private: true, lang: null as string | null, defaultBranch: '' };
    try { info = await GH.repoInfo(slug); } catch { info.defaultBranch = await G.defaultBranch(path); }
    const repo: Repo = { id: slug, owner, name, private: info.private, lang: info.lang, defaultBranch: info.defaultBranch || (await G.defaultBranch(path)), localPath: path, cap: 25, addedAt: Date.now() };
    this.repos.push(repo);
    this.store.save();
    this.changed();
    return repo;
  }

  async cloneSlug(slug: string): Promise<Repo> {
    if (this.find(slug)) return this.find(slug)!;
    const [owner, name] = slug.split('/');
    const dest = join(expandHome(this.store.data.settings.cloneRoot), owner, name);
    if (!(await G.fileExists(join(dest, '.git')))) await G.clone(`https://github.com/${slug}.git`, dest);
    return this.addFromPath(dest);
  }

  async cloneUrl(url: string, dir: string): Promise<Repo> {
    const slug = G.parseGithubUrl(url);
    if (!slug) throw new Error('That is not a GitHub URL.');
    const dest = join(expandHome(dir), slug.split('/')[1]);
    if (!(await G.fileExists(join(dest, '.git')))) await G.clone(url.startsWith('git@') ? url : `https://github.com/${slug}.git`, dest);
    return this.addFromPath(dest);
  }

  async inspect(path: string) {
    const p = expandHome(path);
    const checks: { ok: boolean; warn?: boolean; text: string }[] = [];
    if (!(await G.gitOk(p, 'rev-parse', '--git-dir'))) return { ok: false, checks: [{ ok: false, text: 'Not a Git repository' }] };
    checks.push({ ok: true, text: 'Git repository' });
    const slug = await G.remoteSlug(p);
    if (!slug) return { ok: false, checks: [...checks, { ok: false, text: 'No remote origin on github.com' }] };
    checks.push({ ok: true, text: `Remote origin → github.com/${slug}` });
    const dirty = (await G.git(p, 'status', '--porcelain')).split('\n').filter(Boolean).length;
    if (dirty) {
      const b = (await G.git(p, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
      checks.push({ ok: true, warn: true, text: `${dirty} uncommitted ${dirty === 1 ? 'file' : 'files'} on ${b}. Sessions branch from origin, so these stay put.` });
    }
    return { ok: true, checks, id: slug };
  }

  async remove(id: string) {
    const i = this.repos.findIndex((r) => r.id === id);
    if (i >= 0) this.repos.splice(i, 1);
    this.store.save();
    this.changed();
  }

  async fetch(id: string) {
    await G.git(this.must(id).localPath, 'fetch', 'origin', '--prune');
  }

  async branches(id: string): Promise<string[]> {
    const r = this.must(id);
    const out = await G.git(r.localPath, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin').catch(() => '');
    const names = out.split('\n').map((x) => x.replace(/^origin\//, '').trim()).filter((x) => x && x !== 'HEAD' && x !== 'origin');
    const set = new Set([r.defaultBranch, ...names]);
    return [...set];
  }

  async history(id: string, sessions: Session[]): Promise<HistoryCommit[]> {
    const r = this.must(id);
    const SEP = '\x1e', F = '\x1f';
    const raw = await G.git(r.localPath, 'log', '--all', '--topo-order', '-n', '120', '--shortstat', `--format=${SEP}%H${F}%P${F}%an${F}%ct${F}%D${F}%s${F}%b`);
    const entries = raw.split(SEP).filter((x) => x.trim());
    const commits: HistoryCommit[] = [];
    for (const e of entries) {
      const [hash, parents, who, ct, refs, msg, rest] = e.split(F);
      const body = rest ?? '';
      const stat = body.match(/(\d+) insertions?\(\+\)/);
      const stat2 = body.match(/(\d+) deletions?\(-\)/);
      const trailer = body.match(/Co-authored-by: helm session ([\w-]+)/i);
      commits.push({
        hash, parents: parents ? parents.split(' ') : [], lane: 0, kind: 'main', msg, who, agent: !!trailer, sessionId: trailer?.[1],
        refs: refs ? refs.split(', ').map((x) => x.replace(/^HEAD -> /, '').replace(/^tag: /, '')).filter((x) => x && x !== 'HEAD') : [],
        at: +ct * 1000, add: stat ? +stat[1] : 0, del: stat2 ? +stat2[1] : 0
      });
    }
    const byHash = new Map(commits.map((c) => [c.hash, c]));

    // lanes
    const active: (string | null)[] = [];
    for (const c of commits) {
      let lane = active.indexOf(c.hash);
      if (lane < 0) { lane = active.indexOf(null); if (lane < 0) lane = active.length; }
      for (let i = 0; i < active.length; i++) if (active[i] === c.hash) active[i] = null;
      c.lane = lane;
      c.parents.forEach((p, i) => {
        if (active.includes(p)) return;
        if (i === 0) active[lane] = p;
        else { let l = active.indexOf(null); if (l < 0) l = active.length; active[l] = p; }
      });
    }

    // kinds: the default branch's first-parent chain is main; agent branches take their session's status
    const def = commits.find((c) => c.refs.includes('origin/' + r.defaultBranch)) || commits.find((c) => c.refs.includes(r.defaultBranch));
    const claimed = new Set<string>();
    const claim = (start: HistoryCommit | undefined, kind: HistoryCommit['kind']) => {
      let cur = start;
      while (cur && !claimed.has(cur.hash)) {
        claimed.add(cur.hash);
        cur.kind = kind;
        cur = cur.parents[0] ? byHash.get(cur.parents[0]) : undefined;
      }
    };
    claim(def, 'main');
    const prefix = this.store.data.settings.branchPrefix;
    for (const c of commits) {
      for (const ref of c.refs) {
        const name = ref.replace(/^origin\//, '');
        if (!name.startsWith(prefix)) continue;
        const s = sessions.find((x) => x.repoId === id && x.branch === name);
        claim(c, s ? s.status === 'error' ? 'idle' : s.status : 'idle');
        if (s) c.sessionId = c.sessionId || s.id;
      }
    }
    for (const c of commits) if (!claimed.has(c.hash)) c.kind = 'idle';
    for (const c of commits) {
      if (c.kind !== 'main' && c.kind !== 'idle') c.agent = true;
      const s = c.sessionId ? sessions.find((x) => x.id === c.sessionId) : undefined;
      if (s) c.who = s.id;
    }
    return commits;
  }

  async commitFiles(id: string, hash: string): Promise<FileChange[]> {
    const r = this.must(id);
    const out = await G.git(r.localPath, 'show', '--numstat', '--format=', hash);
    return out.split('\n').filter(Boolean).map((l) => {
      const [a, d, ...p] = l.split('\t');
      return { path: p.join('\t'), add: a === '-' ? 0 : +a, del: d === '-' ? 0 : +d, status: 'M' as const };
    });
  }

  async worktrees(id: string, sessions: Session[]): Promise<WorktreeInfo[]> {
    const r = this.must(id);
    const out = await G.git(r.localPath, 'worktree', 'list', '--porcelain');
    const list: { path: string; branch: string }[] = [];
    let cur: any = null;
    for (const l of out.split('\n')) {
      if (l.startsWith('worktree ')) { cur = { path: l.slice(9), branch: '' }; list.push(cur); }
      else if (l.startsWith('branch ') && cur) cur.branch = l.slice(7).replace('refs/heads/', '');
    }
    const baseRef = (await G.gitOk(r.localPath, 'rev-parse', '--verify', 'origin/' + r.defaultBranch)) ? 'origin/' + r.defaultBranch : r.defaultBranch;
    const norm = (p: string) => normalize(p).toLowerCase();
    return Promise.all(list.filter((w) => w.branch).map(async (w) => {
      let ahead = 0, behind = 0;
      try {
        const [b, a] = (await G.git(r.localPath, 'rev-list', '--left-right', '--count', `${baseRef}...${w.branch}`)).trim().split(/\s+/);
        ahead = +a; behind = +b;
      } catch { /* detached */ }
      const dirty = (await G.git(w.path, 'status', '--porcelain').catch(() => '')).split('\n').filter(Boolean).length;
      const s = sessions.find((x) => x.repoId === id && norm(x.worktree) === norm(w.path));
      return { branch: w.branch, path: w.path, sessionId: s?.id ?? null, ahead, behind, dirty, main: norm(w.path) === norm(r.localPath) };
    }));
  }

  async tree(wt: string, dir: string) {
    const abs = join(wt, dir);
    const entries = await readdir(abs, { withFileTypes: true });
    const status = new Map<string, string>();
    for (const f of await G.dirtyFiles(wt).catch(() => [])) status.set(f.path, f.status);
    return entries
      .filter((e) => e.name !== '.git' && e.name !== 'node_modules')
      .map((e) => {
        const p = (dir ? dir + '/' : '') + e.name;
        let git = status.get(p);
        if (!git && e.isDirectory()) for (const k of status.keys()) if (k.startsWith(p + '/')) { git = 'M'; break; }
        return { name: e.name, path: p, dir: e.isDirectory(), git };
      })
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  }

  async ensureDir(p: string) { await mkdir(p, { recursive: true }); }
  folderName = (p: string) => basename(p);
}
