import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logged = vi.hoisted(() => [] as string[]);
vi.mock('../src/core/log', () => ({ logLine: (level: string, msg: string) => { logged.push(`${level}: ${msg}`); } }));

import { defaultOutbound } from '../src/shared/outbound';
import { buildEmail, dispatchOutbound, emailPasswordSet, headerText, loadOutboundSecrets, saveEmailPassword, testOutbound } from '../src/core/outbound';

type Opts = { greet?: string; caps?: string; replies?: Record<string, string>; silent?: boolean; hangUpAfterEhlo?: boolean };
/** A scriptable SMTP server: `replies` overrides the answer to a command by its first word(s). */
function server(o: Opts = {}) {
  const log: string[] = [];
  const srv = createServer((s: Socket) => {
    if (!o.silent) s.write((o.greet ?? '220 hi') + '\r\n');
    let data = false, buf = '';
    s.on('error', () => {});
    let tlsMode = false;
    s.on('data', (d) => {
      if (tlsMode) { s.write('HTTP/1.1 400 not tls\r\n\r\n'); return; }
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        log.push(line);
        if (data) { if (line === '.') { data = false; s.write((o.replies?.['.'] ?? '250 queued') + '\r\n'); } continue; }
        if (line === 'STARTTLS') tlsMode = true;
        const key = Object.keys(o.replies ?? {}).find((k) => k !== '.' && line.startsWith(k));
        if (key) { s.write(o.replies![key] + '\r\n'); continue; }
        if (line.startsWith('EHLO')) { s.write((o.caps ?? '250-localhost\r\n250 AUTH PLAIN') + '\r\n'); if (o.hangUpAfterEhlo) s.destroy(); }
        else if (line === 'AUTH LOGIN') s.write('334 VXNlcm5hbWU6\r\n');
        else if (line.startsWith('AUTH PLAIN')) s.write('235 ok\r\n');
        else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') s.end('221 bye\r\n');
        else if (/^[A-Za-z0-9+/=]+$/.test(line)) s.write(log.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).length >= 2 ? '235 ok\r\n' : '334 next\r\n');
        else s.write('250 ok\r\n');
      }
    });
  });
  return new Promise<{ port: number; log: string[]; close(): void }>((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as any).port, log, close: () => srv.close() })));
}
const settings = (port: number, extra: object = {}) => {
  const st = defaultOutbound();
  Object.assign(st.email, { enabled: true, host: '127.0.0.1', port, security: 'none', from: 'h@x.com', to: 'a@x.com', ...extra });
  return st;
};
const msg = { kind: 'failed' as const, title: 't', body: 'b', sessionId: 's', repoId: 'o/r' };

let dir: string;
beforeEach(async () => {
  logged.length = 0;
  dir = mkdtempSync(join(tmpdir(), 'helm-cov-out-'));
  await loadOutboundSecrets({ dataDir: dir });
  await saveEmailPassword('');
});
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); });

describe('stored password', () => {
  it('is empty when there is no file', () => expect(emailPasswordSet()).toBe(false));
  it('is saved as plain bytes with no encryptor, and loaded back', async () => {
    await saveEmailPassword('pw');
    expect(emailPasswordSet()).toBe(true);
    await loadOutboundSecrets({ dataDir: dir });
    expect(emailPasswordSet()).toBe(true);
  });
  it('goes through the encryptor and decryptor when there are some', async () => {
    const h = { dataDir: dir, encrypt: vi.fn((s: string) => Buffer.from('enc:' + s)), decrypt: vi.fn((b: Buffer) => b.toString().replace('enc:', '')) };
    await loadOutboundSecrets(h);
    await saveEmailPassword('pw');
    expect(h.encrypt).toHaveBeenCalledWith('pw');
    expect(existsSync(join(dir, 'outbound-email.bin'))).toBe(true);
    await loadOutboundSecrets(h);
    expect(h.decrypt).toHaveBeenCalled();
    expect(emailPasswordSet()).toBe(true);
  });
  it('forgets the password, and the file, when saved empty', async () => {
    await saveEmailPassword('pw');
    await saveEmailPassword('');
    expect(emailPasswordSet()).toBe(false);
    expect(existsSync(join(dir, 'outbound-email.bin'))).toBe(false);
  });
  it('treats an unreadable password as none', async () => {
    writeFileSync(join(dir, 'outbound-email.bin'), 'x');
    await loadOutboundSecrets({ dataDir: dir, decrypt: () => { throw new Error('bad key'); } });
    expect(emailPasswordSet()).toBe(false);
  });
});

describe('message building', () => {
  it('encodes non-ASCII text and leaves ASCII alone', () => {
    expect(headerText('plain  text')).toBe('plain  text');
    expect(headerText('héllo\r\nworld')).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
  });
  it('handles a sender with no name, an encoded name, and a message without a repository', () => {
    const at = new Date(Date.UTC(2026, 0, 1));
    const plain = buildEmail({ from: 'h@x.com', fromName: '' }, ['a@x.com', 'b@x.com'], { ...msg, repoId: '' }, at);
    expect(plain).toContain('From: h@x.com\r\n');
    expect(plain).toContain('To: a@x.com, b@x.com');
    const body = Buffer.from(plain.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString();
    expect(body).toBe('b\n\nSession: s');
    const enc = buildEmail({ from: 'h@x.com', fromName: 'Hélm' }, ['a@x.com'], msg, at);
    expect(enc).toMatch(/From: =\?UTF-8\?B\?[^ ]+\?= <h@x.com>/);
    expect(buildEmail({ from: 'h@x.com', fromName: 'helm' }, ['a@x.com'], msg, at)).toContain('From: "helm" <h@x.com>');
    expect(Buffer.from(buildEmail({ from: 'h@x.com', fromName: 'helm' }, ['a@x.com'], msg, at).split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString()).toContain('Repository: o/r');
  });
});

describe('testOutbound', () => {
  it('says so for an unknown channel and for settings that cannot send', async () => {
    expect(await testOutbound({ outbound: defaultOutbound() }, 'nope' as any)).toBe('Unknown channel.');
    expect(await testOutbound({ outbound: defaultOutbound() }, 'email')).toMatch(/SMTP/);
  });
  it('signs in with AUTH LOGIN when PLAIN is not offered, using the saved password', async () => {
    const srv = await server({ caps: '250-localhost\r\n250 AUTH LOGIN' });
    await saveEmailPassword('secret');
    expect(await testOutbound({ outbound: settings(srv.port, { user: 'me' }) }, 'email')).toBeNull();
    srv.close();
    expect(srv.log).toContain('AUTH LOGIN');
    expect(srv.log).toContain(Buffer.from('me').toString('base64'));
    expect(srv.log).toContain(Buffer.from('secret').toString('base64'));
    expect(logged.some((l) => /without encryption/.test(l))).toBe(true);
  });
  it('sends to every recipient, and accepts 251 as well as 250', async () => {
    const srv = await server({ replies: { 'RCPT TO:<b@x.com>': '251 forwarded' } });
    expect(await testOutbound({ outbound: settings(srv.port, { to: 'a@x.com, b@x.com' }) }, 'email')).toBeNull();
    srv.close();
    expect(srv.log).toContain('RCPT TO:<a@x.com>');
    expect(srv.log).toContain('RCPT TO:<b@x.com>');
  });
  it.each([
    ['a bad greeting', { greet: '554 go away' }, /go away/],
    ['a refused sender', { replies: { 'MAIL FROM': '550 no sender' } }, /The mail server said: 550 no sender/],
    ['a refused recipient', { replies: { 'RCPT TO': '550 no user' } }, /no user/],
    ['a refused message', { replies: { '.': '552 too big' } }, /too big/],
    ['a refused login', { replies: { 'AUTH PLAIN': '535 bad login' } }, /bad login/],
    ['a refused EHLO', { replies: { EHLO: '502 nope' } }, /502 nope/]
  ] as [string, Opts, RegExp][])('reports %s', async (_n, o, re) => {
    const srv = await server(o);
    const r = await testOutbound({ outbound: settings(srv.port, { user: 'u' }) }, 'email');
    srv.close();
    expect(r).toMatch(re);
  });
  it('explains when STARTTLS is wanted but not offered', async () => {
    const srv = await server({ caps: '250 localhost' });
    const r = await testOutbound({ outbound: settings(srv.port, { security: 'starttls' }) }, 'email');
    srv.close();
    expect(r).toMatch(/does not offer STARTTLS/);
  });
  it('reports a failed TLS upgrade after STARTTLS is accepted', async () => {
    const srv = await server({ caps: '250-localhost\r\n250 STARTTLS', replies: { STARTTLS: '220 ready' } });
    const r = await testOutbound({ outbound: settings(srv.port, { security: 'starttls' }) }, 'email');
    srv.close();
    expect(r).toBeTruthy();
    expect(srv.log).toContain('STARTTLS');
  });
  it('reports a failed implicit TLS handshake', async () => {
    const srv = await server();
    const r = await testOutbound({ outbound: settings(srv.port, { security: 'tls' }) }, 'email');
    srv.close();
    expect(r).toBeTruthy();
  });
  it('reports a connection that closes unexpectedly', async () => {
    const srv = await server({ hangUpAfterEhlo: true });
    const r = await testOutbound({ outbound: settings(srv.port) }, 'email');
    srv.close();
    expect(r).toMatch(/closed unexpectedly|ECONNRESET|reset/i);
  });
  it('gives up when the server never answers', async () => {
    const srv = await server({ silent: true });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const p = testOutbound({ outbound: settings(srv.port) }, 'email');
    await vi.waitFor(async () => { await vi.advanceTimersByTimeAsync(1); expect(srv.log).toBeDefined(); }, { timeout: 2000 });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await p).toMatch(/did not answer in time/);
    srv.close();
  });
});

describe('dispatchOutbound', () => {
  const base = { quiet: { enabled: false, from: '22:00', to: '08:00', allowAttention: true }, notifyRepo: {} };
  it('skips channels that are off', () => {
    dispatchOutbound({ ...base, outbound: defaultOutbound() }, msg);
    expect(logged).toEqual([]);
  });
  it('logs why a wanted channel cannot send', () => {
    const outbound = defaultOutbound();
    outbound.email.enabled = true;
    dispatchOutbound({ ...base, outbound }, msg);
    expect(logged[0]).toMatch(/^warn: outbound email: not sent\. Enter the SMTP server/);
  });
  it('sends through a ready channel', async () => {
    const srv = await server();
    dispatchOutbound({ ...base, outbound: settings(srv.port) }, msg);
    await vi.waitFor(() => expect(srv.log).toContain('.'));
    srv.close();
    expect(srv.log).toContain('RCPT TO:<a@x.com>');
  });
  it('logs a failed send without throwing', async () => {
    dispatchOutbound({ ...base, outbound: settings(1) }, msg);
    await vi.waitFor(() => expect(logged.some((l) => /^warn: outbound email: /.test(l))).toBe(true));
  });
});
