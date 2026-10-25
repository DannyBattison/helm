import { createBridge } from './bridge';

async function boot() {
  document.body.style.background = '#0e0e12';
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  (window as any).helmBridge = createBridge(url);
  await (window as any).helmBridge.ready;
  // The desktop renderer, as is. It only talks to `window.helmBridge`, and it shows its own GitHub sign-in when nobody is signed in:
  // on this server that screen is the only login, and the server checks the username against its allow list.
  await import('../../src/renderer/src/main');
}
void boot();
