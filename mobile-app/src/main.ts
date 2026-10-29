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
import { el, hide, show } from './ui';

const instances = new Instances(preferences);
const account = new Account(secrets, DEFAULT_GITHUB_CLIENT_ID);
document.body.style.background = '#0e0e12';

/** Puts a notification on the screen. */
async function notify(n: Notice & { instanceId?: string }) {
  await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 30), title: n.title, body: n.body, extra: { instance: n.instanceId, session: n.sessionId, kind: n.kind }, schedule: { at: new Date(Date.now() + 100) } }] });
}

// ------------------------------------------------------------------------------------------------ a tapped notification
let openNow: string | null = null;
let openBridge: { open(session: string, kind: string): void } | null = null;

/** Takes you to the session a notification was about: now if that computer is already open, else after opening it. */
async function goTo(t: Target) {
  const known = await instances.list();
  const what = plan(t, known, openNow);
  if (what === 'ignore') return;
  if (what === 'go') { openBridge?.open(t.session, t.kind); return; }
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

// ------------------------------------------------------------------------------------------------ the list
async function home() {
  const all = await instances.list();
  const rows = all.map((i) => {
    const open = el('button', `${i.name}`, '', () => void openInstance(i));
    const kind = el('p', i.kind === 'desktop' ? 'Computer, direct' : new URL(i.url).host);
    kind.style.fontSize = '12px';
    open.append(document.createElement('br'), kind);
    const row = el('div', '', 'row');
    row.append(open, el('button', '✕', '', async () => { if (confirm(`Remove ${i.name}?`)) { await instances.remove(i.id); void home(); } }));
    return row;
  });
  const me = await account.current();
  show(el('h1', 'helm'), all.length ? '' : 'Add your computer, or a helm server, to begin.', ...rows, el('button', 'Add a computer', 'primary', () => addComputer()), el('button', 'Add a helm server', '', () => addServer()),
    el('button', me ? `Signed in as ${me.login} · Sign out` : 'Sign in to GitHub', '', async () => { if (me) { if (confirm('Sign out of GitHub? You will need to sign in again to add a computer.')) { await account.signOut(); void home(); } } else { await signIn(); void home(); } }));
}

// ------------------------------------------------------------------------------------------------ adding
function addServer() {
  const name = el('input'); name.placeholder = 'Name';
  const url = el('input'); url.placeholder = 'helm.example.com'; url.inputMode = 'url'; url.autocapitalize = 'off';
  const err = el('p', '', 'err');
  show(el('h1', 'Add a helm server'), 'A helm you host yourself, reached over https.', name, url, err,
    el('button', 'Add', 'primary', async () => { try { await instances.addHosted(name.value.trim(), url.value.trim()); void home(); } catch (e: any) { err.textContent = String(e?.message || e); } }),
    el('button', 'Back', '', () => void home()));
}

function addComputer() {
  const paste = el('textarea'); paste.placeholder = 'HELM1-…';
  const err = el('p', '', 'err');
  const go = (code: string) => void pair(code).catch((e) => { show(el('h1', 'Could not add it'), el('p', String(e?.message || e), 'err'), el('button', 'Try again', 'primary', () => addComputer()), el('button', 'Back', '', () => void home())); });
  const scan = el('button', 'Scan the QR code', 'primary', () => {
    const video = document.createElement('video');
    const cancel = new AbortController();
    show(el('h1', 'Scan the code'), 'Point the camera at the QR code in helm on your computer: Settings → Phone app.', video, el('button', 'Cancel', '', () => { cancel.abort(); addComputer(); }));
    scanShareCode(video, cancel.signal).then(go, (e) => { if (!cancel.signal.aborted) { err.textContent = String(e?.message || e); addComputer(); } });
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
  if (i.kind === 'hosted') { location.href = `${i.url}/mobile/`; return; }
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
  hide();
  await import('../../src/renderer/src/main');
  if (then) bridge.open(then.session, then.kind);
  // A way back to the list. Helm's own screens use the whole window.
  const chip = el('button', '⇄', 'chip', () => location.reload());
  chip.setAttribute('aria-label', 'Switch computer');
  document.body.append(chip);
}

void App.addListener('backButton', () => { if (!document.getElementById('helm-screen')) location.reload(); else void home(); });
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
