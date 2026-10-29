import { describe, expect, it } from 'vitest';
import { githubLogin } from '../src/github';
import { Account } from '../src/session';
import type { Secrets } from '../src/session';

const memory = (): Secrets & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => { data.set(k, v); }, remove: async (k) => { data.delete(k); } };
};

/** GitHub, as far as the phone talks to it. `valid` is the set of tokens GitHub accepts, with the login each belongs to. */
function github(valid: Record<string, string>, opts: { offline?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (url: string, init: any) => {
    calls.push(url);
    if (opts.offline) throw new TypeError('network');
    const reply = (status: number, j: unknown = {}) => ({ ok: status < 300, status, json: async () => j }) as any;
    if (url.endsWith('/device/code')) return reply(200, { device_code: 'dc', user_code: 'AB-12', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
    if (url.endsWith('/access_token')) return reply(200, { access_token: 'tok-new' });
    const token = /Bearer (.+)/.exec(init?.headers?.Authorization)?.[1] ?? '';
    return valid[token] ? reply(200, { login: valid[token] }) : reply(401);
  }) as any;
  return { f, calls };
}
const noWait = async () => undefined;

describe('the GitHub sign-in kept on the phone', () => {
  it('signs in once, shows the code to copy, and keeps the token in secure storage', async () => {
    const s = memory();
    const g = github({ 'tok-new': 'Alice' });
    let shown: string | undefined;
    const me = await new Account(s, 'cid', g.f, noWait).signIn((c) => { shown = c.userCode; });
    expect(shown).toBe('AB-12');
    expect(me).toEqual({ token: 'tok-new', login: 'Alice' });
    expect(JSON.parse(s.data.get('helm.github')!)).toEqual(me);
  });

  it('remembers who is signed in, and asks GitHub whether the token still works', async () => {
    const s = memory();
    const g = github({ 'tok-new': 'Alice' });
    const account = new Account(s, 'cid', g.f, noWait);
    expect(await account.current()).toBeNull();
    await account.signIn(() => undefined);
    expect(await account.current()).toEqual({ token: 'tok-new', login: 'Alice' });
    expect(g.calls.filter((u) => u.includes('api.github.com'))).toHaveLength(2);
  });

  it('forgets a token GitHub has revoked, so the next step is to sign in again', async () => {
    const s = memory();
    s.data.set('helm.github', JSON.stringify({ token: 'old', login: 'Alice' }));
    expect(await new Account(s, 'cid', github({}).f).current()).toBeNull();
    expect(s.data.has('helm.github')).toBe(false);
  });

  it('keeps working offline with what it has, and follows a renamed account', async () => {
    const s = memory();
    s.data.set('helm.github', JSON.stringify({ token: 'tok', login: 'Alice' }));
    expect(await new Account(s, 'cid', github({}, { offline: true }).f).current()).toEqual({ token: 'tok', login: 'Alice' });
    expect(await new Account(s, 'cid', github({ tok: 'AliceRenamed' }).f).current()).toEqual({ token: 'tok', login: 'AliceRenamed' });
    expect(JSON.parse(s.data.get('helm.github')!).login).toBe('AliceRenamed');
  });

  it('signs out by deleting it, and ignores damaged storage', async () => {
    const s = memory();
    const account = new Account(s, 'cid', github({ 'tok-new': 'Alice' }).f, noWait);
    await account.signIn(() => undefined);
    await account.signOut();
    expect(s.data.size).toBe(0);
    s.data.set('helm.github', '{not json');
    expect(await account.current()).toBeNull();
    s.data.set('helm.github', JSON.stringify({ token: 5 }));
    expect(await account.current()).toBeNull();
  });

  it('does not keep a token it cannot name a user for', async () => {
    const s = memory();
    await expect(new Account(s, 'cid', github({}).f, noWait).signIn(() => undefined)).rejects.toThrow(/did not say who you are/);
    expect(s.data.size).toBe(0);
  });
});

describe('asking GitHub who a token is', () => {
  it('says null for a rejected token, throws when GitHub cannot be reached or is failing', async () => {
    const r = (status: number, j: unknown = {}) => (async () => ({ ok: status < 300, status, json: async () => j })) as any;
    expect(await githubLogin('t', r(200, { login: 'Bob' }))).toBe('Bob');
    expect(await githubLogin('t', r(401))).toBeNull();
    await expect(githubLogin('t', r(500))).rejects.toThrow(/500/);
    await expect(githubLogin('t', (async () => { throw new TypeError('offline'); }) as any)).rejects.toThrow();
  });
});
