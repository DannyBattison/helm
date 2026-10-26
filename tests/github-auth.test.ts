import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir = '';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('github token renewal', () => {
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'helm-auth-')); vi.resetModules(); });
  afterEach(() => vi.unstubAllGlobals());

  async function load(auth: object | string) {
    await writeFile(join(dir, 'auth.bin'), typeof auth === 'string' ? auth : JSON.stringify(auth));
    const GH = await import('../src/core/github');
    const signedOut = vi.fn();
    GH.watchAuth(() => {}, signedOut);
    await GH.loadToken({ dataDir: dir });
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
});
