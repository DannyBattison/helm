import { app, safeStorage } from 'electron';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeviceCode, GhRepo, PullRequest, User } from '../shared/types';

const SCOPES = 'repo read:org workflow';
let token: string | null = null;
let pending: { deviceCode: string; interval: number; expiresAt: number; clientId: string } | null = null;

const tokenFile = () => join(app.getPath('userData'), 'auth.bin');
export const getToken = () => token;

export async function loadToken(): Promise<string | null> {
  try {
    const buf = await readFile(tokenFile());
    token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch { token = null; }
  return token;
}

async function saveToken(t: string) {
  token = t;
  await writeFile(tokenFile(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(t) : Buffer.from(t));
}

export async function clearToken() {
  token = null;
  await rm(tokenFile(), { force: true });
}

async function gh(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(path.startsWith('http') ? path : 'https://api.github.com' + path, {
    ...init,
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'helm', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) }
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as any).message || msg; } catch { /* ignore */ }
    throw new Error(`GitHub: ${msg} (${res.status})`);
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
      await saveToken(j.access_token);
      return currentUser();
    }
    if (j.error === 'slow_down') interval += 5000;
    else if (j.error && j.error !== 'authorization_pending') throw new Error(j.error_description || j.error);
  }
  pending = null;
  throw new Error('The code expired. Start again.');
}

export async function signInWithToken(t: string): Promise<User> {
  const prev = token;
  token = t.trim();
  try {
    const u = await currentUser();
    await saveToken(token);
    return u;
  } catch (e) {
    token = prev;
    throw e;
  }
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
    if (p.state === 'open') {
      try {
        const c = await gh(`/repos/${slug}/commits/${p.head.sha}/check-runs?per_page=50`);
        const runs: any[] = c.check_runs || [];
        if (runs.length) checks = runs.some((x) => x.status !== 'completed') ? 'pending' : runs.every((x) => ['success', 'neutral', 'skipped'].includes(x.conclusion)) ? 'passing' : 'failing';
      } catch { /* ignore */ }
    }
    return { number: p.number, title: p.title, branch: p.head.ref, base: p.base.ref, state: p.merged_at ? 'merged' : p.state, draft: p.draft, url: p.html_url, checks } as PullRequest;
  }));
}
