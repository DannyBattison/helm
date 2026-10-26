import { describe, expect, it } from 'vitest';
import { defaultOutbound, emailProblem, outboundDecision, splitAddresses } from '../src/shared/outbound';
import { buildEmail, headerText } from '../src/core/outbound';

const quiet = { enabled: false, from: '22:00', to: '08:00', allowAttention: true };
const ch = () => ({ ...defaultOutbound().email, enabled: true });
const noon = new Date(2026, 0, 1, 12, 0), night = new Date(2026, 0, 1, 23, 0);

describe('outbound decisions', () => {
  it('needs the channel on and the kind chosen', () => {
    expect(outboundDecision({ quiet, notifyRepo: {} }, defaultOutbound().email, 'attention', 'a/b', noon)).toBe(false);
    expect(outboundDecision({ quiet, notifyRepo: {} }, ch(), 'attention', 'a/b', noon)).toBe(true);
    expect(outboundDecision({ quiet, notifyRepo: {} }, ch(), 'ready', 'a/b', noon)).toBe(false);
  });
  it('follows repository rules and quiet hours', () => {
    expect(outboundDecision({ quiet, notifyRepo: { 'a/b': 'off' } }, ch(), 'attention', 'a/b', noon)).toBe(false);
    expect(outboundDecision({ quiet, notifyRepo: { 'a/b': 'attention' } }, ch(), 'failed', 'a/b', noon)).toBe(false);
    const q = { ...quiet, enabled: true };
    expect(outboundDecision({ quiet: q, notifyRepo: {} }, ch(), 'failed', 'a/b', night)).toBe(false);
    expect(outboundDecision({ quiet: q, notifyRepo: {} }, ch(), 'attention', 'a/b', night)).toBe(true);
    expect(outboundDecision({ quiet: { ...q, allowAttention: false }, notifyRepo: {} }, ch(), 'attention', 'a/b', night)).toBe(false);
  });
});

describe('email', () => {
  const ok = { ...ch(), host: 'smtp.x.com', from: 'h@x.com', to: 'a@x.com, b@y.org' };
  it('explains what is missing', () => {
    expect(emailProblem(ok)).toBeNull();
    expect(emailProblem({ ...ok, host: '' })).toMatch(/SMTP/);
    expect(emailProblem({ ...ok, from: 'nope' })).toMatch(/sender/);
    expect(emailProblem({ ...ok, to: '' })).toMatch(/recipient/);
    expect(emailProblem({ ...ok, to: 'a@x.com, bad' })).toMatch(/"bad"/);
    expect(emailProblem({ ...ok, port: 0 })).toMatch(/port/);
  });
  it('splits addresses', () => expect(splitAddresses('a@x.com; b@y.org\nc@z.io')).toEqual(['a@x.com', 'b@y.org', 'c@z.io']));
  it('builds a message that cannot be injected into', () => {
    const m = buildEmail({ from: 'h@x.com', fromName: 'he\r\nBcc: x' }, ['a@x.com'], { kind: 'failed', title: 'a\r\nBcc: evil@x.com', body: 'hi', sessionId: 's1', repoId: 'o/r' });
    const head = m.split('\r\n\r\n')[0];
    expect(head.split('\r\n').some((l) => l.startsWith('Bcc'))).toBe(false);
    expect(head).toContain('Subject: [helm] a Bcc: evil@x.com');
    expect(Buffer.from(m.split('\r\n\r\n')[1], 'base64').toString()).toContain('Repository: o/r');
  });
  it('encodes non-ASCII headers', () => expect(headerText('é')).toMatch(/^=\?UTF-8\?B\?/));
});
