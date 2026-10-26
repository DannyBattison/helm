import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Run from the repository root: `electron-vite <cmd> -c desktop/electron.vite.config.ts`. The main process and the preload script live in
// desktop/, the renderer (the UI, shared with the hosted version) in src/renderer, and everything the app produces goes to desktop/out.
const shared = resolve('src/shared');
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { outDir: resolve('desktop/out/main'), rollupOptions: { input: resolve('desktop/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: { outDir: resolve('desktop/out/preload'), rollupOptions: { input: resolve('desktop/preload/index.ts') } }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@shared': shared, '@': resolve('src/renderer/src') } },
    worker: { format: 'es' },
    build: { outDir: resolve('desktop/out/renderer'), rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
});
