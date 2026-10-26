import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { defaultOutbound } from '../src/shared/outbound';
import { saveEmailPassword, testOutbound } from '../src/core/outbound';

/** A minimal SMTP server that records what it is sent. */
function fakeServer(): Promise<{ port: number; log: string[]; close(): void }> {
  const log: string[] = [];
  const srv = createServer((s) => {
    s.write('220 hi\r\n');
    let data = false, buf = '';
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        log.push(line);
        if (data) { if (line === '.') { data = false; s.write('250 queued\r\n'); } continue; }
        if (line.startsWith('EHLO')) s.write('250-localhost\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH')) s.write('235 ok\r\n');
        else if (line === 'DATA') { data = true; s.write('354 go\r\n'); }
        else if (line === 'QUIT') s.end('221 bye\r\n');
        else s.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as any).port, log, close: () => srv.close() })));
}

describe('smtp', () => {
  it('sends a test email with a login', async () => {
    const srv = await fakeServer();
    await saveEmailPassword('');
    const st = defaultOutbound();
    Object.assign(st.email, { host: '127.0.0.1', port: srv.port, security: 'none', from: 'h@x.com', to: 'a@x.com', user: 'u' });
    expect(await testOutbound({ outbound: st }, 'email')).toBeNull();
    srv.close();
    expect(srv.log).toContain('MAIL FROM:<h@x.com>');
    expect(srv.log).toContain('RCPT TO:<a@x.com>');
    expect(srv.log.some((l) => l.startsWith('AUTH PLAIN '))).toBe(true);
    expect(srv.log.some((l) => l.startsWith('Subject: [helm] Test notification'))).toBe(true);
  });
  it('reports a refused connection', async () => {
    const st = defaultOutbound();
    Object.assign(st.email, { host: '127.0.0.1', port: 1, security: 'none', from: 'h@x.com', to: 'a@x.com' });
    expect(await testOutbound({ outbound: st }, 'email')).toMatch(/ECONNREFUSED|connect/i);
  });
});
