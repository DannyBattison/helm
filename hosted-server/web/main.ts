import { createBridge } from './bridge';

const root = () => document.getElementById('root')!;

/** A centred message with optional extras, built with textContent (nothing here is HTML). */
function screen(title: string, lines: (string | HTMLElement)[]) {
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:12px;max-width:380px;margin:18vh auto;padding:0 20px;font:14px/1.5 system-ui;color:#e4e4ec';
  const h = document.createElement('strong');
  h.style.fontSize = '18px';
  h.textContent = title;
  box.append(h);
  for (const l of lines) {
    if (typeof l === 'string') { const p = document.createElement('span'); p.style.color = '#b4b4c0'; p.textContent = l; box.append(p); } else box.append(l);
  }
  root().replaceChildren(box);
}
const button = (label: string, onclick: () => void, href?: string) => {
  const b = document.createElement(href ? 'a' : 'button') as HTMLElement;
  b.style.cssText = 'padding:9px 12px;border-radius:8px;border:0;background:#7c5cff;color:white;text-align:center;text-decoration:none;cursor:pointer;font:inherit';
  b.textContent = label;
  if (href) { (b as HTMLAnchorElement).href = href; (b as HTMLAnchorElement).target = '_blank'; (b as HTMLAnchorElement).rel = 'noopener'; }
  b.onclick = onclick;
  return b;
};
const post = (path: string, body: unknown = {}) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

/** Signs in with GitHub (device flow): shows a code to enter on github.com, and resolves once the server has set the cookie. */
async function signIn(note = ''): Promise<void> {
  for (;;) {
    await new Promise<void>((go) => screen('helm', [note || 'Sign in with GitHub to continue. Only your username is read, and only people on this server\'s list get in.', button('Continue with GitHub', go)]));
    const start = await post('/auth/device/start');
    if (start.status !== 200) { note = start.json.error || 'Could not reach GitHub. Try again.'; continue; }
    const link = button('Open github.com/login/device', () => undefined, start.json.verificationUri);
    const code = document.createElement('div');
    code.style.cssText = 'font:700 28px ui-monospace,monospace;letter-spacing:.12em;text-align:center;padding:16px;border:1px dashed #3c3c47;border-radius:10px;user-select:all';
    code.textContent = start.json.userCode;
    screen('Enter this code on GitHub', [code, link, 'Waiting for you to approve it…']);
    const until = Date.now() + start.json.expiresIn * 1000;
    let result = '';
    while (Date.now() < until && !result) {
      await new Promise((r) => setTimeout(r, Math.max(2, start.json.interval) * 1000));
      const p = await post('/auth/device/poll', { ticket: start.json.ticket });
      const s = p.json.status;
      if (s === 'ok') return;
      if (s === 'forbidden') result = `@${p.json.login} is not on this server's list of allowed users.`;
      else if (s === 'denied') result = 'You declined the sign-in.';
      else if (s === 'expired' || s === 'error') result = 'The sign-in did not finish. Try again.';
    }
    note = result || 'That code expired. Try again.';
  }
}

async function boot() {
  document.body.style.background = '#0e0e12';
  const me = await fetch('/auth/me', { credentials: 'same-origin' }).catch(() => null);
  if (!me || me.status === 401) await signIn();
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  // Signed out later (the cookie expired, or the username was taken off the list): start again from the sign-in screen.
  (window as any).helmBridge = createBridge(url, () => location.reload());
  await (window as any).helmBridge.ready;
  // The desktop renderer, as is. It only talks to `window.helmBridge`.
  await import('../../src/renderer/src/main');
}
void boot();
