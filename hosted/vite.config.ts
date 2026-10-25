import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web client is the desktop renderer, unmodified, mounted from web/main.ts. Only the bridge differs.
export default defineConfig({
  root: resolve(__dirname, 'web'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, '../src/shared'), '@': resolve(__dirname, '../src/renderer/src') } },
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  worker: { format: 'es' },
  build: { outDir: resolve(__dirname, 'dist/web'), emptyOutDir: true }
});
