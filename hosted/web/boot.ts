import { createBridge } from './bridge';
import { phoneLayout } from './layout';
import { setupNotifications } from './notifications';

export interface BootOptions {
  /** `phone` forces the phone layout on tablets and wide screens. */
  layout?: 'phone';
  /** Push notifications through a service worker, so they arrive with the app closed. */
  push?: boolean;
}

/**
 * Starts a web build: the desktop renderer, talking to the server over `HelmBridge`. Every build (`hosted/web/main.ts`, `mobile-app`,
 * `web-companion`) is this with different options, so what is unique to a build is its entry, manifest and options, nothing more.
 */
export async function boot(o: BootOptions) {
  document.body.style.background = '#0e0e12';
  if (o.layout === 'phone') phoneLayout();
  const url = location.origin.replace(/^http/, 'ws') + '/ws';
  const bridge = createBridge(url);
  (window as any).helmBridge = bridge;
  await bridge.ready;
  setupNotifications(bridge, { push: o.push });
  // The desktop renderer, as is. It only talks to `window.helmBridge`, and it shows its own GitHub sign-in when nobody is signed in:
  // on this server that screen is the only login, and the server checks the username against its allow list.
  await import('../../src/renderer/src/main');
}
