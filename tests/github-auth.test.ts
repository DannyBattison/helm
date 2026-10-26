import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir = '';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('github token renewal', () => {
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'helm-auth-')); vi.resetModules(); });
  afterEach(() => vi.unstubAllGlobals());

  async function load(auth: object | string, ghConfigDir?: string) {
    await writeFile(join(dir, 'auth.bin'), typeof auth === 'string' ? auth : JSON.stringify(auth));
    const GH = await import('../src/core/github');
    const signedOut = vi.fn();
    GH.watchAuth(() => {}, signedOut);
    await GH.loadToken({ dataDir: dir, ghConfigDir });
    return { GH, signedOut };
  }

  it('reads a token file written before refresh tokens existed', async () => {
    const { GH } = await load('gho_old');
    expect(GH.getToken()).toBe('gho_old');
  });

  it('on a 401 swaps the refresh token for a new access token and retries once', async () => {
    const { GH, signedOut } = await load({ token: 'ghu_old', refreshToken: 'ghr_old', clientId: 'cid', expiresAt: Date.now() + 3_600_000 });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (url.startsWith('https://github.com/login/oauth/access_token')) return json(200, { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 });
      seen.push(init.headers.Authorization);
      return seen.length === 1 ? json(401, { message: 'Bad credentials' }) : json(200, { login: 'me' });
    }));
    await expect(GH.currentUser()).resolves.toMatchObject({ login: 'me' });
    expect(seen.slice(0, 2)).toEqual(['Bearer ghu_old', 'Bearer ghu_new']);
    expect(JSON.parse(await readFile(join(dir, 'auth.bin'), 'utf8'))).toMatchObject({ token: 'ghu_new', refreshToken: 'ghr_new', clientId: 'cid' });
    expect(signedOut).not.toHaveBeenCalled();
  });

  it('renews before the request when the token is about to expire', async () => {
    const { GH } = await load({ token: 'ghu_old', refreshToken: 'ghr_old', clientId: 'cid', expiresAt: Date.now() + 10_000 });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (url.startsWith('https://github.com/')) return json(200, { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 });
      seen.push(init.headers.Authorization);
      return json(200, { login: 'me' });
    }));
    await GH.currentUser();
    expect(seen[0]).toBe('Bearer ghu_new');
  });

  it('forgets a token that is rejected and cannot be renewed, and says so', async () => {
    const { GH, signedOut } = await load('gho_dead');
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { message: 'Bad credentials' })));
    await expect(GH.currentUser()).rejects.toThrow(/sign in again/i);
    expect(GH.getToken()).toBeNull();
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it('keeps the current sign-in when a pasted token turns out to be bad', async () => {
    const { GH, signedOut } = await load('gho_good');
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { message: 'Bad credentials' })));
    await expect(GH.signInWithToken('ghp_typo')).rejects.toThrow(/Bad credentials/);
    expect(GH.getToken()).toBe('gho_good');
    expect(signedOut).not.toHaveBeenCalled();
  });

  describe('the GitHub CLI sign-in', () => {
    const hosts = (d: string) => join(d, 'gh', 'hosts.yml');

    it('is written for gh when the host asks, readable only by the owner', async () => {
      await load('gho_abc', join(dir, 'gh'));
      const text = await readFile(hosts(dir), 'utf8');
      expect(text).toContain('github.com:');
      expect(text).toContain('oauth_token: "gho_abc"');
      expect(text).toContain('git_protocol: https');
      expect((await stat(hosts(dir))).mode & 0o777).toBe(0o600);
    });

    it('follows a renewed token and goes when the token does', async () => {
      const { GH } = await load({ token: 'ghu_old', refreshToken: 'ghr_old', clientId: 'cid', expiresAt: Date.now() + 10_000 }, join(dir, 'gh'));
      vi.stubGlobal('fetch', vi.fn(async () => json(200, { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 28800 })));
      await GH.ensureFresh();
      expect(await readFile(hosts(dir), 'utf8')).toContain('"ghu_new"');
      await GH.clearToken();
      await expect(stat(hosts(dir))).rejects.toThrow();
    });

    it('is not written without a host that asks for it', async () => {
      await load('gho_abc');
      await expect(stat(hosts(dir))).rejects.toThrow();
    });

    it("leaves a hosts.yml helm did not write alone", async () => {
      const { mkdir } = await import('node:fs/promises');
      await mkdir(join(dir, 'gh'));
      await writeFile(hosts(dir), 'ghe.example.com:\n    oauth_token: mine\n');
      const { GH } = await load('gho_abc', join(dir, 'gh'));
      await GH.clearToken();
      expect(await readFile(hosts(dir), 'utf8')).toContain('mine');
      expect(await readFile(hosts(dir), 'utf8')).not.toContain('gho_abc');
    });
  });
});
