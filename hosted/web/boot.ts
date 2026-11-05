import { createBridge } from './bridge';
import { setupNotifications } from './notifications';

/**
 * Starts a web build: the desktop renderer, talking to the server over `HelmBridge`.
 */
export async function boot() {
  document.body.style.background = '#0e0e12';
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  const bridge = createBridge(url);
  (window as any).helmBridge = bridge;
  await bridge.ready;
  setupNotifications(bridge, { push: true });
  // The desktop renderer, as is. It only talks to `window.helmBridge`, and it shows its own GitHub sign-in when nobody is signed in:
  // on this server that screen is the only login, and the server checks the username against its allow list.
  await import('../../src/renderer/src/main');
}
