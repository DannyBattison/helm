import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const exec = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: (...a: any[]) => exec.fn(...a) }));

import { ClaudeAuth } from '../src/core/claudeAuth';

const pty = createRequire(import.meta.url)('@homebridge/node-pty-prebuilt-multiarch');
const URL_ = 'https://claude.com/cai/oauth/authorize?x=1';

/** A stand-in for the terminal session: tests push output and exits by hand. */
function fakePty() {
  let data: (d: string) => void = () => {};
  const exits: (() => void)[] = [];
  return {
    write: vi.fn(), kill: vi.fn(),
    onData: (cb: any) => { data = cb; },
    onExit: (cb: any) => { exits.push(cb); },
    say: (s: string) => data(s),
    exit: () => exits.forEach((f) => f())
  };
}
const statusReply = (stdout: string, err: any = null) => exec.fn.mockImplementation((_e: string, _a: string[], _o: any, cb: any) => cb(err, stdout));

const KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] as const;
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  exec.fn.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

describe('status', () => {
  it('counts an API key or subscription token in the environment as signed in', async () => {
    const a = new ClaudeAuth(() => 'claude');
    process.env.ANTHROPIC_API_KEY = 'k';
    expect(await a.status()).toEqual({ loggedIn: true, method: 'api key' });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 't';
    expect(await a.status()).toEqual({ loggedIn: true, method: 'subscription token' });
    expect(exec.fn).not.toHaveBeenCalled();
  });
  it('asks the claude command otherwise', async () => {
    statusReply('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c"}');
    expect(await new ClaudeAuth(() => 'cc').status()).toMatchObject({ loggedIn: true, method: 'claude.ai', email: 'a@b.c' });
    expect(exec.fn.mock.calls[0][0]).toBe('cc');
    expect(exec.fn.mock.calls[0][1]).toEqual(['auth', 'status', '--json']);
  });
  it('still reads the output when the command exits with an error code', async () => {
    statusReply('{"loggedIn":false,"authMethod":"none"}', new Error('exit 1'));
    expect((await new ClaudeAuth(() => 'c').status()).loggedIn).toBe(false);
  });
  it('explains a missing command, an unreadable answer, and no error at all', async () => {
    statusReply('', new Error('spawn claude ENOENT'));
    expect((await new ClaudeAuth(() => 'c').status()).error).toMatch(/not found/);
    statusReply('not json', new Error('boom'));
    expect((await new ClaudeAuth(() => 'c').status()).error).toMatch(/Could not ask/);
    statusReply('not json', null);
    expect(await new ClaudeAuth(() => 'c').status()).toEqual({ loggedIn: false, method: 'none', error: undefined });
  });
});

describe('startLogin', () => {
  it('returns the address once the command prints it, and starts the command with the login arguments', async () => {
    const p = fakePty();
    const spawn = vi.spyOn(pty, 'spawn').mockReturnValue(p);
    const a = new ClaudeAuth(() => 'cc');
    const started = a.startLogin();
    await vi.advanceTimersByTimeAsync(250);
    p.say(`visit ${URL_}\r\n`);
    await vi.advanceTimersByTimeAsync(150);
    expect(await started).toEqual({ url: URL_ });
    expect(spawn.mock.calls[0][0]).toBe('cc');
    expect(spawn.mock.calls[0][1]).toEqual(['auth', 'login']);
    expect(spawn.mock.calls[0][2].env.NO_COLOR).toBe('1');
    a.cancel();
    expect(p.kill).toHaveBeenCalled();
  });
  it('gives up after 20 seconds and says what the command said', async () => {
    const p = fakePty();
    vi.spyOn(pty, 'spawn').mockReturnValue(p);
    const a = new ClaudeAuth(() => 'cc');
    const started = a.startLogin();
    const assertion = expect(started).rejects.toThrow(/did not offer a sign-in address\. Something broke/);
    p.say('Something broke\r\n');
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;
    expect(p.kill).toHaveBeenCalled();
  });
  it('has a fallback message when the command said nothing', async () => {
    vi.spyOn(pty, 'spawn').mockReturnValue(fakePty());
    const started = new ClaudeAuth(() => 'cc').startLogin();
    const assertion = expect(started).rejects.toThrow(/It did not say anything\./);
    await vi.advanceTimersByTimeAsync(21_000);
    await assertion;
  });
  it('cancels a login that was waiting when starting again, and after ten minutes', async () => {
    const p1 = fakePty(), p2 = fakePty();
    vi.spyOn(pty, 'spawn').mockReturnValueOnce(p1).mockReturnValueOnce(p2);
    const a = new ClaudeAuth(() => 'cc');
    p1.say(URL_);
    const s1 = a.startLogin();
    // output arrives after spawn in practice; simulate by letting the first poll run
    await vi.advanceTimersByTimeAsync(10);
    p1.say(URL_ + ' ');
    await vi.advanceTimersByTimeAsync(150);
    await s1;
    const s2 = a.startLogin();
    expect(p1.kill).toHaveBeenCalled();
    p2.say(URL_ + ' ');
    await vi.advanceTimersByTimeAsync(150);
    await s2;
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);
    expect(p2.kill).toHaveBeenCalled();
  });
  it('ignores a kill that throws', async () => {
    const p = fakePty();
    p.kill.mockImplementation(() => { throw new Error('gone'); });
    vi.spyOn(pty, 'spawn').mockReturnValue(p);
    const a = new ClaudeAuth(() => 'cc');
    const s = a.startLogin();
    p.say(URL_ + ' ');
    await vi.advanceTimersByTimeAsync(150);
    await s;
    expect(() => a.cancel()).not.toThrow();
    expect(() => a.cancel()).not.toThrow();
  });
  it('stops the ten minute timer when the command exits by itself', async () => {
    const p = fakePty();
    vi.spyOn(pty, 'spawn').mockReturnValue(p);
    const a = new ClaudeAuth(() => 'cc');
    const s = a.startLogin();
    p.say(URL_ + ' ');
    await vi.advanceTimersByTimeAsync(150);
    await s;
    p.exit();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(p.kill).not.toHaveBeenCalled();
  });
});

describe('submitCode', () => {
  async function waiting() {
    const p = fakePty();
    vi.spyOn(pty, 'spawn').mockReturnValue(p);
    const a = new ClaudeAuth(() => 'cc');
    const s = a.startLogin();
    p.say(URL_ + ' ');
    await vi.advanceTimersByTimeAsync(150);
    await s;
    return { a, p };
  }
  it('needs a login to be waiting', async () => {
    await expect(new ClaudeAuth(() => 'c').submitCode('abc')).rejects.toThrow(/No sign-in is waiting/);
  });
  it('refuses codes that are empty, too long, or hold control characters', async () => {
    const { a, p } = await waiting();
    for (const bad of ['   ', 'x'.repeat(601), 'ab\ncd', 'a\u0001b']) await expect(a.submitCode(bad)).rejects.toThrow(/does not look like the code/);
    expect(p.write).not.toHaveBeenCalled();
  });
  it('types the code and returns the status when the command exits and Claude is signed in', async () => {
    const { a, p } = await waiting();
    statusReply('{"loggedIn":true,"authMethod":"claude.ai"}');
    const r = a.submitCode('  good-code ');
    await vi.advanceTimersByTimeAsync(10);
    expect(p.write).toHaveBeenCalledWith('good-code\r');
    p.exit();
    expect((await r).loggedIn).toBe(true);
    // the attempt is finished: another code has nowhere to go
    await expect(a.submitCode('again')).rejects.toThrow(/No sign-in/);
  });
  it('reports what the command said when it exits and Claude is still signed out', async () => {
    const { a, p } = await waiting();
    statusReply('{"loggedIn":false}');
    const r = a.submitCode('code1');
    const assertion = expect(r).rejects.toThrow(/Login stopped/);
    await vi.advanceTimersByTimeAsync(10);
    p.say('code1\r\nLogin stopped\r\n');
    p.exit();
    await assertion;
  });
  it('has a fallback message when the command exits silently without signing in', async () => {
    const { a, p } = await waiting();
    statusReply('{"loggedIn":false}');
    // the URL line is output too, so make lastWords empty by exiting with nothing but the typed code
    (a as any).attempt.out = '';
    const r = a.submitCode('code1');
    const assertion = expect(r).rejects.toThrow(/Claude did not sign in\. Try again\./);
    await vi.advanceTimersByTimeAsync(10);
    p.exit();
    await assertion;
  });
  it('tells you to start again when the code is rejected, and cancels the login', async () => {
    const { a, p } = await waiting();
    const r = a.submitCode('bad');
    const assertion = expect(r).rejects.toThrow(/Invalid code\. Start again for a new code\./);
    await vi.advanceTimersByTimeAsync(10);
    p.say('bad\r\nInvalid code.\r\n');
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
    expect(p.kill).toHaveBeenCalled();
  });
  it('uses a general message when a rejection has nothing but the echoed code', async () => {
    const { a, p } = await waiting();
    const r = a.submitCode('bad-error');
    const assertion = expect(r).rejects.toThrow(/Claude did not accept that code\. Start again/);
    await vi.advanceTimersByTimeAsync(10);
    p.say('bad-error');
    await vi.advanceTimersByTimeAsync(200);
    await assertion;
  });
  it('gives up when the command stays silent for 45 seconds', async () => {
    const { a, p } = await waiting();
    const r = a.submitCode('code');
    const assertion = expect(r).rejects.toThrow(/Claude did not answer\. Start again\./);
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;
    expect(p.kill).toHaveBeenCalled();
  });
  it('does not clear a newer attempt when an older one finishes', async () => {
    const { a, p } = await waiting();
    statusReply('{"loggedIn":true,"authMethod":"x"}');
    const r = a.submitCode('code');
    await vi.advanceTimersByTimeAsync(10);
    const newer = { pty: fakePty(), out: '', timer: setTimeout(() => {}, 1) };
    (a as any).attempt = newer;
    p.exit();
    await r;
    expect((a as any).attempt).toBe(newer);
  });
});

describe('logout', () => {
  it('cancels any login, runs logout, and returns the new status', async () => {
    exec.fn.mockImplementation((_e: string, args: string[], _o: any, cb: any) => args[1] === 'logout' ? cb(null, '') : cb(null, '{"loggedIn":false,"authMethod":"none"}'));
    const a = new ClaudeAuth(() => 'cc');
    expect((await a.logout()).loggedIn).toBe(false);
    expect(exec.fn.mock.calls.map((c) => c[1][1])).toEqual(['logout', 'status']);
  });
});
