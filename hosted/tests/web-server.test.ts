import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHost, dataDirectory } from '../src/host';
import { CSP, serveStatic } from '../src/static';

describe('serveStatic', () => {
  const root = mkdtempSync(join(tmpdir(), 'helm-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<h1>home</h1>');
  writeFileSync(join(root, 'sw.js'), 'self');
  writeFileSync(join(root, 'assets', 'app.css'), 'a{}');
  writeFileSync(join(root, 'assets', 'blob.xyz'), 'x');
  writeFileSync(join(tmpdir(), 'helm-secret.txt'), 'secret');
  let close: () => void = () => undefined;
  afterEach(() => close());

  async function get(path: string) {
    const srv = createServer((req, res) => serveStatic(root, req, res));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    close = () => srv.close();
    const port = (srv.address() as AddressInfo).port;
    // Raw request so that the path is sent exactly as written.
    const { request } = await import('node:http');
    return new Promise<{ status: number; headers: Record<string, any>; body: string }>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path, method: 'GET' }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ status: r.statusCode!, headers: r.headers, body }));
      }).on('error', reject).end();
    });
  }

  it('serves files with their mime type, the CSP and frame protection', async () => {
    const r = await get('/assets/app.css');
    expect(r.status).toBe(200);
    expect(r.body).toBe('a{}');
    expect(r.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(r.headers['content-security-policy']).toBe(CSP);
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBeUndefined();
  });

  it('serves index.html for a trailing slash and falls back to octet-stream for unknown extensions', async () => {
    const r = await get('/');
    expect(r.body).toBe('<h1>home</h1>');
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect((await get('/assets/blob.xyz')).headers['content-type']).toBe('application/octet-stream');
  });

  it('never caches the service worker', async () => {
    const r = await get('/sw.js');
    expect(r.headers['cache-control']).toBe('no-cache');
    expect(r.headers['content-type']).toBe('text/javascript; charset=utf-8');
  });

  it('answers 404 for missing files and directories', async () => {
    expect((await get('/nope.js')).status).toBe(404);
    expect((await get('/assets')).status).toBe(404);
    expect((await get('/assets/')).status).toBe(404);
  });

  it('refuses to leave the root, however the path is written', async () => {
    for (const p of ['/../helm-secret.txt', '/%2e%2e/helm-secret.txt', '/assets/../../helm-secret.txt', '/%2e%2e%2fhelm-secret.txt', '/..%2fhelm-secret.txt']) {
      const r = await get(p);
      expect(r.status, p).toBe(404);
      expect(r.body).toBe('Not found');
    }
  });
});

describe('hosted host', () => {
  afterEach(() => vi.unstubAllEnvs());
  const dataEnv = () => { const d = join(mkdtempSync(join(tmpdir(), 'helm-host-')), 'data'); vi.stubEnv('HELM_DATA_DIR', d); return d; };

  it('dataDirectory honours HELM_DATA_DIR and creates it private', () => {
    const d = dataEnv();
    expect(dataDirectory()).toBe(d);
    expect(statSync(d).mode & 0o777).toBe(0o700);
  });

  it('dataDirectory defaults to ~/.helm-hosted', () => {
    vi.stubEnv('HELM_DATA_DIR', '');
    vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'helm-home-')));
    expect(dataDirectory()).toMatch(/\.helm-hosted$/);
  });

  it('describes a headless server', () => {
    const d = dataEnv();
    vi.stubEnv('HELM_LOCALE', 'de-DE');
    vi.stubEnv('GH_CONFIG_DIR', '/gh');
    const login = vi.fn();
    const host = createHost(vi.fn(), login as any);
    expect(host).toMatchObject({ dataDir: d, locale: 'de-DE', ghConfigDir: '/gh', companion: false, syncServer: true, requireAgentLogin: true, allowLogin: login });
    expect(host.appInfo()).toEqual({ version: 'hosted', packaged: true });
    expect(host.sdkClaudePath()).toBeUndefined();
    expect(host.cliClaudePath()).toBeUndefined();
  });

  it('uses defaults for locale and gh config', () => {
    dataEnv();
    vi.stubEnv('HELM_LOCALE', '');
    vi.stubEnv('GH_CONFIG_DIR', '');
    const host = createHost(vi.fn());
    expect(host.locale).toBe('en-US');
    expect(host.ghConfigDir).toMatch(/\.config[\\/]gh$/);
  });

  it('rejects what only a desktop can do, and chooses no folder', async () => {
    dataEnv();
    const host = createHost(vi.fn());
    await expect(host.openExternal('https://x')).rejects.toThrow('Opening a link is not available on a hosted server');
    await expect(host.openPath('/x')).rejects.toThrow('Opening a folder is not available');
    await expect(host.copyText('x')).rejects.toThrow('Copying is not available');
    await expect(host.chooseFolder()).resolves.toBeNull();
  });

  it('notify tells the browser and pushes to installed apps', () => {
    dataEnv();
    const send = vi.fn();
    const push = { notify: vi.fn(async () => undefined) };
    const host = createHost(send, undefined, push as any);
    host.notify({ kind: 'ready', title: 'T', body: 'B', silent: true, sessionId: 's1' } as any);
    expect(send).toHaveBeenCalledWith('notify', { kind: 'ready', title: 'T', body: 'B', silent: true, sessionId: 's1' });
    expect(push.notify).toHaveBeenCalledWith({ title: 'T', body: 'B', silent: true, sessionId: 's1', kind: 'ready' });
  });

  it('notify works without push', () => {
    dataEnv();
    const send = vi.fn();
    createHost(send).notify({ kind: 'ready', title: 'T', body: 'B', sessionId: 's' } as any);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('saveFile sends a download and resolves with the name', async () => {
    dataEnv();
    const send = vi.fn();
    await expect(createHost(send).saveFile('report.md', 'text')).resolves.toBe('report.md');
    expect(send).toHaveBeenCalledWith('download', { name: 'report.md', text: 'text' });
  });
});
