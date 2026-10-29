/**
 * Signing in to GitHub on the phone, only to show a computer which GitHub user this is (the device flow, no scopes). The token goes to the
 * computer once, encrypted, when pairing, and is not kept. helm's OAuth app has the device flow turned on already.
 */
export interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; interval: number; expiresIn: number }

type Fetch = typeof fetch;
const json = { Accept: 'application/json', 'Content-Type': 'application/json' };

export async function startDeviceFlow(clientId: string, f: Fetch = fetch): Promise<DeviceCode> {
  const r = await f('https://github.com/login/device/code', { method: 'POST', headers: json, body: JSON.stringify({ client_id: clientId, scope: '' }) });
  const j: any = await r.json();
  if (!j.device_code) throw new Error(j.error_description || 'GitHub did not start the sign-in.');
  return { deviceCode: j.device_code, userCode: j.user_code, verificationUri: j.verification_uri, interval: j.interval ?? 5, expiresIn: j.expires_in };
}

/** Waits for the person to approve on github.com/login/device. Resolves with the access token. */
export async function waitForToken(clientId: string, d: DeviceCode, f: Fetch = fetch, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<string> {
  const until = Date.now() + d.expiresIn * 1000;
  let wait = Math.max(d.interval, 1) * 1000;
  while (Date.now() < until) {
    await sleep(wait);
    let j: any;
    try {
      const r = await f('https://github.com/login/oauth/access_token', { method: 'POST', headers: json, body: JSON.stringify({ client_id: clientId, device_code: d.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
      j = await r.json();
    } catch {
      continue; // a dropped lookup or connection mid-wait is not the end of the sign-in; ask again until the code expires
    }
    if (j.access_token) return j.access_token;
    if (j.error === 'slow_down') wait += 5000;
    else if (j.error === 'access_denied') throw new Error('The sign-in was declined.');
    else if (j.error && j.error !== 'authorization_pending') throw new Error(j.error_description || 'The sign-in did not finish.');
  }
  throw new Error('The sign-in code expired. Try again.');
}

/** The GitHub user a token belongs to: their login, or null if GitHub says the token is no good (revoked, or never valid). Throws if GitHub could not be reached. */
export async function githubLogin(token: string, f: Fetch = fetch): Promise<string | null> {
  const r = await f('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (r.status === 401 || r.status === 403) return null;
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  const j: any = await r.json();
  return typeof j?.login === 'string' ? j.login : null;
}
