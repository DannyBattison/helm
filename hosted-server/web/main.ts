import { createBridge } from './bridge';

const KEY = 'helm-hosted-token';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v: string | null) => { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* private mode */ } };

function askToken(message: string): Promise<string> {
  return new Promise((resolve) => {
    const root = document.getElementById('root')!;
    root.innerHTML = '';
    const form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:10px;max-width:320px;margin:20vh auto;font:14px system-ui;color:#e4e4ec';
    form.innerHTML = '<strong>helm</strong><span></span><input type="password" autocomplete="current-password" style="padding:8px;border-radius:6px;border:1px solid #3c3c47;background:#16161c;color:inherit"><button style="padding:8px;border-radius:6px;border:0;background:#7c5cff;color:white">Continue</button>';
    form.querySelector('span')!.textContent = message;
    form.onsubmit = (e) => { e.preventDefault(); resolve(form.querySelector('input')!.value); };
    root.appendChild(form);
    form.querySelector('input')!.focus();
  });
}

async function boot() {
  document.body.style.background = '#0e0e12';
  let token = read() || (await askToken('Access token'));
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  for (;;) {
    const refused = new Promise<'refused'>((r) => { (window as any).helmBridge = createBridge(url, token, () => r('refused')); });
    const first = await Promise.race([(window as any).helmBridge.ready.then(() => 'ok' as const), refused]);
    if (first === 'ok') break;
    write(null);
    token = await askToken('That token was not accepted.');
  }
  write(token);
  // The desktop renderer, as is. It only talks to `window.helmBridge`.
  await import('../../src/renderer/src/main');
}
void boot();
