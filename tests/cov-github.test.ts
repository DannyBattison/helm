import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

type Route = [RegExp, (url: string, init: any) => Response | Promise<Response>];
let calls: { url: string; init: any }[] = [];
function stub(routes: Route[]) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return json(404, { message: 'Not Found' });
  }));
}

describe('github device flow, errors and listings', () => {
  let GH: typeof import('../src/core/github');
  beforeEach(async () => {
    vi.resetModules();
    GH = await import('../src/core/github');
    await GH.loadToken({ dataDir: await mkdtemp(join(tmpdir(), 'helm-covgh-api-')) });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('refuses to start without a client id, and surfaces GitHub errors', async () => {
    await expect(GH.startDeviceFlow('')).rejects.toThrow(/No GitHub OAuth client ID/);
    stub([[/device\/code/, () => json(200, { error: 'bad', error_description: 'Nope' })]]);
    await expect(GH.startDeviceFlow('cid')).rejects.toThrow('Nope');
    stub([[/device\/code/, () => json(200, { error: 'bad' })]]);
    await expect(GH.startDeviceFlow('cid')).rejects.toThrow('bad');
  });

  it('waiting without a started flow fails', async () => {
    await expect(GH.waitDeviceFlow()).rejects.toThrow('Sign-in was not started');
  });

  it('polls through pending and slow_down, then signs in', async () => {
    vi.useFakeTimers();
    const answers = [{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'gho_x' }];
    stub([
      [/device\/code/, () => json(200, { device_code: 'dc', user_code: 'UC', verification_uri: 'https://v', expires_in: 900 })],
      [/oauth\/access_token/, () => json(200, answers.shift())],
      [/\/user\/orgs/, () => json(200, [])],
      [/\/user$/, () => json(200, { login: 'me' })]
    ]);
    const code = await GH.startDeviceFlow('cid');
    expect(code).toMatchObject({ userCode: 'UC', verificationUri: 'https://v' });
    const p = GH.waitDeviceFlow();
    await vi.advanceTimersByTimeAsync(5000 + 10000 + 10000);
    await expect(p).resolves.toMatchObject({ login: 'me' });
    expect(GH.getToken()).toBe('gho_x');
    expect(JSON.parse(calls.find((c) => /oauth\/access_token/.test(c.url))!.init.body)).toMatchObject({ client_id: 'cid', device_code: 'dc' });
  });

  it('stops on a hard error, on cancel, and on expiry', async () => {
    vi.useFakeTimers();
    const start = (expires = 900) => stub([
      [/device\/code/, () => json(200, { device_code: 'dc', user_code: 'UC', verification_uri: 'v', expires_in: expires, interval: 1 })],
      [/oauth\/access_token/, () => json(200, { error: 'access_denied', error_description: 'Denied' })]
    ]);
    start();
    await GH.startDeviceFlow('cid');
    const denied = GH.waitDeviceFlow();
    const d = expect(denied).rejects.toThrow('Denied');
    await vi.advanceTimersByTimeAsync(1000);
    await d;

    start();
    await GH.startDeviceFlow('cid');
    const cancelled = GH.waitDeviceFlow();
    const c = expect(cancelled).rejects.toThrow('Sign-in was cancelled');
    GH.cancelDeviceFlow();
    await vi.advanceTimersByTimeAsync(1000);
    await c;

    stub([
      [/device\/code/, () => json(200, { device_code: 'dc', user_code: 'UC', verification_uri: 'v', expires_in: 0 })]
    ]);
    await GH.startDeviceFlow('cid');
    await expect(GH.waitDeviceFlow()).rejects.toThrow('The code expired');
  });

  it('turns away a user the guard rejects, keeping the previous token', async () => {
    stub([[/\/user\/orgs/, () => json(200, [])], [/\/user$/, () => json(200, { login: 'eve' })]]);
    GH.setSignInGuard((l) => l === 'me');
    await expect(GH.signInWithToken('  ghp_x  ')).rejects.toThrow('@eve is not allowed');
    expect(GH.getToken()).toBeNull();
    GH.setSignInGuard(null);
  });

  it('describes the rejected token kind in the log and puts reasons in errors', async () => {
    const kinds: [string, string][] = [['github_pat_1', 'fine'], ['ghp_1', 'classic'], ['gho_1', 'oauth'], ['ghu_1', 'app'], ['zzz', 'unknown']];
    stub([[/\/user$/, () => json(422, { message: 'Validation Failed', errors: ['plain', { resource: 'Issue', field: 'title', code: 'missing' }] }, { 'x-github-sso': 'required', 'x-ratelimit-remaining': '3' })]]);
    for (const [t] of kinds) {
      stub([[/\/user$/, () => json(422, { message: 'Validation Failed', errors: ['plain', { resource: 'Issue', field: 'title', code: 'missing' }] }, { 'x-github-sso': 'required' })]]);
      await expect(GH.signInWithToken(t)).rejects.toThrow('GitHub: Validation Failed [plain; Issue title missing] (422)');
    }
  });

  it('falls back to the status text when the error body is not JSON', async () => {
    stub([[/\/user$/, () => new Response('oops', { status: 500, statusText: 'Server Error' })]]);
    await expect(GH.currentUser()).rejects.toThrow('GitHub: Server Error (500)');
  });

  it('pages through repositories and words the age of each', async () => {
    const now = Date.now();
    const iso = (s: number) => new Date(now - s * 1000).toISOString();
    const first = Array.from({ length: 100 }, (_, i) => ({ full_name: `o/r${i}`, updated_at: iso(7200), pushed_at: i === 1 ? iso(86400 * 1) : i === 2 ? iso(86400 * 3) : i === 3 ? iso(86400 * 10) : i === 4 ? iso(86400 * 90) : undefined }));
    let page = 0;
    stub([[/\/user\/repos/, () => json(200, page++ === 0 ? first : [{ full_name: 'o/last', updated_at: iso(10) }])]]);
    const repos = await GH.listRepos(new Set());
    expect(repos).toHaveLength(101);
    expect(repos.slice(0, 6).map((r) => r.updated)).toEqual(['2h ago', 'Yesterday', '3 days ago', 'Last week', 'Last month', '2h ago']);
    expect(repos[100].updated).toBe('1m ago');
  });

  it('lists pull requests by state and check outcome', async () => {
    const pr = (n: number, o: any = {}) => ({ number: n, title: 't' + n, head: { ref: 'h' + n, sha: 's' + n }, base: { ref: 'main' }, state: 'open', draft: false, html_url: 'https://pr/' + n, ...o });
    stub([
      [/\/pulls\?/, () => json(200, [pr(1), pr(2), pr(3), pr(4), pr(5), pr(6, { state: 'closed', merged_at: 'x' }), pr(7, { state: 'closed' })])],
      [/s1\/check-runs/, () => json(200, { check_runs: [{ name: 'a', status: 'in_progress' }] })],
      [/s2\/check-runs/, () => json(200, { check_runs: [{ name: 'a', status: 'completed', conclusion: 'success', html_url: 'u' }, { name: 'b', status: 'completed', conclusion: 'skipped', details_url: 'd' }, { name: 'c', status: 'completed', conclusion: 'neutral' }] })],
      [/s3\/check-runs/, () => json(200, { check_runs: [{ name: 'a', status: 'completed', conclusion: 'failure' }] })],
      [/s4\/check-runs/, () => json(200, {})],
      [/s5\/check-runs/, () => json(500, { message: 'x' })]
    ]);
    const l = await GH.listPulls('o/r');
    expect(l.map((p) => p.checks)).toEqual(['pending', 'passing', 'failing', 'none', 'none', 'none', 'none']);
    expect(l[0].checkRuns![0]).toMatchObject({ state: 'pending', url: 'https://pr/1/checks' });
    expect(l[1].checkRuns!.map((c) => [c.state, c.url])).toEqual([['passing', 'u'], ['skipped', 'd'], ['passing', 'https://pr/2/checks']]);
    expect(l[2].checkRuns![0].state).toBe('failing');
    expect(l[3].checkRuns).toEqual([]);
    expect(l[4].checkRuns).toBeUndefined();
    expect(l[5].state).toBe('merged');
    expect(l[6].state).toBe('closed');
  });

  it('shapes issues and comments with sparse data', async () => {
    stub([
      [/issues\?/, () => json(200, [{ number: 1, title: 'a', html_url: 'u', labels: ['str', { name: 'obj' }, { name: '' }], updated_at: 'z' }, { number: 2, pull_request: {} }])],
      [/issues\/1$/, () => json(200, { number: 1, title: 'a', html_url: 'u', updated_at: 'z' })],
      [/issues\/2$/, () => json(200, { number: 2, title: 'b', body: 'B', html_url: 'u', labels: ['x'], user: { login: 'bob' }, comments: 4, updated_at: 'z' })],
      [/issues\/1\/comments/, () => json(200, [{ created_at: 't' }, { user: { login: 'a' }, body: 'hi', created_at: 't2' }])]
    ]);
    const list = await GH.listIssues('o/r');
    expect(list).toEqual([{ number: 1, title: 'a', body: '', url: 'u', labels: ['str', 'obj'], author: '', comments: 0, updated: 'z' }]);
    expect(await GH.getIssue('o/r', 1)).toMatchObject({ body: '', labels: [], author: '', comments: 0 });
    expect(await GH.getIssue('o/r', 2)).toMatchObject({ body: 'B', labels: ['x'], author: 'bob', comments: 4 });
    expect(await GH.issueComments('o/r', 1)).toEqual([{ author: '', body: '', at: 't' }, { author: 'a', body: 'hi', at: 't2' }]);
  });

  it('merges inline review comments and review bodies in time order', async () => {
    stub([
      [/pulls\/9\/comments/, () => json(200, [{ user: { login: 'a' }, body: 'b', path: 'f.ts', line: 3, created_at: '2024-02' }, { path: 'g.ts', original_line: 7, created_at: '2024-01' }, { created_at: '2024-04' }])],
      [/pulls\/9\/reviews/, () => json(200, [
        { user: { login: 'r' }, body: 'review', state: 'COMMENTED', submitted_at: '2024-03' },
        { body: 'x', state: 'PENDING' }, { body: '  ', state: 'COMMENTED' }, { body: undefined, state: 'APPROVED' },
        { body: 'nodate', state: 'CHANGES_REQUESTED' }
      ])]
    ]);
    const out = await GH.pullReviewComments('o/r', 9);
    expect(out.map((c) => [c.author, c.body, c.at, c.line])).toEqual([
      ['', 'nodate', '', undefined],
      ['', '', '2024-01', 7],
      ['a', 'b', '2024-02', 3],
      ['r', 'review', '2024-03', undefined],
      ['', '', '2024-04', undefined]
    ]);
  });

  it('lists workflows, tolerating files that cannot be read', async () => {
    stub([
      [/actions\/workflows\?/, () => json(200, { workflows: [
        { id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active', html_url: 'u1' },
        { id: 2, name: 'gone', path: '.github/workflows/gone.yml', state: 'active', html_url: 'u2' },
        { id: 3, name: 'off', path: 'x.yml', state: 'disabled_manually' }
      ] })],
      [/contents\/\.github\/workflows\/ci\.yml\?ref=feat%2Fa/, () => new Response('on:\n  workflow_dispatch:\n    inputs:\n      env:\n        description: where\n', { status: 200 })]
    ]);
    const w = await GH.listWorkflows('o/r', 'feat/a');
    expect(w.map((x) => [x.id, x.dispatchable])).toEqual([[1, true], [2, false]]);
    expect(w[1].inputs).toEqual([]);
    expect(calls.find((c) => /ci\.yml/.test(c.url))!.init.headers.Accept).toBe('application/vnd.github.raw+json');
  });

  it('dispatches with or without inputs and reads runs', async () => {
    stub([
      [/dispatches/, () => json(204, null)],
      [/workflows\/4\/runs/, () => json(200, { workflow_runs: [{ id: 1, run_number: 2, display_title: 'T', status: 'completed', conclusion: 'success', head_branch: 'm', event: 'push', triggering_actor: { login: 'a' }, html_url: 'u', created_at: 'c' }, { id: 2, name: 'N', actor: { login: 'b' } }, { id: 3 }] })],
      [/workflows\/5\/runs/, () => json(200, {})],
      [/actions\/runs\?/, () => json(200, { workflow_runs: [{ id: 1, name: 'CI', display_title: 'fix', triggering_actor: { login: 'a' } }, { id: 2, name: 'CI' }, { id: 3, display_title: 'only' }] })]
    ]);
    await GH.dispatchWorkflow('o/r', 4, 'main', {});
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ ref: 'main' });
    await GH.dispatchWorkflow('o/r', 4, 'main', { a: 'b' });
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ ref: 'main', inputs: { a: 'b' } });
    const runs = await GH.listRuns('o/r', 4, 3);
    expect(calls.at(-1)!.url).toContain('per_page=3');
    expect(runs.map((r) => [r.title, r.actor, r.branch])).toEqual([['T', 'a', 'm'], ['N', 'b', ''], ['', '', '']]);
    expect(await GH.listRuns('o/r', 5)).toEqual([]);
    const fin = await GH.listFinishedRuns('o/r');
    expect(fin.map((r) => [r.title, r.actor])).toEqual([['CI: fix', 'a'], ['CI', ''], ['workflow: only', '']]);
  });

  it('lists commits tolerating a non-array answer and sparse authors', async () => {
    stub([
      [/commits\?sha=a%2Fb/, () => json(200, [{ sha: '1', commit: { message: 'm', author: { name: 'N' } }, html_url: 'u' }, { sha: '2', author: { login: 'L' } }, { sha: '3' }])],
      [/commits\?sha=odd/, () => json(200, { message: 'x' })]
    ]);
    const c = await GH.listBranchCommits('o/r', 'a/b');
    expect(c.map((x) => [x.message, x.author])).toEqual([['m', 'N'], ['', 'L'], ['', '']]);
    expect(await GH.listBranchCommits('o/r', 'odd', 5)).toEqual([]);
  });

  it('reads and updates a pull request body', async () => {
    stub([[/pulls\/1$/, (u, i) => json(200, i.method === 'PATCH' ? {} : { body: null })]]);
    expect(await GH.getPullBody('o/r', 1)).toBe('');
    await GH.updatePullBody('o/r', 1, 'new');
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ body: 'new' });
  });
});

describe('github stored sign-in', () => {
  let dir = '';
  let GH: typeof import('../src/core/github');
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'helm-covgh-')); vi.resetModules(); GH = await import('../src/core/github'); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('encrypts and decrypts the stored token and reports changes', async () => {
    const enc = (s: string) => Buffer.from('E:' + s);
    const dec = (b: Buffer) => b.toString().slice(2);
    const change = vi.fn();
    GH.watchAuth(change, () => {});
    expect(await GH.loadToken({ dataDir: dir, encrypt: enc, decrypt: dec })).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async (u: string) => /orgs/.test(u) ? json(200, []) : json(200, { login: 'me' })));
    await GH.signInWithToken('ghp_a');
    expect(change).toHaveBeenCalled();
    expect((await readFile(join(dir, 'auth.bin'), 'utf8')).startsWith('E:{')).toBe(true);
    expect(await GH.loadToken({ dataDir: dir, encrypt: enc, decrypt: dec })).toBe('ghp_a');
    await GH.clearToken();
    expect(GH.getToken()).toBeNull();
  });

  it('logs and carries on when the CLI config cannot be written', async () => {
    const blocker = join(dir, 'blocker');
    await (await import('node:fs/promises')).writeFile(blocker, 'file');
    await (await import('node:fs/promises')).writeFile(join(dir, 'auth.bin'), 'ghp_z');
    // ghConfigDir lives under a regular file, so mkdir fails.
    await expect(GH.loadToken({ dataDir: dir, ghConfigDir: join(blocker, 'sub') })).resolves.toBe('ghp_z');
  });

  async function load(auth: object) {
    await (await import('node:fs/promises')).writeFile(join(dir, 'auth.bin'), JSON.stringify(auth));
    const signedOut = vi.fn();
    GH.watchAuth(() => {}, signedOut);
    await GH.loadToken({ dataDir: dir });
    return signedOut;
  }

  it('signs out when GitHub refuses the refresh', async () => {
    const signedOut = await load({ token: 'ghu_old', refreshToken: 'r', clientId: 'c' });
    stub([[/oauth\/access_token/, () => json(200, { error: 'bad_refresh_token', error_description: 'gone' })], [/\/user$/, () => json(401, { message: 'Bad credentials' })]]);
    await expect(GH.currentUser()).rejects.toThrow(/expired or was revoked/);
    expect(signedOut).toHaveBeenCalled();
    expect(GH.getToken()).toBeNull();
  });

  it('does not try to refresh with an expired refresh token or no client id', async () => {
    const signedOut = await load({ token: 'ghu_old', refreshToken: 'r', clientId: 'c', refreshExpiresAt: Date.now() - 1000, expiresAt: Date.now() - 1000 });
    stub([[/\/user$/, () => json(401, { message: 'Bad credentials' })]]);
    await expect(GH.currentUser()).rejects.toThrow(/401/);
    expect(calls.some((c) => /oauth\/access_token/.test(c.url))).toBe(false);
    expect(signedOut).toHaveBeenCalled();
  });

  it('logs a failed proactive refresh and lets the request report it', async () => {
    await load({ token: 'ghu_old', refreshToken: 'r', clientId: 'c', expiresAt: Date.now() - 1000 });
    stub([[/oauth\/access_token/, () => { throw new Error('offline'); }], [/\/user$/, () => json(200, { login: 'me' })]]);
    await expect(GH.currentUser()).resolves.toMatchObject({ login: 'me' });
    await GH.ensureFresh(); // second call: still expired, still tolerated
  });

  it('shares one refresh between concurrent callers and keeps refresh expiry', async () => {
    await load({ token: 'ghu_old', refreshToken: 'r', clientId: 'c', expiresAt: Date.now() - 1000 });
    stub([[/oauth\/access_token/, () => json(200, { access_token: 'ghu_new', refresh_token: 'r2', expires_in: 3600, refresh_token_expires_in: 86400 })]]);
    await Promise.all([GH.ensureFresh(), GH.ensureFresh()]);
    expect(calls.filter((c) => /oauth\/access_token/.test(c.url))).toHaveLength(1);
    const saved = JSON.parse(await readFile(join(dir, 'auth.bin'), 'utf8'));
    expect(saved).toMatchObject({ token: 'ghu_new', refreshToken: 'r2' });
    expect(saved.refreshExpiresAt).toBeGreaterThan(Date.now());
  });

  it('reports a failing raw file fetch', async () => {
    stub([
      [/actions\/workflows\?/, () => json(200, { workflows: [{ id: 1, name: 'a', path: 'a.yml', state: 'active' }] })],
      [/contents/, () => new Response('', { status: 404, statusText: 'Not Found' })]
    ]);
    const w = await GH.listWorkflows('o/r', 'main');
    expect(w[0].dispatchable).toBe(false);
  });
});
