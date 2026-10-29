import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Clipboard } from '@capacitor/clipboard';
import { Device } from '@capacitor/device';
import { LocalNotifications } from '@capacitor/local-notifications';
import { createConnectionBridge } from '../../hosted/web/bridge';
import { DEFAULT_GITHUB_CLIENT_ID } from '../../src/shared/githubApp';
import { decodeShareCode } from '../../src/shared/p2p/sharecode';
import { Instances } from './instances';
import type { Instance } from './instances';
import { capacitorUdp, preferences, secrets } from './native';
import { loadSeen, saveSeen, showNew } from './notices';
import type { Notice } from './notices';
import { connectDesktop } from './p2pConn';
import { fromExtra, parseOpenUrl, plan } from './open';
import type { Target } from './open';
import { scanShareCode } from './scan';
import { Account } from './session';
import type { Signed } from './session';
import { back, tapTab } from './nav';
import type { View } from './nav';
import { el, hide, hideTabs, show, showTabs } from './ui';

const instances = new Instances(preferences);
const account = new Account(secrets, DEFAULT_GITHUB_CLIENT_ID);
document.body.style.background = '#0e0e12';

/** Puts a notification on the screen. */
async function notify(n: Notice & { instanceId?: string }) {
  await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 30), title: n.title, body: n.body, extra: { instance: n.instanceId, session: n.sessionId, kind: n.kind }, schedule: { at: new Date(Date.now() + 100) } }] });
}

// ------------------------------------------------------------------------------------------------ where we are
let view: View = 'servers';
/** True on the screens inside Servers (adding a computer, connecting): the back button goes out of them first. */
let sub = false;

/** Shows the right screen for `v` and lights its tab. A computer's own UI is the page's `#root`; the other screens are drawn over it. */
function enter(v: View) {
  view = v;
  const root = document.getElementById('root');
  if (root) root.style.display = v === 'instance' ? '' : 'none';
  if (v === 'instance') hide();
  showTabs(v === 'settings' ? 'settings' : 'servers', (t) => {
    const m = tapTab(view, t, openNow !== null && openBridge !== null);
    if (m.reload) { location.reload(); return; }
    if (m.view === 'instance') enter('instance');
    else if (m.view === 'settings') void settings();
    else void home();
  });
}

// ------------------------------------------------------------------------------------------------ a tapped notification
let openNow: string | null = null;
let openBridge: { open(session: string, kind: string): void } | null = null;

/** Takes you to the session a notification was about: now if that computer is already open, else after opening it. */
async function goTo(t: Target) {
  const known = await instances.list();
  const what = plan(t, known, openNow);
  if (what === 'ignore') return;
  if (what === 'go') { enter('instance'); openBridge?.open(t.session, t.kind); return; }
  const inst = known.find((i) => i.id === t.instance)!;
  if (openNow) { sessionStorage.setItem('helm.pendingOpen', JSON.stringify(t)); location.reload(); return; }
  await openInstance(inst, t);
}

// ------------------------------------------------------------------------------------------------ GitHub, once
/** Signs in to GitHub and keeps it. The code can be copied; GitHub's page asks for it. */
async function signIn(): Promise<Signed> {
  for (;;) {
    show(el('h1', 'Sign in to GitHub'), 'Helm uses your GitHub account to make sure only you can connect to your computers. It asks for no permissions: it only learns your username.', 'Contacting GitHub…');
    try {
      return await account.signIn((flow) => {
        const copied = el('p', '');
        show(el('h1', 'Sign in to GitHub'), 'Copy this code, then open GitHub and paste it.', el('div', flow.userCode, 'code'),
          el('button', 'Copy code', '', async () => { await Clipboard.write({ string: flow.userCode }); copied.textContent = 'Copied.'; }),
          el('button', 'Open GitHub', 'primary', () => void Browser.open({ url: flow.verificationUri })), copied, 'Waiting for you to approve…');
      });
    } catch (e: any) {
      await new Promise<void>((retry) => show(el('h1', 'Could not sign in'), el('p', String(e?.message || e), 'err'), el('button', 'Try again', 'primary', () => retry())));
    }
  }
}

/** The signed-in account, signing in first if there is none. */
async function who(): Promise<Signed> { return (await account.current()) ?? (await signIn()); }

// ------------------------------------------------------------------------------------------------ servers
async function home() {
  sub = false;
  enter('servers');
  const all = await instances.list();
  const rows = all.map((i) => {
    const open = el('button', `${i.name}`, '', () => void openInstance(i));
    const kind = el('p', i.kind === 'desktop' ? 'Computer, direct' : new URL(i.url).host);
    kind.style.fontSize = '12px';
    open.append(document.createElement('br'), kind);
    return open;
  });
  show(el('h1', 'Servers'), all.length ? '' : 'Add your computer, or a helm server, to begin.', ...rows, el('button', 'Add a computer', 'primary', () => addComputer()), el('button', 'Add a helm server', '', () => addServer()));
}

// ------------------------------------------------------------------------------------------------ settings: connections, and logging out
async function settings() {
  sub = false;
  enter('settings');
  const all = await instances.list();
  const me = await account.current();
  const items = all.map((i) => {
    const text = el('div', i.name);
    text.append(el('small', i.kind === 'desktop' ? 'Computer, direct' : new URL(i.url).host));
    const row = el('div', '', 'item');
    row.append(text, el('button', 'Remove', 'danger', async () => {
      if (!confirm(`Remove ${i.name}? You can add it again with a new code.`)) return;
      await instances.remove(i.id);
      if (openNow === i.id) { location.reload(); return; }
      void settings();
    }));
    return row;
  });
  show(el('h1', 'Settings'), el('p', 'Account', 'sec'),
    el('div', me ? `Signed in to GitHub as ${me.login}` : 'Not signed in to GitHub', 'item'),
    el('button', 'Log out', 'danger', async () => {
      if (!confirm('Log out of GitHub? You will need to sign in again to use the app.')) return;
      await account.signOut();
      // A computer that is open stays connected until the page restarts; restarting lands on the sign-in screen.
      location.reload();
    }),
    el('p', 'Connections', 'sec'), ...(items.length ? items : ['No computers or servers yet.']));
}

// ------------------------------------------------------------------------------------------------ adding
function addServer() {
  sub = true;
  const name = el('input'); name.placeholder = 'Name';
  const url = el('input'); url.placeholder = 'helm.example.com'; url.inputMode = 'url'; url.autocapitalize = 'off';
  const err = el('p', '', 'err');
  show(el('h1', 'Add a helm server'), 'A helm you host yourself, reached over https.', name, url, err,
    el('button', 'Add', 'primary', async () => { try { await instances.addHosted(name.value.trim(), url.value.trim()); void home(); } catch (e: any) { err.textContent = String(e?.message || e); } }),
    el('button', 'Back', '', () => void home()));
}

/** `problem` is shown under the paste box: why the last attempt (a camera scan) did not work. */
function addComputer(problem = '') {
  sub = true;
  const paste = el('textarea'); paste.placeholder = 'HELM1-…';
  const err = el('p', problem, 'err');
  const go = (code: string) => void pair(code).catch((e) => { show(el('h1', 'Could not add it'), el('p', String(e?.message || e), 'err'), el('button', 'Try again', 'primary', () => addComputer()), el('button', 'Back', '', () => void home())); });
  const scan = el('button', 'Scan the QR code', 'primary', () => {
    const video = document.createElement('video');
    const cancel = new AbortController();
    show(el('h1', 'Scan the code'), 'Point the camera at the QR code in helm on your computer: Settings → Phone app.', video, el('button', 'Cancel', '', () => { cancel.abort(); addComputer(); }));
    scanShareCode(video, cancel.signal).then(go, (e) => { if (!cancel.signal.aborted) addComputer(String(e?.message || e)); });
  });
  show(el('h1', 'Add a computer'), 'In helm on your computer, open Settings → Phone app and turn it on.', scan, 'Or paste the code:', paste, err,
    el('button', 'Continue', '', () => { try { decodeShareCode(paste.value); go(paste.value); } catch (e: any) { err.textContent = String(e?.message || e); } }),
    el('button', 'Back', '', () => void home()));
}

/** The first connection to a computer, which pairs this phone with it: it needs the GitHub sign-in, to show the computer who this is. */
async function pair(code: string) {
  const prepared = instances.prepareDesktop(code);
  await LocalNotifications.requestPermissions().catch(() => undefined);
  const me = await who();
  show(el('h1', 'Connecting…'), `Reaching ${prepared.name} as ${me.login}.`);
  const conn = await connectDesktop(capacitorUdp, { code: prepared.code, identity: prepared.identity, name: await deviceName(), githubToken: me.token })();
  conn.close();
  await instances.finishDesktop(prepared);
  void home();
}

const deviceName = async () => (await Device.getInfo()).name || 'Phone';

// ------------------------------------------------------------------------------------------------ opening
async function openInstance(i: Instance, then?: Target) {
  // A hosted server keeps its own sign-in (cookies), so it opens in the system's in-app browser; Done comes back here, tabs and all.
  if (i.kind === 'hosted') { await Browser.open({ url: `${i.url}/mobile/` }); return; }
  sub = true;
  show(el('h1', i.name), 'Connecting…', el('button', 'Back', '', () => location.reload()));
  const seen = await loadSeen(preferences);
  const bridge = createConnectionBridge(connectDesktop(capacitorUdp, { code: i.code, identity: instances.identityOf(i), name: 'Phone' }, {
    candidates: (p, c) => void instances.updateAddresses(i.id, p, c),
    notices: (items, ack) => void showNew(items, ack, (n) => notify({ ...n, instanceId: i.id }), seen).then(() => saveSeen(preferences, seen))
  }));
  (window as any).helmBridge = bridge;
  openNow = i.id;
  openBridge = bridge;
  const reached = await Promise.race([bridge.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 12_000))]);
  if (!reached) {
    show(el('h1', 'Cannot reach it'), `${i.name} did not answer. Is helm running there with Phone app turned on, and is the phone on a network that can reach it? If its address changed, add it again with a new code.`,
      el('button', 'Keep trying', 'primary', () => void bridge.ready.then(() => location.reload())), el('button', 'Back', '', () => location.reload()));
    return;
  }
  sub = false;
  enter('instance');
  await import('../../src/renderer/src/main');
  if (then) bridge.open(then.session, then.kind);
}

void App.addListener('backButton', () => {
  const m = back(view, openNow !== null, sub);
  if (m === 'minimize') { void App.minimizeApp(); return; }
  if (m.reload) { location.reload(); return; }
  if (m.view === 'instance') enter('instance'); else if (m.view === 'settings') void settings(); else void home();
});
// Android's background task puts a link in its notification; both platforms' notifications put the same fields in `extra`.
void App.addListener('appUrlOpen', (e) => { const t = parseOpenUrl(e.url); if (t) void goTo(t); });
void LocalNotifications.addListener('localNotificationActionPerformed', (e) => { const t = fromExtra(e.notification.extra); if (t) void goTo(t); });

void (async () => {
  // Signing in comes first: nothing here works without it.
  await who();
  await home();
  // A page reload to switch computers leaves the target here; a launch by tapping a notification leaves it as the launch link.
  const pending = sessionStorage.getItem('helm.pendingOpen');
  sessionStorage.removeItem('helm.pendingOpen');
  const t = pending ? (JSON.parse(pending) as Target) : parseOpenUrl((await App.getLaunchUrl())?.url);
  if (t) await goTo(t);
})();
