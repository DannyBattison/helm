import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

type Route = [RegExp, (url: string, init: any) => Response];
let calls: { url: string; init: any }[] = [];
function stub(routes: Route[]) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, init });
    for (const [re, fn] of routes) if (re.test(url)) return fn(url, init);
    return json(404, { message: 'Not Found' });
  }));
}

describe('github api', () => {
  let GH: typeof import('../src/core/github');
  beforeEach(async () => { vi.resetModules(); GH = await import('../src/core/github'); });
  afterEach(() => vi.unstubAllGlobals());

  it('turns users, organisations and repositories into helm shapes', async () => {
    stub([
      [/\/user\/orgs/, () => json(200, [{ login: 'acme' }])],
      [/\/user\/repos\?/, (u) => json(200, [{ full_name: 'me/a', description: 'd', language: 'Go', pushed_at: new Date().toISOString(), private: true, default_branch: 'main' }])],
      [/\/user$/, () => json(200, { login: 'me', name: 'Me', email: 'm@x', avatar_url: 'av' })]
    ]);
    expect(await GH.currentUser()).toEqual({ login: 'me', name: 'Me', email: 'm@x', avatar: 'av', orgs: ['acme'] });
    expect(await GH.listOwners()).toEqual(['me', 'acme']);
    const repos = await GH.listRepos(new Set(['me/a']));
    expect(repos[0]).toMatchObject({ id: 'me/a', lang: 'Go', updated: '1m ago', added: true, defaultBranch: 'main' });
  });

  it('survives missing org scope', async () => {
    stub([[/\/user\/orgs/, () => json(403, { message: 'no' })], [/\/user$/, () => json(200, { login: 'me' })]]);
    expect((await GH.currentUser()).orgs).toEqual([]);
  });

  it('creates repos under the user or an organisation', async () => {
    stub([[/\/user$/, () => json(200, { login: 'Me' })], [/repos$/, () => json(201, { full_name: 'x/y' })]]);
    expect(await GH.createRepo({ name: 'y', description: '', private: true })).toBe('x/y');
    expect(calls.at(-1)!.url).toMatch(/\/user\/repos$/);
    await GH.createRepo({ name: 'y', description: 'd', private: false, owner: 'me' });
    expect(calls.at(-1)!.url).toMatch(/\/user\/repos$/);
    await GH.createRepo({ name: 'y', description: 'd', private: false, owner: 'acme' });
    expect(calls.at(-1)!.url).toMatch(/\/orgs\/acme\/repos$/);
  });

  it('reads repo info and drives pull requests', async () => {
    stub([
      [/\/repos\/o\/r$/, () => json(200, { private: false, language: 'TS', default_branch: 'dev' })],
      [/\/pulls\/5\/merge/, () => json(200, {})],
      [/\/pulls\/5$/, (u, i) => json(200, { body: i.method === 'PATCH' ? 'patched' : 'the body' })],
      [/\/pulls$/, () => json(201, { html_url: 'https://pr' })],
      [/git\/refs\/heads/, () => json(204, null)]
    ]);
    expect(await GH.repoInfo('o/r')).toEqual({ private: false, lang: 'TS', defaultBranch: 'dev' });
    expect(await GH.createPull('o/r', { head: 'h', base: 'b', title: 't', body: '', draft: true })).toBe('https://pr');
    await GH.mergePull('o/r', 5, 'squash');
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ merge_method: 'squash' });
    await GH.deleteBranch('o/r', 'agent/a b');
    expect(calls.at(-1)!.url).toContain('agent/a%20b');
    expect(await GH.getPullBody('o/r', 5)).toBe('the body');
    await GH.updatePullBody('o/r', 5, 'x');
    expect(calls.at(-1)!.init.method).toBe('PATCH');
  });

  it('lists pull requests with the state of their checks', async () => {
    const pr = (n: number, over: any = {}) => ({ number: n, title: 't' + n, head: { ref: 'b' + n, sha: 's' + n }, base: { ref: 'main' }, state: 'open', draft: false, html_url: 'u' + n, ...over });
    stub([
      [/pulls\?/, () => json(200, [pr(1), pr(2), pr(3), pr(4), pr(5, { state: 'closed', merged_at: 'x' }), pr(6)])],
      [/commits\/s1\//, () => json(200, { check_runs: [{ name: 'a', status: 'completed', conclusion: 'success', html_url: 'x' }, { name: 'b', status: 'completed', conclusion: 'skipped' }] })],
      [/commits\/s2\//, () => json(200, { check_runs: [{ name: 'a', status: 'in_progress' }] })],
      [/commits\/s3\//, () => json(200, { check_runs: [{ name: 'a', status: 'completed', conclusion: 'failure' }] })],
      [/commits\/s4\//, () => json(200, {})],
      [/commits\/s6\//, () => json(500, { message: 'x' })]
    ]);
    const list = await GH.listPulls('o/r');
    expect(list.map((p) => p.checks)).toEqual(['passing', 'pending', 'failing', 'none', 'none', 'none']);
    expect(list[4].state).toBe('merged');
    expect(list[0].checkRuns!.map((c) => c.state)).toEqual(['passing', 'skipped']);
  });

  it('lists issues without pull requests, and comments', async () => {
    const issue = { number: 1, title: 'a', body: null, html_url: 'u', labels: ['x', { name: 'y' }], user: { login: 'me' }, comments: 2, updated_at: 't' };
    stub([
      [/issues\?/, () => json(200, [issue, { ...issue, number: 2, pull_request: {} }])],
      [/issues\/1\/comments/, () => json(200, [{ user: { login: 'c' }, body: 'hi', created_at: '1' }])],
      [/issues\/1$/, () => json(200, issue)],
      [/pulls\/1\/comments/, () => json(200, [{ user: { login: 'r' }, body: 'inline', path: 'a.ts', line: 3, created_at: '2' }])],
      [/pulls\/1\/reviews/, () => json(200, [{ user: { login: 'q' }, body: 'review', state: 'COMMENTED', submitted_at: '1' }, { body: 'pending', state: 'PENDING' }, { body: ' ', state: 'APPROVED' }])]
    ]);
    const list = await GH.listIssues('o/r');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ body: '', labels: ['x', 'y'], author: 'me', comments: 2 });
    expect((await GH.getIssue('o/r', 1)).number).toBe(1);
    expect(await GH.issueComments('o/r', 1)).toEqual([{ author: 'c', body: 'hi', at: '1' }]);
    const rc = await GH.pullReviewComments('o/r', 1);
    expect(rc.map((c) => c.body)).toEqual(['review', 'inline']);
  });

  it('lists workflows, dispatches and runs', async () => {
    stub([
      [/workflows\?per_page/, () => json(200, { workflows: [{ id: 1, name: 'ci', path: '.github/workflows/ci.yml', state: 'active', html_url: 'u' }, { id: 2, name: 'off', path: 'x', state: 'disabled_manually' }, { id: 3, name: 'gone', path: '.github/workflows/gone.yml', state: 'active' }] })],
      [/contents\/.*ci\.yml/, () => new Response('on:\n  workflow_dispatch:\n    inputs:\n      env:\n        description: where\n')],
      [/dispatches/, () => json(204, null)],
      [/runs\?/, () => json(200, { workflow_runs: [{ id: 9, run_number: 3, display_title: 'T', status: 'completed', conclusion: 'success', head_branch: 'main', event: 'push', triggering_actor: { login: 'me' }, html_url: 'u', created_at: 'c' }] })]
    ]);
    const w = await GH.listWorkflows('o/r', 'main');
    expect(w.map((x) => [x.name, x.dispatchable])).toEqual([['ci', true], ['gone', false]]);
    await GH.dispatchWorkflow('o/r', 1, 'main', { env: 'prod' });
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ ref: 'main', inputs: { env: 'prod' } });
    await GH.dispatchWorkflow('o/r', 1, 'main', {});
    expect(JSON.parse(calls.at(-1)!.init.body)).toEqual({ ref: 'main' });
    expect(await GH.listRuns('o/r', 1)).toEqual([expect.objectContaining({ id: 9, number: 3, actor: 'me', branch: 'main' })]);
  });

  it('reports GitHub errors with their reasons', async () => {
    stub([[/pulls$/, () => json(422, { message: 'Validation Failed', errors: [{ resource: 'PullRequest', code: 'custom', message: 'No commits' }, 'plain'] }, { 'x-ratelimit-remaining': '4' })]]);
    await expect(GH.createPull('o/r', { head: 'h', base: 'b', title: 't', body: '', draft: false })).rejects.toThrow(/Validation Failed \[PullRequest custom No commits; plain\] \(422\)/);
    stub([[/pulls\?/, () => new Response('nope', { status: 500, statusText: 'Boom' })]]);
    await expect(GH.listPulls('o/r')).rejects.toThrow(/Boom \(500\)/);
  });
});
