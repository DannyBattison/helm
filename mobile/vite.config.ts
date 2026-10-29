import { resolve } from 'node:path';
import { webConfig } from '../hosted/vite.base';

// The renderer and the phone's own screens, built into www/ for Capacitor; collect.html is the page the background task runs.
const base = webConfig({ dir: __dirname, out: resolve(__dirname, 'www'), pwa: false });
export default {
  ...base,
  build: { ...(base as any).build, rollupOptions: { input: { index: resolve(__dirname, 'index.html'), collect: resolve(__dirname, 'collect.html') } } }
};
