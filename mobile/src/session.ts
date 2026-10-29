import { githubLogin, startDeviceFlow, waitForToken } from './github';
import type { DeviceCode } from './github';

/** Where the GitHub token is kept: the phone's secure storage (Keychain on iOS, Keystore on Android), not ordinary preferences. */
export interface Secrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Signed { token: string; login: string }

const KEY = 'helm.github';

/**
 * The GitHub sign-in of the person using this phone, done once and kept. The token has no scopes: it only says who this is, and is sent to
 * a computer once, when pairing with it, so the computer can check it is the same GitHub user as the one signed in there. It is never sent
 * when reconnecting, and signing out deletes it (it can also be revoked at github.com/settings/applications).
 */
export class Account {
  constructor(private secrets: Secrets, private clientId: string, private f: typeof fetch = fetch, private sleep?: (ms: number) => Promise<void>) {}

  private async stored(): Promise<Signed | null> {
    try {
      const v = JSON.parse((await this.secrets.get(KEY)) || 'null');
      return typeof v?.token === 'string' && typeof v?.login === 'string' ? v : null;
    } catch { return null; }
  }

  /**
   * Who is signed in, checked with GitHub so a revoked token is noticed (and forgotten). With no network the saved sign-in is trusted: the
   * computer will refuse a bad token anyway.
   */
  async current(): Promise<Signed | null> {
    const s = await this.stored();
    if (!s) return null;
    try {
      const login = await githubLogin(s.token, this.f);
      if (!login) { await this.secrets.remove(KEY); return null; }
      if (login !== s.login) { const fresh = { token: s.token, login }; await this.secrets.set(KEY, JSON.stringify(fresh)); return fresh; }
    } catch { /* offline: use what we have */ }
    return s;
  }

  /** Runs GitHub's device flow. `show` is given the code to display; resolves once the person has approved it on github.com/login/device. */
  async signIn(show: (code: DeviceCode) => void): Promise<Signed> {
    const flow = await startDeviceFlow(this.clientId, this.f);
    show(flow);
    const token = await waitForToken(this.clientId, flow, this.f, this.sleep);
    const login = await githubLogin(token, this.f);
    if (!login) throw new Error('GitHub did not say who you are. Try again.');
    const s = { token, login };
    await this.secrets.set(KEY, JSON.stringify(s));
    return s;
  }

  async signOut() { await this.secrets.remove(KEY); }
}
