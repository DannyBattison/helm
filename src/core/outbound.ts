import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { hostname } from 'node:os';
import type { Host } from './host';
import { logLine } from './log';
import { emailProblem, outboundDecision, splitAddresses, type ChannelBase, type ChannelId, type EmailSettings, type OutboundMessage, type OutboundSettings } from '../shared/outbound';
import type { Settings } from '../shared/types';

/** A destination for outbound notifications. `settings` is the channel's entry in `Settings.outbound`. */
export interface OutboundChannel<S extends ChannelBase = ChannelBase> {
  id: ChannelId;
  /** Why the channel cannot send with these settings, or null. */
  problem(s: S): string | null;
  send(s: S, m: OutboundMessage): Promise<void>;
}

// ------------------------------------------------------------------ SMTP
// A small SMTP client: enough for submission with a login (AUTH PLAIN or LOGIN) over TLS, STARTTLS or nothing. No dependency.

type Vault = Pick<Host, 'dataDir' | 'encrypt' | 'decrypt'>;
let vault: Vault = { dataDir: '' };
let emailPassword = '';
const passwordFile = () => join(vault.dataDir, 'outbound-email.bin');
export const emailPasswordSet = () => !!emailPassword;

export async function loadOutboundSecrets(h: Vault) {
  vault = h;
  try {
    const buf = await readFile(passwordFile());
    emailPassword = vault.decrypt ? vault.decrypt(buf) : buf.toString('utf8');
  } catch { emailPassword = ''; }
}

export async function saveEmailPassword(password: string) {
  emailPassword = password;
  if (!password) { await rm(passwordFile(), { force: true }); return; }
  await writeFile(passwordFile(), vault.encrypt ? vault.encrypt(password) : Buffer.from(password), { mode: 0o600 });
}

const TIMEOUT = 20_000;

/** Reads SMTP replies from a socket, one complete (possibly multi-line) reply at a time. */
class Replies {
  private buf = '';
  private waiting: { resolve: (r: { code: number; text: string }) => void; reject: (e: Error) => void } | null = null;
  private error: Error | null = null;
  private ready: { code: number; text: string }[] = [];
  constructor(private sock: Socket) { this.attach(sock); }
  attach(sock: Socket) {
    this.sock = sock;
    sock.on('data', (d) => { this.buf += d.toString('utf8'); this.parse(); });
    sock.on('error', (e) => this.fail(e));
    sock.on('close', () => this.fail(new Error('The connection closed unexpectedly.')));
  }
  private fail(e: Error) { this.error ||= e; this.waiting?.reject(e); this.waiting = null; }
  private parse() {
    for (;;) {
      const lines = this.buf.split('\r\n');
      // A reply ends at the first line whose fourth character is a space, not a hyphen.
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end < 0 || end >= lines.length - 1) return;
      const text = lines.slice(0, end + 1).join('\n');
      this.buf = lines.slice(end + 1).join('\r\n');
      const r = { code: Number(lines[end].slice(0, 3)), text };
      if (this.waiting) { const w = this.waiting; this.waiting = null; w.resolve(r); } else this.ready.push(r);
    }
  }
  next(): Promise<{ code: number; text: string }> {
    const r = this.ready.shift();
    if (r) return Promise.resolve(r);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The mail server did not answer in time.')), TIMEOUT);
      this.waiting = { resolve: (x) => { clearTimeout(t); resolve(x); }, reject: (e) => { clearTimeout(t); reject(e); } };
    });
  }
}

/** Header text safe for a single line: no line breaks, and non-ASCII encoded. */
export function headerText(s: string): string {
  const one = s.replace(/[\r\n]+/g, ' ').trim();
  return /^[\x20-\x7e]*$/.test(one) ? one : `=?UTF-8?B?${Buffer.from(one, 'utf8').toString('base64')}?=`;
}

/** The message as sent: headers, a blank line, a UTF-8 body, with CRLF line ends and dot-stuffing for SMTP. */
export function buildEmail(e: Pick<EmailSettings, 'from' | 'fromName'>, to: string[], m: OutboundMessage, at = new Date()): string {
  const name = e.fromName.replace(/[\r\n"\\]+/g, ' ').trim();
  const headers = [
    `From: ${name ? `${headerText(name).includes('=?') ? headerText(name) : `"${name}"`} <${e.from}>` : e.from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${headerText(`[helm] ${m.title}`)}`,
    `Date: ${at.toUTCString()}`,
    `Message-ID: <${at.getTime().toString(36)}.${Math.random().toString(36).slice(2)}@${e.from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64'
  ];
  const lines = [m.body, '', ...(m.repoId ? [`Repository: ${m.repoId}`] : []), `Session: ${m.sessionId}`].join('\n');
  const b64 = Buffer.from(lines, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + b64;
}

async function smtpSend(e: EmailSettings, password: string, to: string[], message: string): Promise<void> {
  const open = (): Promise<Socket> => new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.destroy(); reject(new Error(`Could not connect to ${e.host}:${e.port}.`)); }, TIMEOUT);
    const s: Socket = e.security === 'tls'
      ? tlsConnect({ host: e.host, port: e.port, servername: e.host }, () => { clearTimeout(t); resolve(s); })
      : netConnect({ host: e.host, port: e.port }, () => { clearTimeout(t); resolve(s); });
    s.once('error', (err) => { clearTimeout(t); reject(err); });
  });
  let sock = await open();
  const replies = new Replies(sock);
  const say = async (cmd: string, ok: number[]) => {
    sock.write(cmd + '\r\n');
    const r = await replies.next();
    if (!ok.includes(r.code)) throw new Error(`The mail server said: ${r.text.replace(/\n/g, ' ')}`);
    return r;
  };
  try {
    const greet = await replies.next();
    if (greet.code !== 220) throw new Error(`The mail server said: ${greet.text}`);
    const me = hostname().replace(/[^\w.-]/g, '') || 'localhost';
    let caps = (await say(`EHLO ${me}`, [250])).text;
    if (e.security === 'starttls') {
      if (!/STARTTLS/i.test(caps)) throw new Error('The server does not offer STARTTLS. Pick another security setting.');
      await say('STARTTLS', [220]);
      sock.removeAllListeners('data');
      const upgraded: TLSSocket = await new Promise((resolve, reject) => {
        const t: TLSSocket = tlsConnect({ socket: sock, servername: e.host }, () => resolve(t));
        t.once('error', reject);
      });
      sock = upgraded;
      replies.attach(upgraded);
      caps = (await say(`EHLO ${me}`, [250])).text;
    }
    if (e.user) {
      if (e.security === 'none') logLine('warn', 'outbound email: signing in to the mail server without encryption');
      if (/AUTH[^\n]*PLAIN/i.test(caps)) await say('AUTH PLAIN ' + Buffer.from(`\0${e.user}\0${password}`).toString('base64'), [235]);
      else {
        await say('AUTH LOGIN', [334]);
        await say(Buffer.from(e.user).toString('base64'), [334]);
        await say(Buffer.from(password).toString('base64'), [235]);
      }
    }
    await say(`MAIL FROM:<${e.from}>`, [250]);
    for (const a of to) await say(`RCPT TO:<${a}>`, [250, 251]);
    await say('DATA', [354]);
    await say(message.replace(/^\./gm, '..') + '\r\n.', [250]);
    sock.write('QUIT\r\n');
  } finally {
    sock.destroy();
  }
}

const emailChannel: OutboundChannel<EmailSettings> = {
  id: 'email',
  problem: emailProblem,
  async send(s, m) {
    await smtpSend(s, emailPassword, splitAddresses(s.to), buildEmail(s, splitAddresses(s.to), m));
  }
};

// ------------------------------------------------------------------ registry
/** Every channel helm can send through. Add new ones here. */
const channels: { [K in ChannelId]: OutboundChannel<OutboundSettings[K]> } = { email: emailChannel };

/** Sends a notification through every channel that wants it. Never throws: a failing channel is logged and the rest still go. */
export function dispatchOutbound(st: Pick<Settings, 'outbound' | 'quiet' | 'notifyRepo'>, m: OutboundMessage) {
  for (const id of Object.keys(channels) as ChannelId[]) {
    const ch = channels[id] as OutboundChannel, s = st.outbound[id];
    if (!outboundDecision(st, s, m.kind, m.repoId)) continue;
    const problem = ch.problem(s);
    if (problem) { logLine('warn', `outbound ${id}: not sent. ${problem}`); continue; }
    ch.send(s, m).catch((err) => logLine('warn', `outbound ${id}: ${err?.message || err}`));
  }
}

/** A test message, sent whatever the channel's `enabled` and `kinds` say. Resolves to the problem, or null. */
export async function testOutbound(st: Pick<Settings, 'outbound'>, id: ChannelId): Promise<string | null> {
  const ch = channels[id] as OutboundChannel | undefined;
  if (!ch) return 'Unknown channel.';
  const s = st.outbound[id];
  const problem = ch.problem(s);
  if (problem) return problem;
  try {
    await ch.send(s, { kind: 'ready', title: 'Test notification', body: 'This is a test from helm. Notifications will arrive here.', sessionId: 'test', repoId: '' });
    return null;
  } catch (err: any) { return err?.message || String(err); }
}
