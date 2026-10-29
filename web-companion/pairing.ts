/**
 * The page before helm itself: sign in with GitHub, then enter the code helm shows on your computer. Resolves once this browser is paired
 * with a computer that is online; from then on a reload goes straight through. Plain DOM, because it runs before the app's UI exists.
 */
type Me = { login: string; avatar: string; paired: boolean; online: boolean };

const post = (path: string, body: unknown = {}) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function me(): Promise<Me | null> {
  const r = await fetch('/auth/me', { credentials: 'same-origin' }).catch(() => null);
  return r?.ok ? r.json() : null;
}

const STYLE = `
.pair{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#0e0e12;color:#e8e8ee;font:15px/1.5 system-ui,sans-serif;padding:24px}
.pair main{width:100%;max-width:360px;display:flex;flex-direction:column;gap:14px;text-align:center}
.pair h1{font-size:20px;margin:0}.pair p{margin:0;color:#a0a0b0}.pair .err{color:#f87171}
.pair button,.pair input{font:inherit;border-radius:10px;border:1px solid #2a2a36;padding:12px 14px;background:#1a1a22;color:inherit}
.pair button.primary{background:#a78bfa;color:#14101f;border:0;font-weight:600}.pair button:disabled{opacity:.5}
.pair input{text-align:center;letter-spacing:.2em;text-transform:uppercase;font:600 22px ui-monospace,monospace}
.pair .code{font:700 28px ui-monospace,monospace;letter-spacing:.12em;user-select:all}
`;

export async function pair(): Promise<void> {
  const style = document.createElement('style');
  style.textContent = STYLE;
  const root = document.createElement('div');
  root.className = 'pair';
  document.head.append(style);
  document.body.append(root);
  const main = (...nodes: (Node | string)[]) => { const m = document.createElement('main'); m.append(...nodes); root.replaceChildren(m); };
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };

  for (;;) {
    const who = await me();
    if (who?.paired && who.online) break;
    if (!who) await signIn(main, el);
    else if (!who.paired) await enterCode(main, el, who);
    else await waitForComputer(main, el);
  }
  root.remove();
  style.remove();
}

type Main = (...n: (Node | string)[]) => void;
type El = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) => HTMLElementTagNameMap[K];

async function signIn(main: Main, el: El) {
  const go = el('button', 'Sign in with GitHub', 'primary');
  const err = el('p', '', 'err');
  main(el('h1', 'helm companion'), el('p', 'Use your helm computer from this browser.'), go, err);
  await new Promise<void>((done) => {
    go.onclick = async () => {
      go.disabled = true;
      err.textContent = '';
      const r = await post('/auth/device/start').catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : {};
      if (!j.ticket) { err.textContent = j.error || 'Could not reach the relay.'; go.disabled = false; return; }
      const open = el('button', 'Open GitHub', 'primary');
      open.onclick = () => window.open(j.verificationUri, '_blank', 'noopener');
      main(el('h1', 'Sign in with GitHub'), el('p', 'Open GitHub and enter this code. It asks for no permissions: it only tells helm which username you are.'), el('div', j.userCode, 'code'), open, err);
      const until = Date.now() + j.expiresIn * 1000;
      while (Date.now() < until) {
        await sleep(Math.max(2, j.interval) * 1000);
        const p = await (await post('/auth/device/poll', { ticket: j.ticket }).catch(() => null))?.json().catch(() => ({}));
        if (p?.status === 'ok') return done();
        if (p && ['denied', 'expired', 'error'].includes(p.status)) break;
      }
      err.textContent = 'The sign-in did not finish. Try again.';
      done();
    };
  });
}

async function enterCode(main: Main, el: El, who: Me) {
  const input = el('input');
  input.placeholder = 'XXXX-XXXX';
  input.autocomplete = 'off';
  input.autocapitalize = 'characters';
  input.maxLength = 9;
  const go = el('button', 'Pair', 'primary');
  const out = el('button', `Not ${who.login}? Sign out`);
  const err = el('p', '', 'err');
  main(el('h1', 'Enter the code'), el('p', `Signed in as ${who.login}. In helm on your computer, open Settings → Browser companion and type the code shown there.`), input, go, err, out);
  input.focus();
  await new Promise<void>((done) => {
    const submit = async () => {
      go.disabled = true;
      const r = await post('/auth/pair', { code: input.value }).catch(() => null);
      if (r?.ok) return done();
      err.textContent = (await r?.json().catch(() => ({})))?.error || 'Could not reach the relay.';
      go.disabled = false;
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') void submit(); };
    out.onclick = async () => { await post('/auth/logout'); done(); };
  });
}

async function waitForComputer(main: Main, el: El) {
  const forget = el('button', 'Pair a different computer');
  main(el('h1', 'Your computer is offline'), el('p', 'Open helm on it and make sure the browser companion is turned on. This page carries on by itself.'), forget);
  await new Promise<void>((done) => {
    forget.onclick = async () => { await post('/auth/logout'); done(); };
    const poll = async () => { if (!forget.isConnected) return; const w = await me(); if (!w || (w.paired && w.online)) return done(); setTimeout(poll, 4000); };
    setTimeout(poll, 4000);
  });
}
