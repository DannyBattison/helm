import { execFile } from 'node:child_process';
import type { AgentLogin } from '../shared/types';

/**
 * Signing in to Claude Code on a machine with no browser of its own: the server runs `claude auth login`, shows you the address it prints,
 * and passes back the code you get after approving. Claude Code then stores its login in its own folder, where every agent finds it.
 * Nothing here handles the login itself: no token passes through helm, only the one-time code, from you to the command that asked for it.
 */

let ptyMod: any | undefined;
function loadPty() {
  if (ptyMod !== undefined) return ptyMod;
  try { ptyMod = require('@homebridge/node-pty-prebuilt-multiarch'); } catch { ptyMod = null; }
  return ptyMod;
}

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
/** What the terminal would show: without colours, links and cursor moves. */
export const plain = (s: string) => s.replace(OSC, '').replace(CSI, '').replace(/\r/g, '');

/** The address Claude Code asks you to open. Only Anthropic's own sites: it is shown to the user and opened in their browser. */
export function findLoginUrl(output: string): string | null {
  const m = /https:\/\/(?:claude\.com|claude\.ai|platform\.claude\.com|console\.anthropic\.com)\/[^\s\x1b\x07]+/.exec(plain(output));
  return m ? m[0] : null;
}

/** The output with what you typed taken out: the terminal echoes your input, and a code should not be shown back in a message. */
export const without = (output: string, secret: string) => (secret ? output.split(secret).join('') : output);

/** The last things the command said, for an error message. */
export function lastWords(output: string, lines = 2): string {
  return plain(output).split('\n').map((l) => l.trim()).filter((l) => l && !/^paste code here/i.test(l)).slice(-lines).join(' ').slice(0, 300);
}

const FAILED = /invalid|incorrect|expired|denied|failed|error|try again/i;

export function parseStatus(json: string): AgentLogin {
  const j = JSON.parse(json);
  return {
    loggedIn: !!j.loggedIn,
    method: String(j.authMethod || 'none'),
    email: typeof j.email === 'string' ? j.email : undefined,
    plan: typeof j.subscriptionType === 'string' ? j.subscriptionType : undefined
  };
}

export class ClaudeAuth {
  private attempt: { pty: any; out: string; timer: ReturnType<typeof setTimeout> } | null = null;

  /** `exe` is the Claude Code binary to run: the server's own, or `claude` on the PATH. */
  constructor(private exe: () => string) {}

  /** Where the server's Claude Code stands. A key or token in the environment counts as signed in: it is what agents will use. */
  async status(): Promise<AgentLogin> {
    if (process.env.ANTHROPIC_API_KEY) return { loggedIn: true, method: 'api key' };
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { loggedIn: true, method: 'subscription token' };
    return new Promise((resolve) => {
      execFile(this.exe(), ['auth', 'status', '--json'], { timeout: 20_000, env: process.env, windowsHide: true }, (err, stdout) => {
        if (stdout) { try { return resolve(parseStatus(stdout)); } catch { /* not JSON */ } }
        resolve({ loggedIn: false, method: 'none', error: err ? (/ENOENT/.test(String(err.message)) ? 'The claude command was not found on this server.' : 'Could not ask Claude Code who is signed in.') : undefined });
      });
    });
  }

  /** Starts the login and returns the address to open. Starting again cancels one that was waiting. */
  async startLogin(): Promise<{ url: string }> {
    this.cancel();
    const pty = loadPty();
    if (!pty) throw new Error('The terminal module did not load, so Claude cannot be signed in from here.');
    const p = pty.spawn(this.exe(), ['auth', 'login'], { name: 'xterm-256color', cols: 500, rows: 24, cwd: process.env.HOME || process.cwd(), env: { ...process.env, TERM: 'xterm-256color', NO_COLOR: '1' } });
    const attempt = { pty: p, out: '', timer: setTimeout(() => this.cancel(), 10 * 60_000) };
    this.attempt = attempt;
    p.onData((d: string) => { attempt.out += d; });
    p.onExit(() => { if (this.attempt === attempt) clearTimeout(attempt.timer); });
    const url = await new Promise<string | null>((resolve) => {
      const t0 = Date.now();
      const i = setInterval(() => {
        const u = findLoginUrl(attempt.out);
        if (u || Date.now() - t0 > 20_000) { clearInterval(i); resolve(u); }
      }, 100);
    });
    if (!url) {
      const why = lastWords(attempt.out) || 'It did not say anything.';
      this.cancel();
      throw new Error(`Claude Code did not offer a sign-in address. ${why}`);
    }
    return { url };
  }

  /** Gives the code you were shown to the waiting login, and says whether that signed Claude in. */
  async submitCode(code: string): Promise<AgentLogin> {
    const a = this.attempt;
    if (!a) throw new Error('No sign-in is waiting. Start again.');
    const clean = code.trim();
    if (!clean || clean.length > 600 || /[\r\n\x00-\x1f]/.test(clean)) throw new Error('That does not look like the code Claude showed. Copy it again.');
    const before = a.out.length;
    a.pty.write(clean + '\r');
    // The command either finishes (and exits), or says what is wrong and asks again.
    const result = await new Promise<'exit' | 'rejected' | 'silent'>((resolve) => {
      let done = false;
      const finish = (r: 'exit' | 'rejected' | 'silent') => { if (!done) { done = true; clearInterval(i); resolve(r); } };
      a.pty.onExit(() => finish('exit'));
      const t0 = Date.now();
      const i = setInterval(() => {
        if (FAILED.test(plain(a.out.slice(before)))) finish('rejected');
        else if (Date.now() - t0 > 45_000) finish('silent');
      }, 150);
    });
    if (result === 'exit') {
      clearTimeout(a.timer);
      if (this.attempt === a) this.attempt = null;
      const s = await this.status();
      if (s.loggedIn) return s;
      throw new Error(lastWords(without(a.out, clean)) || 'Claude did not sign in. Try again.');
    }
    const why = lastWords(without(a.out.slice(before), clean)) || 'Claude did not accept that code.';
    this.cancel();
    throw new Error(result === 'rejected' ? `${why} Start again for a new code.` : 'Claude did not answer. Start again.');
  }

  cancel() {
    const a = this.attempt;
    this.attempt = null;
    if (!a) return;
    clearTimeout(a.timer);
    try { a.pty.kill(); } catch { /* already gone */ }
  }

  async logout(): Promise<AgentLogin> {
    this.cancel();
    await new Promise<void>((resolve) => execFile(this.exe(), ['auth', 'logout'], { timeout: 20_000, env: process.env, windowsHide: true }, () => resolve()));
    return this.status();
  }
}
