// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair } from '../../src/shared/p2p/noise';
import { b64, encodeShareCode } from '../../src/shared/p2p/sharecode';

// ------------------------------------------------------------------------------------------------ the fake phone
const h = vi.hoisted(() => {
  const s = {
    prefs: new Map<string, string>(),
    secrets: new Map<string, string>(),
    listeners: {} as Record<string, (e: any) => void>,
    notifListeners: {} as Record<string, (e: any) => void>,
    launchUrl: undefined as string | undefined,
    clipboard: [] as string[],
    opened: [] as string[],
    minimized: 0,
    scheduled: [] as any[],
    permissions: vi.fn(async () => ({ display: 'granted' })),
    deviceName: 'Pixel' as string | undefined,
    connects: [] as { link: any; hooks: any }[],
    connectResult: null as null | (() => Promise<any>),
    conn: { close: vi.fn() },
    bridges: [] as any[],
    autoReady: true,
    scan: null as null | ((video: HTMLVideoElement, signal?: AbortSignal) => Promise<string>),
    scanCalls: 0
  };
  return s;
});

vi.mock('@capacitor/app', () => ({ App: {
  addListener: async (name: string, cb: any) => { h.listeners[name] = cb; return { remove: async () => undefined }; },
  minimizeApp: async () => { h.minimized++; },
  getLaunchUrl: async () => (h.launchUrl ? { url: h.launchUrl } : undefined)
} }));
vi.mock('@capacitor/browser', () => ({ Browser: { open: async (o: { url: string }) => { h.opened.push(o.url); } } }));
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: async (o: { string: string }) => { h.clipboard.push(o.string); } } }));
vi.mock('@capacitor/device', () => ({ Device: { getInfo: async () => ({ name: h.deviceName }) } }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  schedule: async (o: any) => { h.scheduled.push(o); },
  requestPermissions: (...a: any[]) => (h.permissions as any)(...a),
  addListener: async (name: string, cb: any) => { h.notifListeners[name] = cb; return { remove: async () => undefined }; }
} }));
vi.mock('../src/native', () => ({
  capacitorUdp: () => ({ send() {}, onMessage() {}, close() {} }),
  preferences: { get: async (k: string) => h.prefs.get(k) ?? null, set: async (k: string, v: string) => { h.prefs.set(k, v); } },
  secrets: { get: async (k: string) => h.secrets.get(k) ?? null, set: async (k: string, v: string) => { h.secrets.set(k, v); }, remove: async (k: string) => { h.secrets.delete(k); } }
}));
vi.mock('../src/p2pConn', () => ({
  connectDesktop: (_socket: unknown, link: any, hooks: any = {}) => async () => {
    h.connects.push({ link, hooks });
    if (h.connectResult) return h.connectResult();
    return h.conn;
  }
}));
vi.mock('../src/scan', () => ({ scanShareCode: (v: HTMLVideoElement, s?: AbortSignal) => { h.scanCalls++; return h.scan!(v, s); } }));
vi.mock('../../src/renderer/src/main', () => ({ mounted: true }));
vi.mock('../../hosted/web/bridge', () => ({
  createConnectionBridge: (connect: () => Promise<any>) => {
    let ready!: () => void;
    const b: any = { connect, open: vi.fn(), settle: () => ready(), ready: new Promise<void>((r) => { ready = r; }) };
    if (h.autoReady) ready();
    h.bridges.push(b);
    return b;
  }
}));

// ------------------------------------------------------------------------------------------------ helpers
const key = generateKeyPair();
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const shareCode = (name = 'Desk') => encodeShareCode({ v: 1, n: name, p: 1000, c: ['10.0.0.1'], k: b64.encode(new Uint8Array(32).fill(1)), s: b64.encode(new Uint8Array(16).fill(2)) });
const desktop = (id = 'd1', name = 'Desk') => ({ id, kind: 'desktop', name, code: shareCode(name), secretKey: hex(key.secretKey) });
const hosted = (id = 'h1') => ({ id, kind: 'hosted', name: 'Cloud', url: 'https://cloud.example' });
const saved = () => JSON.parse(h.prefs.get('helm.instances') ?? '[]');

const gh = { tokenAnswers: [] as any[], deviceFails: false, login: 'alice', userStatus: 200 };
const fetchStub = vi.fn(async (url: string) => {
  const reply = (j: any, status = 200) => ({ ok: status < 400, status, json: async () => j }) as any;
  if (url.endsWith('/device/code')) return reply(gh.deviceFails ? { error_description: 'GitHub is down' } : { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 1 });
  if (url.endsWith('/access_token')) return reply(gh.tokenAnswers.shift() ?? { error: 'authorization_pending' });
  if (url.endsWith('/user')) return reply({ login: gh.login }, gh.userStatus);
  throw new Error('unexpected ' + url);
});

const reload = vi.fn();
const confirmFn = vi.fn(() => true);

const flush = async () => { for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0); };
const text = () => document.getElementById('helm-screen')?.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#helm-screen button'));
const find = (label: string) => buttons().find((b) => b.textContent === label) ?? buttons().find((b) => b.textContent!.includes(label));
async function click(label: string) {
  const b = find(label);
  if (!b) throw new Error(`no button "${label}" on: ${text()}`);
  b.click();
  await flush();
}
const tab = async (name: 'Servers' | 'Settings') => { document.querySelector<HTMLButtonElement>(`#helm-tabs button[aria-label="${name}"]`)!.click(); await flush(); };
const activeTab = () => document.querySelector('#helm-tabs button.on')?.getAttribute('aria-label');
const typeInto = (selector: string, v: string) => { const e = document.querySelector<HTMLInputElement>(`#helm-screen ${selector}`)!; e.value = v; };

/** Starts the app (it runs on import). */
async function boot(o: { signedIn?: boolean; instances?: unknown[]; root?: boolean } = {}) {
  vi.resetModules();
  if (o.signedIn !== false) h.secrets.set('helm.github', JSON.stringify({ token: 'tok', login: 'alice' }));
  if (o.instances) h.prefs.set('helm.instances', JSON.stringify(o.instances));
  if (o.root !== false) { const r = document.createElement('div'); r.id = 'root'; document.body.append(r); }
  await import('../src/main');
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('style');
  sessionStorage.clear();
  h.prefs.clear(); h.secrets.clear();
  h.listeners = {}; h.notifListeners = {};
  h.launchUrl = undefined; h.clipboard.length = 0; h.opened.length = 0; h.minimized = 0; h.scheduled.length = 0;
  h.deviceName = 'Pixel'; h.connects.length = 0; h.connectResult = null; h.conn.close.mockClear(); h.bridges.length = 0; h.autoReady = true; h.scan = null; h.scanCalls = 0;
  h.permissions.mockClear(); h.permissions.mockImplementation(async () => ({ display: 'granted' }));
  gh.tokenAnswers = []; gh.deviceFails = false; gh.login = 'alice'; gh.userStatus = 200;
  reload.mockClear(); confirmFn.mockReset(); confirmFn.mockReturnValue(true);
  vi.stubGlobal('fetch', fetchStub);
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('confirm', confirmFn);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

// ------------------------------------------------------------------------------------------------ signing in
describe('signing in to GitHub', () => {
  it('goes straight to Servers when a sign-in is kept, with the Servers tab lit', async () => {
    await boot();
    expect(text()).toContain('Servers');
    expect(text()).toContain('Add your computer, or a helm server, to begin.');
    expect(activeTab()).toBe('Servers');
    expect(document.body.style.background).toBeTruthy();
    expect(fetchStub).toHaveBeenCalledWith('https://api.github.com/user', expect.anything());
  });

  it('shows the code, copies it, opens GitHub, and carries on to Servers once approved', async () => {
    gh.tokenAnswers = [{ error: 'authorization_pending' }, { access_token: 'gho_new' }];
    await boot({ signedIn: false });
    expect(text()).toContain('Sign in to GitHub');
    await vi.advanceTimersByTimeAsync(0);
    expect(text()).toContain('ABCD-1234');
    expect(text()).toContain('Waiting for you to approve');

    await click('Copy code');
    expect(h.clipboard).toEqual(['ABCD-1234']);
    expect(text()).toContain('Copied.');
    await click('Open GitHub');
    expect(h.opened).toEqual(['https://github.com/login/device']);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(text()).toContain('Add your computer');
    expect(JSON.parse(h.secrets.get('helm.github')!)).toEqual({ token: 'gho_new', login: 'alice' });
  });

  it('shows what went wrong and starts again on Try again', async () => {
    gh.deviceFails = true;
    await boot({ signedIn: false });
    expect(text()).toContain('Could not sign in');
    expect(text()).toContain('GitHub is down');
    gh.deviceFails = false;
    gh.tokenAnswers = [{ access_token: 'gho_again' }];
    await click('Try again');
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(text()).toContain('Add your computer');
    expect(h.secrets.get('helm.github')).toContain('gho_again');
  });
});

// ------------------------------------------------------------------------------------------------ the server list
describe('Servers', () => {
  it('lists computers and hosted servers, each with what it is', async () => {
    await boot({ instances: [desktop(), hosted()] });
    expect(text()).not.toContain('Add your computer, or a helm server');
    expect(find('Desk')!.textContent).toContain('Computer, direct');
    expect(find('Cloud')!.textContent).toContain('cloud.example');
  });

  it('opens a hosted server in the in-app browser at /mobile/ and stays on the list', async () => {
    await boot({ instances: [hosted()] });
    await click('Cloud');
    expect(h.opened).toEqual(['https://cloud.example/mobile/']);
    expect(text()).toContain('Servers');
    expect(h.bridges).toHaveLength(0);
  });

  describe('adding a helm server', () => {
    it('refuses a plain http address and shows why', async () => {
      await boot();
      await click('Add a helm server');
      expect(text()).toContain('Add a helm server');
      typeInto('input[placeholder="helm.example.com"]', 'http://example.com');
      await click('Add');
      expect(text()).toContain('must be reached over https');
      expect(saved()).toEqual([]);
    });
    it('refuses an address that is not a URL', async () => {
      await boot();
      await click('Add a helm server');
      typeInto('input[placeholder="helm.example.com"]', 'http://');
      await click('Add');
      expect(document.querySelector('#helm-screen .err')!.textContent).not.toBe('');
      expect(saved()).toEqual([]);
    });
    it('saves a valid one, trims the name, and returns to the list', async () => {
      await boot();
      await click('Add a helm server');
      typeInto('input[placeholder="Name"]', '  Work  ');
      typeInto('input[placeholder="helm.example.com"]', ' helm.work.example ');
      await click('Add');
      expect(saved()).toMatchObject([{ kind: 'hosted', name: 'Work', url: 'https://helm.work.example' }]);
      expect(find('Work')!.textContent).toContain('helm.work.example');
    });
    it('Back returns to the list', async () => {
      await boot();
      await click('Add a helm server');
      await click('Back');
      expect(text()).toContain('Add your computer');
    });
  });

  describe('adding a computer', () => {
    it('says so when the pasted text is not a share code, and does not connect', async () => {
      await boot();
      await click('Add a computer');
      typeInto('textarea', 'hello');
      await click('Continue');
      expect(document.querySelector('#helm-screen .err')!.textContent).not.toBe('');
      expect(h.connects).toHaveLength(0);
    });

    it('pairs with a valid code: sends the GitHub token and device name, saves it, and lists it', async () => {
      await boot();
      await click('Add a computer');
      typeInto('textarea', shareCode('Studio'));
      await click('Continue');
      expect(h.permissions).toHaveBeenCalled();
      expect(h.connects).toHaveLength(1);
      expect(h.connects[0].link).toMatchObject({ name: 'Pixel', githubToken: 'tok' });
      expect(h.conn.close).toHaveBeenCalled();
      expect(saved()).toMatchObject([{ kind: 'desktop', name: 'Studio' }]);
      expect(text()).toContain('Servers');
      expect(find('Studio')).toBeTruthy();
    });

    it('calls the phone "Phone" when it has no name, and goes on when notification permission fails', async () => {
      h.deviceName = '';
      h.permissions.mockImplementation(async () => { throw new Error('no'); });
      await boot();
      await click('Add a computer');
      typeInto('textarea', shareCode());
      await click('Continue');
      expect(h.connects[0].link.name).toBe('Phone');
      expect(saved()).toHaveLength(1);
    });

    it('signs in first when there is no sign-in yet, then pairs', async () => {
      await boot();
      h.secrets.delete('helm.github');
      gh.tokenAnswers = [{ access_token: 'gho_p' }];
      await click('Add a computer');
      typeInto('textarea', shareCode());
      await click('Continue');
      await vi.advanceTimersByTimeAsync(1000);
      await flush();
      expect(h.connects[0].link.githubToken).toBe('gho_p');
      expect(saved()).toHaveLength(1);
    });

    it('shows "Could not add it" when the computer does not accept, saves nothing, and offers Try again and Back', async () => {
      h.connectResult = async () => { throw new Error('Not the same GitHub user'); };
      await boot();
      await click('Add a computer');
      typeInto('textarea', shareCode());
      await click('Continue');
      expect(text()).toContain('Could not add it');
      expect(text()).toContain('Not the same GitHub user');
      expect(saved()).toEqual([]);
      await click('Try again');
      expect(text()).toContain('Add a computer');
      typeInto('textarea', shareCode());
      h.connectResult = null;
      await click('Continue');
      expect(saved()).toHaveLength(1);
    });

    it('Back from the failure page returns to Servers', async () => {
      h.connectResult = async () => { throw new Error('x'); };
      await boot();
      await click('Add a computer');
      typeInto('textarea', shareCode());
      await click('Continue');
      await click('Back');
      expect(text()).toContain('Add your computer');
    });

    it('scans a QR code and pairs with what the camera finds', async () => {
      let found!: (c: string) => void;
      h.scan = () => new Promise((r) => { found = r; });
      await boot();
      await click('Add a computer');
      await click('Scan the QR code');
      expect(text()).toContain('Scan the code');
      expect(h.scanCalls).toBe(1);
      expect(document.querySelector('#helm-screen video')).not.toBeNull();
      found(shareCode('Scanned'));
      await flush();
      expect(saved()).toMatchObject([{ name: 'Scanned' }]);
    });

    it('cancelling a scan aborts it and goes back without an error', async () => {
      let signal!: AbortSignal;
      h.scan = (_v, s) => new Promise((_res, rej) => { signal = s!; s!.addEventListener('abort', () => rej(new Error('Cancelled'))); });
      await boot();
      await click('Add a computer');
      await click('Scan the QR code');
      await click('Cancel');
      expect(signal.aborted).toBe(true);
      expect(text()).toContain('Add a computer');
      expect(document.querySelector('#helm-screen .err')!.textContent).toBe('');
    });

    // Found by this test while it was marked as a known failure: the error used to be written to a page that was drawn over at once.
    it('shows why the camera could not scan', async () => {
      h.scan = async () => { throw new Error('Permission denied'); };
      await boot();
      await click('Add a computer');
      await click('Scan the QR code');
      expect(text()).toContain('Permission denied');
    });

    it('Back returns to the list', async () => {
      await boot();
      await click('Add a computer');
      await click('Back');
      expect(text()).toContain('Add your computer');
    });
  });
});

// ------------------------------------------------------------------------------------------------ opening a computer
describe('opening a computer', () => {
  it('shows Connecting, then mounts helm and keeps the tab bar', async () => {
    h.autoReady = false;
    await boot({ instances: [desktop()] });
    await click('Desk');
    expect(text()).toContain('Connecting…');
    expect(h.bridges).toHaveLength(1);
    expect((window as any).helmBridge).toBe(h.bridges[0]);
    h.bridges[0].settle();
    await flush();
    expect(document.getElementById('helm-screen')).toBeNull();
    expect(document.getElementById('root')!.style.display).toBe('');
    expect(document.getElementById('helm-tabs')).not.toBeNull();
    expect(activeTab()).toBe('Servers');
  });

  it('connects as "Phone" with the saved key, and with no GitHub token', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await h.bridges[0].connect();
    expect(h.connects[0].link.name).toBe('Phone');
    expect(h.connects[0].link.githubToken).toBeUndefined();
    expect(Array.from(h.connects[0].link.identity.secretKey)).toEqual(Array.from(key.secretKey));
  });

  it('says it cannot reach the computer after 12 seconds, and Back restarts', async () => {
    h.autoReady = false;
    await boot({ instances: [desktop()] });
    await click('Desk');
    await vi.advanceTimersByTimeAsync(11_900);
    expect(text()).toContain('Connecting…');
    await vi.advanceTimersByTimeAsync(200);
    expect(text()).toContain('Cannot reach it');
    expect(text()).toContain('Desk did not answer');
    await click('Back');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('Keep trying reloads once the computer does answer', async () => {
    h.autoReady = false;
    await boot({ instances: [desktop()] });
    await click('Desk');
    await vi.advanceTimersByTimeAsync(13_000);
    await click('Keep trying');
    expect(reload).not.toHaveBeenCalled();
    h.bridges[0].settle();
    await flush();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('Back while connecting reloads', async () => {
    h.autoReady = false;
    await boot({ instances: [desktop()] });
    await click('Desk');
    await click('Back');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps addresses the computer announces', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    h.connects.length = 0;
    await h.bridges[0].connect();
    h.connects[0].hooks.candidates(4242, ['9.9.9.9']);
    await flush();
    expect(JSON.parse(h.prefs.get('helm.instances')!)[0].code).not.toBe(desktop().code);
  });

  it('shows a notice the computer sends as a local notification, once, and remembers it', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await h.bridges[0].connect();
    const ack = vi.fn();
    const n = { id: 'n1', kind: 'attention', title: 'Approve?', body: 'A command', silent: false, sessionId: 's9', at: 1 };
    h.connects[0].hooks.notices([n], ack);
    await flush();
    h.connects[0].hooks.notices([n], ack);
    await flush();
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].notifications[0]).toMatchObject({ title: 'Approve?', body: 'A command', extra: { instance: 'd1', session: 's9', kind: 'attention' } });
    expect(ack).toHaveBeenCalledTimes(2);
    expect(ack).toHaveBeenCalledWith(['n1']);
    expect(JSON.parse(h.prefs.get('helm.seenNotices')!)).toEqual(['n1']);
  });
});

// ------------------------------------------------------------------------------------------------ the tabs
describe('the tab bar', () => {
  it('Settings while inside a computer keeps it connected, and Servers brings it back', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    expect(h.bridges).toHaveLength(1);
    await tab('Settings');
    expect(text()).toContain('Settings');
    expect(activeTab()).toBe('Settings');
    expect(document.getElementById('root')!.style.display).toBe('none');
    expect(reload).not.toHaveBeenCalled();
    await tab('Servers');
    expect(document.getElementById('helm-screen')).toBeNull();
    expect(document.getElementById('root')!.style.display).toBe('');
    expect(activeTab()).toBe('Servers');
    expect(reload).not.toHaveBeenCalled();
    expect(h.bridges).toHaveLength(1);
  });

  it('Servers again while inside the computer reloads to the list', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await tab('Servers');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('Servers from Settings with nothing open shows the list', async () => {
    await boot({ instances: [desktop()] });
    await tab('Settings');
    expect(text()).toContain('Settings');
    await tab('Servers');
    expect(text()).toContain('Servers');
    expect(find('Desk')).toBeTruthy();
    expect(activeTab()).toBe('Servers');
  });

  it('works without helm\'s own #root on the page', async () => {
    await boot({ root: false });
    await tab('Settings');
    expect(text()).toContain('Settings');
  });
});

// ------------------------------------------------------------------------------------------------ settings
describe('Settings', () => {
  it('names the GitHub account and lists the connections', async () => {
    await boot({ instances: [desktop(), hosted()] });
    await tab('Settings');
    expect(text()).toContain('Signed in to GitHub as alice');
    expect(text()).toContain('Desk');
    expect(text()).toContain('Computer, direct');
    expect(text()).toContain('cloud.example');
  });

  it('says so when there are no connections, and when not signed in', async () => {
    await boot();
    h.secrets.delete('helm.github');
    await tab('Settings');
    expect(text()).toContain('Not signed in to GitHub');
    expect(text()).toContain('No computers or servers yet.');
  });

  it('Log out asks first, then deletes the sign-in and restarts the page', async () => {
    await boot();
    await tab('Settings');
    confirmFn.mockReturnValue(false);
    await click('Log out');
    expect(h.secrets.has('helm.github')).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    confirmFn.mockReturnValue(true);
    await click('Log out');
    expect(confirmFn).toHaveBeenLastCalledWith(expect.stringContaining('Log out of GitHub'));
    expect(h.secrets.has('helm.github')).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('Remove asks first, then forgets that connection and redraws', async () => {
    await boot({ instances: [desktop('d1', 'Desk'), hosted()] });
    await tab('Settings');
    confirmFn.mockReturnValue(false);
    await click('Remove');
    expect(saved()).toHaveLength(2);
    confirmFn.mockReturnValue(true);
    await click('Remove');
    expect(confirmFn).toHaveBeenLastCalledWith(expect.stringContaining('Remove Desk'));
    expect(saved().map((i: any) => i.id)).toEqual(['h1']);
    expect(text()).not.toContain('Computer, direct');
    expect(reload).not.toHaveBeenCalled();
  });

  it('removing the computer that is open restarts the page', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await tab('Settings');
    await click('Remove');
    expect(saved()).toEqual([]);
    expect(reload).toHaveBeenCalledOnce();
  });
});

// ------------------------------------------------------------------------------------------------ tapped notifications
const link = (instance: string, session = 's1', kind = 'attention') => `helm://open?instance=${instance}&session=${session}&kind=${kind}`;

describe('tapping a notification', () => {
  it('opens that computer and then the session when nothing is open (link from Android)', async () => {
    await boot({ instances: [desktop()] });
    h.listeners.appUrlOpen({ url: link('d1', 's7', 'done') });
    await flush();
    expect(h.bridges).toHaveLength(1);
    expect(h.bridges[0].open).toHaveBeenCalledExactlyOnceWith('s7', 'done');
    expect(activeTab()).toBe('Servers');
  });

  it('goes to the session in place when that computer is already open (extra from iOS), even from Settings', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await tab('Settings');
    h.notifListeners.localNotificationActionPerformed({ notification: { extra: { instance: 'd1', session: 's3', kind: 'attention' } } });
    await flush();
    expect(h.bridges).toHaveLength(1);
    expect(h.bridges[0].open).toHaveBeenCalledWith('s3', 'attention');
    expect(document.getElementById('root')!.style.display).toBe('');
    expect(reload).not.toHaveBeenCalled();
  });

  it('for another computer, remembers the target and reloads the page', async () => {
    await boot({ instances: [desktop('d1', 'One'), desktop('d2', 'Two')] });
    await click('One');
    h.listeners.appUrlOpen({ url: link('d2', 's2', 'k') });
    await flush();
    expect(reload).toHaveBeenCalledOnce();
    expect(JSON.parse(sessionStorage.getItem('helm.pendingOpen')!)).toEqual({ instance: 'd2', session: 's2', kind: 'k' });
    expect(h.bridges).toHaveLength(1);
  });

  it('ignores a computer that has been removed, a hosted server, and links that are not helm\'s', async () => {
    await boot({ instances: [desktop(), hosted()] });
    h.listeners.appUrlOpen({ url: link('gone') });
    h.listeners.appUrlOpen({ url: link('h1') });
    h.listeners.appUrlOpen({ url: 'https://example.com/' });
    h.listeners.appUrlOpen({ url: undefined });
    h.notifListeners.localNotificationActionPerformed({ notification: { extra: {} } });
    h.notifListeners.localNotificationActionPerformed({ notification: {} });
    await flush();
    expect(h.bridges).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
    expect(text()).toContain('Servers');
  });
});

describe('starting up', () => {
  it('takes the target left by a reload, once', async () => {
    sessionStorage.setItem('helm.pendingOpen', JSON.stringify({ instance: 'd1', session: 's5', kind: 'attention' }));
    await boot({ instances: [desktop()] });
    expect(h.bridges).toHaveLength(1);
    expect(h.bridges[0].open).toHaveBeenCalledWith('s5', 'attention');
    expect(sessionStorage.getItem('helm.pendingOpen')).toBeNull();
  });

  it('takes the link the app was launched with', async () => {
    h.launchUrl = link('d1', 's8', 'done');
    await boot({ instances: [desktop()] });
    expect(h.bridges[0].open).toHaveBeenCalledWith('s8', 'done');
  });

  it('prefers the pending target over the launch link', async () => {
    sessionStorage.setItem('helm.pendingOpen', JSON.stringify({ instance: 'd1', session: 'pending', kind: 'k' }));
    h.launchUrl = link('d1', 'launch');
    await boot({ instances: [desktop()] });
    expect(h.bridges[0].open).toHaveBeenCalledExactlyOnceWith('pending', 'k');
  });

  it('stays on the list with neither', async () => {
    await boot({ instances: [desktop()] });
    expect(h.bridges).toHaveLength(0);
    expect(text()).toContain('Servers');
  });
});

// ------------------------------------------------------------------------------------------------ the Android back button
describe('the back button', () => {
  it('minimizes the app from the list', async () => {
    await boot();
    h.listeners.backButton({});
    await flush();
    expect(h.minimized).toBe(1);
  });

  it('leaves a sub-screen for the list first, then minimizes', async () => {
    await boot();
    await click('Add a computer');
    h.listeners.backButton({});
    await flush();
    expect(text()).toContain('Add your computer, or a helm server');
    expect(h.minimized).toBe(0);
    h.listeners.backButton({});
    expect(h.minimized).toBe(1);
  });

  it('leaves Settings for the list', async () => {
    await boot();
    await tab('Settings');
    h.listeners.backButton({});
    await flush();
    expect(text()).toContain('Add your computer');
    expect(activeTab()).toBe('Servers');
  });

  it('leaves Settings for the open computer', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    await tab('Settings');
    h.listeners.backButton({});
    await flush();
    expect(document.getElementById('helm-screen')).toBeNull();
    expect(document.getElementById('root')!.style.display).toBe('');
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the open computer by restarting to the list', async () => {
    await boot({ instances: [desktop()] });
    await click('Desk');
    h.listeners.backButton({});
    await flush();
    expect(reload).toHaveBeenCalledOnce();
  });
});
