import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hosted = __dirname;

/**
 * The vite config the web builds share: the desktop renderer, unmodified, mounted from an entry that differs per build. `hosted/` builds
 * `web/` to `dist/web`, with `web/public` (icons, manifest and the push worker) copied as is, so the page is an installable app served
 * from the root. The phone app (`mobile/`) passes its own folder and output, and gets no public files.
 */
export function webConfig(opts: { dir?: string; out?: string } = {}) {
  const root = opts.dir ?? resolve(hosted, 'web');
  return defineConfig({
    root,
    base: './',
    publicDir: opts.dir ? false : resolve(hosted, 'web/public'),
    plugins: [react()],
    resolve: { alias: { '@shared': resolve(hosted, '../src/shared'), '@': resolve(hosted, '../src/renderer/src') } },
    server: { fs: { allow: [resolve(hosted, '..')] } },
    worker: { format: 'es' },
    build: { outDir: opts.out ?? resolve(hosted, 'dist/web'), emptyOutDir: true }
  });
}
