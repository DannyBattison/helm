import { describe, expect, it } from 'vitest';
import { callAllowed, signedOutState, signInLimiter } from '../src/policy';

describe('what a visitor who has not signed in may call', () => {
  it('is only what helm\'s own sign-in screen needs', () => {
    for (const n of ['getState', 'signInStart', 'signInWait', 'signInToken']) expect(callAllowed(false, n)).toBe(true);
  });
  it('is nothing else: no sessions, repositories, settings, files or terminal', () => {
    for (const n of ['createSession', 'sendMessage', 'updateSettings', 'listFiles', 'readFile', 'termOpen', 'termWrite', 'signOut', 'listGithubRepos', 'cloneUrl', 'constructor', '__proto__', 5, undefined]) expect(callAllowed(false, n)).toBe(false);
  });
  it('leaves a signed-in connection alone', () => {
    expect(callAllowed(true, 'createSession')).toBe(true);
  });
});

describe('the state a signed-out page is shown', () => {
  const real: any = {
    ready: true, user: { login: 'danny' }, repos: [{ id: 'a/b', localPath: '/home/helm/code/b' }], sessions: [{ id: 's', task: 'secret work' }], activity: [{ what: 'x' }],
    weekSpend: { 'a/b': 3 }, lifetime: { 'a/b': { input: 1 } }, tokensToday: 99, plan: { at: 1, fiveHour: { util: 0.5, resetsAt: 1 } }, home: '/home/helm',
    backends: [], rates: { USD: 1 }, platform: 'linux',
    settings: { theme: 'dark', uiFont: 'Mona Sans', githubClientId: 'abc', claudePath: '/opt/claude', worktreeRoot: '/home/helm/.helm/worktrees', cloneRoot: '/home/helm/code', copyFiles: '.env', alwaysAllow: ['git *'], companionUrl: 'https://x' }
  };
  const safe: any = signedOutState(real);

  it('says nobody is signed in and shows nothing of theirs', () => {
    expect(safe.user).toBeNull();
    expect(safe.repos).toEqual([]);
    expect(safe.sessions).toEqual([]);
    expect(safe.activity).toEqual([]);
    expect(safe.weekSpend).toEqual({});
    expect(safe.lifetime).toEqual({});
    expect(safe.tokensToday).toBe(0);
    expect(safe.plan).toEqual({ at: 0 });
    expect(safe.home).toBe('');
    expect(JSON.stringify(safe)).not.toMatch(/secret work|\/home\/helm|danny|git \*|opt\/claude/);
  });
  it('keeps what the sign-in screen needs to look right and work', () => {
    expect(safe.settings.theme).toBe('dark');
    expect(safe.settings.uiFont).toBe('Mona Sans');
    expect(safe.settings.githubClientId).toBe('abc');
    expect(safe.ready).toBe(true);
    expect(safe.platform).toBe('linux');
  });
  it('does not change the real state', () => {
    expect(real.user).toEqual({ login: 'danny' });
    expect(real.settings.claudePath).toBe('/opt/claude');
  });
});

describe('sign-in attempts', () => {
  it('are limited per address per minute', () => {
    let t = 0;
    const ok = signInLimiter(3, () => t);
    expect([ok('a'), ok('a'), ok('a'), ok('a')]).toEqual([true, true, true, false]);
    expect(ok('b')).toBe(true);
    t = 61_000;
    expect(ok('a')).toBe(true);
  });
});
