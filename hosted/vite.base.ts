import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hosted = __dirname;
const shared = ['sw.js:web/pwa/sw.js', 'favicon.svg:web/public/favicon.svg', 'apple-touch-icon.png:web/public/apple-touch-icon.png'];

/**
 * The vite config every web build shares: the desktop renderer, unmodified, mounted from an entry that only differs per build.
 * `hosted/` builds to `dist/web`; a companion build (`mobile-app/`, `web-companion/`) passes its own folder and builds to `dist/web/<name>/` (or `out`),
 * where its server serves it, with the worker and icons from here and the manifest from its own folder.
 */
export function webConfig(opts: { dir?: string; name?: string; out?: string } = {}) {
  const root = opts.dir ?? resolve(hosted, 'web');
  const sub = opts.name ? '/' + opts.name : '';
  return defineConfig({
    root,
    base: './',
    publicDir: opts.dir ? false : resolve(hosted, 'web/public'),
    plugins: [react(), ...(opts.dir ? [{
      name: 'helm-pwa-assets',
      // Added after vite has handled the page's assets: it would otherwise move the manifest into assets/ and break its relative icon paths.
      transformIndexHtml: { order: 'post' as const, handler: () => [{ tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' }, injectTo: 'head' as const }] },
      generateBundle(this: any) {
        for (const s of shared) { const [out, from] = s.split(':'); this.emitFile({ type: 'asset', fileName: out, source: readFileSync(resolve(hosted, from)) }); }
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: readFileSync(resolve(opts.dir!, 'manifest.webmanifest')) });
      }
    }] : [])],
    resolve: { alias: { '@shared': resolve(hosted, '../src/shared'), '@': resolve(hosted, '../src/renderer/src') } },
    server: { fs: { allow: [resolve(hosted, '..')] } },
    worker: { format: 'es' },
    build: { outDir: opts.out ?? resolve(hosted, 'dist/web' + sub), emptyOutDir: !opts.dir }
  });
}
