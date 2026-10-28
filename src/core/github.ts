import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Host } from './host';
import type { Comment, Issue } from '../shared/issues';
import { parseDispatch, type Workflow, type WorkflowRun } from '../shared/workflows';
import type { CheckRun, DeviceCode, GhRepo, PullRequest, User } from '../shared/types';
import type { Commit } from '../shared/automations';
import { logLine } from './log';

const SCOPES = 'repo read:org workflow';
let token: string | null = null;
let pending: { deviceCode: string; interval: number; expiresAt: number; clientId: string } | null = null;

let vault: Pick<Host, 'dataDir' | 'encrypt' | 'decrypt'> = { dataDir: '' };
let ghDir = '';
const tokenFile = () => join(vault.dataDir, 'auth.bin');
export const getToken = () => token;

let guard: ((login: string) => boolean) | null = null;
/** Sets who may sign in (a hosted server's allow list). Null, the default, lets anyone: the desktop app's own user. */
export function setSignInGuard(g: ((login: string) => boolean) | null) { guard = g; }

/** What is kept in auth.bin. Only tokens from an OAuth app with expiring tokens switched on carry a refresh token. */
type Auth = { token: string; refreshToken?: string; expiresAt?: number; refreshExpiresAt?: number; clientId?: string };
let auth: Auth | null = null;
let onChange: (() => void) | null = null;
let onSignedOut: (() => void) | null = null;
/** `change` runs whenever the token is replaced; `signedOut` when GitHub has rejected it and it cannot be renewed. */
export function watchAuth(change: () => void, signedOut: () => void) { onChange = change; onSignedOut = signedOut; }

export async function loadToken(h: Pick<Host, 'dataDir' | 'encrypt' | 'decrypt' | 'ghConfigDir'>): Promise<string | null> {
  vault = h;
  ghDir = h.ghConfigDir || '';
  try {
    const buf = await readFile(tokenFile());
    const raw = vault.decrypt ? vault.decrypt(buf) : buf.toString('utf8');
    // Files written before refresh tokens held the bare token.
    auth = raw.startsWith('{') ? JSON.parse(raw) as Auth : { token: raw };
    token = auth.token;
  } catch { token = null; auth = null; }
  await syncGh();
  return token;
}

const GH_MARK = '# Written by helm. Delete this line to keep your own edits.\n';
/** Keeps the GitHub CLI's `hosts.yml` in step with the sign-in. A file helm did not write is never touched. */
async function syncGh() {
  if (!ghDir) return;
  const file = join(ghDir, 'hosts.yml');
  try {
    const current = await readFile(file, 'utf8').catch(() => '');
    if (current && !current.startsWith(GH_MARK)) return;
    if (!token) { await rm(file, { force: true }); return; }
    await mkdir(ghDir, { recursive: true, mode: 0o700 });
    const tmp = file + '.tmp';
    await writeFile(tmp, `${GH_MARK}github.com:\n    oauth_token: ${JSON.stringify(token)}\n    git_protocol: https\n`, { mode: 0o600 });
    await rename(tmp, file);
  } catch (e: any) { logLine('warn', 'could not update the GitHub CLI sign-in: ' + String(e?.message || e)); }
}

async function saveAuth(a: Auth) {
  auth = a;
  token = a.token;
  const raw = JSON.stringify(a);
  await writeFile(tokenFile(), vault.encrypt ? vault.encrypt(raw) : Buffer.from(raw));
  await syncGh();
  onChange?.();
}

export async function clearToken() {
  token = null;
  auth = null;
  await rm(tokenFile(), { force: true });
  await syncGh();
}

const EARLY = 60_000;
let refreshing: Promise<boolean> | null = null;
/** Trades the refresh token for a new access token. False when there is nothing to refresh with or GitHub refused; a network failure throws. */
function refresh(): Promise<boolean> {
  if (!auth?.refreshToken || !auth.clientId || (auth.refreshExpiresAt && auth.refreshExpiresAt < Date.now())) return Promise.resolve(false);
  const a = auth;
  return refreshing ??= (async () => {
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'helm' },
        body: JSON.stringify({ client_id: a.clientId, grant_type: 'refresh_token', refresh_token: a.refreshToken })
      });
      const j: any = await res.json();
      if (!j.access_token) {
        logLine('warn', `GitHub token refresh refused: ${j.error || res.status}${j.error_description ? ' - ' + j.error_description : ''}`);
        return false;
      }
      await saveAuth(fromGrant(j, a.clientId!));
      logLine('info', `GitHub token refreshed${j.expires_in ? `, valid for ${Math.round(j.expires_in / 3600)}h` : ''}`);
      return true;
    } finally { refreshing = null; }
  })();
}

/** Renews the token when it has expired or is about to. Failures are left for the next request to report. */
export async function ensureFresh(within = EARLY): Promise<void> {
  if (auth?.expiresAt && auth.expiresAt - Date.now() < within) await refresh().catch((e) => logLine('warn', 'GitHub token refresh failed: ' + String(e?.message || e)));
}

function fromGrant(j: any, clientId: string): Auth {
  return {
    token: j.access_token, clientId,
    ...(j.refresh_token ? { refreshToken: j.refresh_token, refreshExpiresAt: j.refresh_token_expires_in ? Date.now() + j.refresh_token_expires_in * 1000 : undefined } : {}),
    ...(j.expires_in ? { expiresAt: Date.now() + j.expires_in * 1000 } : {})
  };
}

/** One line per rejected GitHub call. Records what kind of token was sent, never the token itself. */
function logRejected(method: string, path: string, res: Response, message: string) {
  const kind = !token ? 'none' : token.startsWith('github_pat_') ? 'fine-grained PAT' : token.startsWith('ghp_') ? 'classic PAT' : token.startsWith('gho_') ? 'OAuth' : token.startsWith('ghu_') ? 'app user' : 'unknown';
  const h = (n: string) => res.headers.get(n);
  logLine('warn', `GitHub ${method} ${path.replace(/^https:\/\/api\.github\.com/, '')} -> ${res.status} "${message}" (token: ${kind}, rate remaining: ${h('x-ratelimit-remaining') ?? '?'}, scopes: ${h('x-oauth-scopes') ?? '-'}, needs: ${h('x-accepted-oauth-scopes') ?? '-'}${h('x-github-sso') ? ', SSO required' : ''}, request ${h('x-github-request-id') ?? '?'})`);
}

let probing = false;
async function gh(path: string, init: RequestInit = {}): Promise<any> {
  await ensureFresh();
  const send = () => fetch(path.startsWith('http') ? path : 'https://api.github.com' + path, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'helm', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) }
  });
  let res = await send();
  if (res.status === 401 && token && !probing) {
    logRejected(init.method || 'GET', path, res, 'Bad credentials; trying a refresh');
    if (await refresh().catch(() => false)) res = await send();
    if (res.status === 401) {
      // The token is dead and cannot be renewed: forget it, so the app shows signed out instead of failing on every call.
      await clearToken();
      onSignedOut?.();
      throw new Error('GitHub: your sign-in has expired or was revoked. Sign in again in Settings. (401)');
    }
  }
  if (!res.ok) {
    let msg = res.statusText;
    let detail = '';
    try {
      const j = (await res.json()) as any;
      msg = j.message || msg;
      // A 422 says only "Validation Failed"; the reason is in `errors`.
      if (Array.isArray(j.errors) && j.errors.length) detail = ' [' + j.errors.map((e: any) => typeof e === 'string' ? e : [e.resource, e.field, e.code, e.message].filter(Boolean).join(' ')).join('; ') + ']';
    } catch { /* ignore */ }
    logRejected(init.method || 'GET', path, res, msg + detail);
    throw new Error(`GitHub: ${msg}${detail} (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

export async function startDeviceFlow(clientId: string): Promise<DeviceCode> {
  if (!clientId) throw new Error('No GitHub OAuth client ID is set. Add one below, or paste a personal access token.');
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'helm' },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES })
  });
  const j: any = await res.json();
  if (j.error) throw new Error(j.error_description || j.error);
  pending = { deviceCode: j.device_code, interval: (j.interval || 5) * 1000, expiresAt: Date.now() + j.expires_in * 1000, clientId };
  return { userCode: j.user_code, verificationUri: j.verification_uri, expiresAt: pending.expiresAt };
}

export async function waitDeviceFlow(): Promise<User> {
  if (!pending) throw new Error('Sign-in was not started');
  const p = pending;
  let interval = p.interval;
  while (Date.now() < p.expiresAt) {
    await new Promise((r) => setTimeout(r, interval));
    if (pending !== p) throw new Error('Sign-in was cancelled');
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'helm' },
      body: JSON.stringify({ client_id: p.clientId, device_code: p.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    });
    const j: any = await res.json();
    if (j.access_token) {
      pending = null;
      return acceptToken(j.access_token, fromGrant(j, p.clientId));
    }
    if (j.error === 'slow_down') interval += 5000;
    else if (j.error && j.error !== 'authorization_pending') throw new Error(j.error_description || j.error);
  }
  pending = null;
  throw new Error('The code expired. Start again.');
}

export const signInWithToken = (t: string): Promise<User> => acceptToken(t.trim());

/**
 * Finds out whose token this is, and keeps it only if that person may sign in. The check comes before the token is saved, so someone who is
 * turned away leaves the person already signed in exactly as they were.
 */
async function acceptToken(t: string, grant?: Auth): Promise<User> {
  const prev = { token, auth };
  token = t;
  probing = true;
  try {
    const u = await currentUser();
    if (guard && !guard(u.login)) throw new Error(`@${u.login} is not allowed to use this server.`);
    await saveAuth(grant || { token: t });
    return u;
  } catch (e) {
    token = prev.token; auth = prev.auth;
    throw e;
  } finally { probing = false; }
}

export function cancelDeviceFlow() { pending = null; }

export async function currentUser(): Promise<User> {
  const u = await gh('/user');
  let orgs: string[] = [];
  try { orgs = (await gh('/user/orgs?per_page=100')).map((o: any) => o.login); } catch { /* read:org may be missing */ }
  return { login: u.login, name: u.name, email: u.email, avatar: u.avatar_url, orgs };
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  const d = Math.round(s / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 7) return d + ' days ago';
  if (d < 30) return 'Last week';
  return 'Last month';
}

export async function listRepos(added: Set<string>): Promise<GhRepo[]> {
  const out: GhRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const r: any[] = await gh(`/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member&page=${page}`);
    for (const x of r) out.push({ id: x.full_name, description: x.description, lang: x.language, updated: ago(x.pushed_at || x.updated_at), private: x.private, added: added.has(x.full_name), defaultBranch: x.default_branch });
    if (r.length < 100) break;
  }
  return out;
}

export async function listOwners(): Promise<string[]> {
  const me = await gh('/user');
  const orgs: any[] = await gh('/user/orgs?per_page=100');
  return [me.login, ...orgs.map((o) => o.login)];
}

/** Creates a repository with a README, so it has a branch to start sessions from, under the user or an organisation. */
export async function createRepo(input: { name: string; description: string; private: boolean; owner?: string }): Promise<string> {
  const me = await gh('/user');
  const org = input.owner && input.owner.toLowerCase() !== String(me.login).toLowerCase() ? input.owner : '';
  const x = await gh(org ? `/orgs/${org}/repos` : '/user/repos', { method: 'POST', body: JSON.stringify({ name: input.name, description: input.description || undefined, private: input.private, auto_init: true }), headers: { 'Content-Type': 'application/json' } });
  return x.full_name;
}

export async function repoInfo(slug: string): Promise<{ private: boolean; lang: string | null; defaultBranch: string }> {
  const x = await gh(`/repos/${slug}`);
  return { private: x.private, lang: x.language, defaultBranch: x.default_branch };
}

export async function createPull(slug: string, input: { head: string; base: string; title: string; body: string; draft: boolean }): Promise<string> {
  const x = await gh(`/repos/${slug}/pulls`, { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } });
  return x.html_url;
}

export async function mergePull(slug: string, number: number, method: string): Promise<void> {
  await gh(`/repos/${slug}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: method }), headers: { 'Content-Type': 'application/json' } });
}

export async function deleteBranch(slug: string, branch: string): Promise<void> {
  await gh(`/repos/${slug}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' });
}

export async function listPulls(slug: string): Promise<PullRequest[]> {
  const r: any[] = await gh(`/repos/${slug}/pulls?state=all&per_page=30&sort=updated&direction=desc`);
  return Promise.all(r.map(async (p) => {
    let checks: PullRequest['checks'] = 'none';
    let checkRuns: CheckRun[] | undefined;
    if (p.state === 'open') {
      try {
        const c = await gh(`/repos/${slug}/commits/${p.head.sha}/check-runs?per_page=50`);
        const runs: any[] = c.check_runs || [];
        if (runs.length) checks = runs.some((x) => x.status !== 'completed') ? 'pending' : runs.every((x) => ['success', 'neutral', 'skipped'].includes(x.conclusion)) ? 'passing' : 'failing';
        checkRuns = runs.map((x) => ({ name: String(x.name), state: x.status !== 'completed' ? 'pending' : x.conclusion === 'skipped' ? 'skipped' : ['success', 'neutral'].includes(x.conclusion) ? 'passing' : 'failing', url: String(x.html_url || x.details_url || `${p.html_url}/checks`) }));
      } catch { /* ignore */ }
    }
    return { number: p.number, title: p.title, branch: p.head.ref, base: p.base.ref, state: p.merged_at ? 'merged' : p.state, draft: p.draft, url: p.html_url, checks, checkRuns } as PullRequest;
  }));
}

export async function listIssues(slug: string): Promise<Issue[]> {
  const r: any[] = await gh(`/repos/${slug}/issues?state=open&per_page=50&sort=updated&direction=desc`);
  return r.filter((x) => !x.pull_request).map((x) => ({
    number: x.number, title: x.title, body: x.body || '', url: x.html_url, labels: (x.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name)).filter(Boolean),
    author: x.user?.login || '', comments: x.comments || 0, updated: x.updated_at
  }));
}

export async function getIssue(slug: string, number: number): Promise<Issue> {
  const x = await gh(`/repos/${slug}/issues/${number}`);
  return { number: x.number, title: x.title, body: x.body || '', url: x.html_url, labels: (x.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name)).filter(Boolean), author: x.user?.login || '', comments: x.comments || 0, updated: x.updated_at };
}

/** Comments on an issue or a pull request's conversation. */
export async function issueComments(slug: string, number: number): Promise<Comment[]> {
  const r: any[] = await gh(`/repos/${slug}/issues/${number}/comments?per_page=50`);
  return r.map((c) => ({ author: c.user?.login || '', body: c.body || '', at: c.created_at }));
}

/** Comments left on a pull request's diff, and the bodies of reviews that asked for changes or commented. */
export async function pullReviewComments(slug: string, number: number): Promise<Comment[]> {
  const [inline, reviews] = await Promise.all([
    gh(`/repos/${slug}/pulls/${number}/comments?per_page=100`) as Promise<any[]>,
    gh(`/repos/${slug}/pulls/${number}/reviews?per_page=50`) as Promise<any[]>
  ]);
  const out: Comment[] = inline.map((c) => ({ author: c.user?.login || '', body: c.body || '', path: c.path, line: c.line ?? c.original_line ?? undefined, at: c.created_at }));
  for (const r of reviews) if ((r.body || '').trim() && r.state !== 'PENDING') out.push({ author: r.user?.login || '', body: r.body, at: r.submitted_at || '' });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------- actions
async function ghText(path: string): Promise<string> {
  await ensureFresh();
  const res = await fetch('https://api.github.com' + path, { headers: { Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'helm', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  if (!res.ok) { logRejected('GET', path, res, res.statusText); throw new Error(`GitHub: ${res.statusText} (${res.status})`); }
  return res.text();
}

/** The repository's active workflows, each marked with whether it can be started by hand and what inputs it takes (read from the file on `ref`). */
export async function listWorkflows(slug: string, ref: string): Promise<Workflow[]> {
  const r = await gh(`/repos/${slug}/actions/workflows?per_page=100`);
  const active: any[] = (r.workflows || []).filter((w: any) => w.state === 'active');
  return Promise.all(active.map(async (w) => {
    let d: { dispatchable: boolean; inputs: Workflow['inputs'] } = { dispatchable: false, inputs: [] };
    try { d = parseDispatch(await ghText(`/repos/${slug}/contents/${w.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`)); }
    catch { /* the file may not exist on this branch: it cannot be dispatched there */ }
    return { id: w.id, name: w.name, path: w.path, state: w.state, url: w.html_url, ...d };
  }));
}

export async function dispatchWorkflow(slug: string, id: number, ref: string, inputs: Record<string, string>): Promise<void> {
  await gh(`/repos/${slug}/actions/workflows/${id}/dispatches`, { method: 'POST', body: JSON.stringify({ ref, ...(Object.keys(inputs).length ? { inputs } : {}) }), headers: { 'Content-Type': 'application/json' } });
}

export async function listRuns(slug: string, id: number, limit = 6): Promise<WorkflowRun[]> {
  const r = await gh(`/repos/${slug}/actions/workflows/${id}/runs?per_page=${limit}`);
  return (r.workflow_runs || []).map((x: any): WorkflowRun => ({ id: x.id, number: x.run_number, title: x.display_title || x.name || '', status: x.status, conclusion: x.conclusion, branch: x.head_branch || '', event: x.event, actor: x.triggering_actor?.login || x.actor?.login || '', url: x.html_url, at: x.created_at }));
}

/** The latest commits on a branch, newest first. */
export async function listBranchCommits(slug: string, branch: string, limit = 30): Promise<Commit[]> {
  const r = await gh(`/repos/${slug}/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}`);
  return (Array.isArray(r) ? r : []).map((x: any): Commit => ({ sha: x.sha, message: x.commit?.message || '', author: x.author?.login || x.commit?.author?.name || '', url: x.html_url }));
}

/** The repository's most recent finished runs across all workflows, newest first. */
export async function listFinishedRuns(slug: string, limit = 30): Promise<WorkflowRun[]> {
  const r = await gh(`/repos/${slug}/actions/runs?status=completed&per_page=${limit}`);
  return (r.workflow_runs || []).map((x: any): WorkflowRun => ({ id: x.id, number: x.run_number, title: `${x.name || 'workflow'}: ${x.display_title || ''}`.replace(/: $/, ''), status: x.status, conclusion: x.conclusion, branch: x.head_branch || '', event: x.event, actor: x.triggering_actor?.login || x.actor?.login || '', url: x.html_url, at: x.created_at }));
}

export async function getPullBody(slug: string, number: number): Promise<string> {
  const x = await gh(`/repos/${slug}/pulls/${number}`);
  return x.body || '';
}

export async function updatePullBody(slug: string, number: number, body: string): Promise<void> {
  await gh(`/repos/${slug}/pulls/${number}`, { method: 'PATCH', body: JSON.stringify({ body }), headers: { 'Content-Type': 'application/json' } });
}

/** Every review left on a pull request, oldest first, with the verdict it gave. */
export async function pullReviews(slug: string, number: number): Promise<{ user: string; state: string }[]> {
  const r: any[] = await gh(`/repos/${slug}/pulls/${number}/reviews?per_page=100`);
  return r.map((x) => ({ user: x.user?.login || '', state: String(x.state || '') }));
}
