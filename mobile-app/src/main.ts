import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Device } from '@capacitor/device';
import { LocalNotifications } from '@capacitor/local-notifications';
import { createConnectionBridge } from '../../hosted/web/bridge';
import { DEFAULT_GITHUB_CLIENT_ID } from '../../src/shared/githubApp';
import { decodeShareCode } from '../../src/shared/p2p/sharecode';
import { startDeviceFlow, waitForToken } from './github';
import { Instances } from './instances';
import type { Instance } from './instances';
import { capacitorUdp, preferences } from './native';
import { loadSeen, saveSeen, showNew } from './notices';
import type { Notice } from './notices';
import { connectDesktop } from './p2pConn';
import { fromExtra, parseOpenUrl, plan } from './open';
import type { Target } from './open';
import { scanShareCode } from './scan';
import { el, hide, show } from './ui';

const instances = new Instances(preferences);
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
  show(el('h1', 'helm'), all.length ? '' : 'Add your computer, or a helm server, to begin.', ...rows, el('button', 'Add a computer', 'primary', () => addComputer()), el('button', 'Add a helm server', '', () => addServer()));
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

/** GitHub sign-in to prove this is the same person as the one signed in on the computer, then the first connection that pairs the phone. */
async function pair(code: string) {
  const prepared = instances.prepareDesktop(code);
  await LocalNotifications.requestPermissions().catch(() => undefined);
  show(el('h1', 'Sign in to GitHub'), 'Use the same GitHub account as on your computer. This asks for no permissions: it only shows your computer who you are.', 'Contacting GitHub…');
  const flow = await startDeviceFlow(DEFAULT_GITHUB_CLIENT_ID);
  show(el('h1', 'Sign in to GitHub'), 'Open GitHub and enter this code.', el('div', flow.userCode, 'code'), el('button', 'Open GitHub', 'primary', () => void Browser.open({ url: flow.verificationUri })));
  const token = await waitForToken(DEFAULT_GITHUB_CLIENT_ID, flow);
  show(el('h1', 'Connecting…'), `Reaching ${prepared.name}.`);
  const conn = await connectDesktop(capacitorUdp, { code: prepared.code, identity: prepared.identity, name: await deviceName(), githubToken: token })();
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
  await home();
  // A page reload to switch computers leaves the target here; a launch by tapping a notification leaves it as the launch link.
  const pending = sessionStorage.getItem('helm.pendingOpen');
  sessionStorage.removeItem('helm.pendingOpen');
  const t = pending ? (JSON.parse(pending) as Target) : parseOpenUrl((await App.getLaunchUrl())?.url);
  if (t) await goTo(t);
})();
