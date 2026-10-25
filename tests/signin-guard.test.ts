import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as GH from '../src/core/github';

// The hosted server lets only one GitHub username in. The check lives in helm's own sign-in, after GitHub says who it is and before the token is
// kept, so someone turned away cannot displace the person who is already signed in.

let dir = '';
const realFetch = globalThis.fetch;
const asUser = (login: string) => {
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    if (u.endsWith('/user')) return new Response(JSON.stringify({ login, name: login, email: null, avatar_url: '' }), { status: 200 });
    if (u.includes('/user/orgs')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 404 });
  }) as any;
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'helm-guard-'));
  await GH.loadToken({ dataDir: dir });
});
afterEach(async () => {
  GH.setSignInGuard(null);
  await GH.clearToken();
  globalThis.fetch = realFetch;
  rmSync(dir, { recursive: true, force: true });
});

describe('signing in with a guard', () => {
  it('lets in a username on the list, and keeps their token', async () => {
    GH.setSignInGuard((l) => l.toLowerCase() === 'danny');
    asUser('Danny');
    const u = await GH.signInWithToken('token-danny');
    expect(u.login).toBe('Danny');
    expect(GH.getToken()).toBe('token-danny');
  });

  it('turns away anyone else, and leaves the person already signed in as they were', async () => {
    GH.setSignInGuard((l) => l.toLowerCase() === 'danny');
    asUser('danny');
    await GH.signInWithToken('token-danny');
    asUser('stranger');
    await expect(GH.signInWithToken('token-stranger')).rejects.toThrow('@stranger is not allowed to use this server.');
    expect(GH.getToken()).toBe('token-danny');
  });

  it('keeps no token at all for someone turned away when nobody was signed in', async () => {
    GH.setSignInGuard(() => false);
    asUser('stranger');
    await expect(GH.signInWithToken('token-stranger')).rejects.toThrow(/not allowed/);
    expect(GH.getToken()).toBeNull();
  });

  it('lets anyone in without a guard, as the desktop app does', async () => {
    asUser('whoever');
    expect((await GH.signInWithToken('t')).login).toBe('whoever');
  });
});
