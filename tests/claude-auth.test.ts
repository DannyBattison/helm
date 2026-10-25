import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAuth, findLoginUrl, lastWords, parseStatus, plain, without } from '../src/main/claudeAuth';

// What `claude auth login` really prints under a terminal: a link wrapped in an OSC-8 hyperlink, the same address in colour, then a prompt.
const URL_ = 'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=abc&code_challenge_method=S256&state=xyz';
const REAL = `Opening browser to sign in…\r\nIf the browser didn't open, visit: \u001b]8;;${URL_}\u0007\u001b[94m${URL_}\u001b[39m\u001b]8;;\u0007\r\nPaste code here if prompted > `;

describe('reading what the login command prints', () => {
  it('finds the address to open, once, without the terminal codes', () => {
    expect(findLoginUrl(REAL)).toBe(URL_);
  });
  it('finds nothing until the address has been printed', () => {
    expect(findLoginUrl('Opening browser to sign in…\r\n')).toBeNull();
    expect(findLoginUrl('')).toBeNull();
  });
  it('only offers Anthropic\'s own sites, since the address is opened in your browser', () => {
    expect(findLoginUrl('visit https://evil.example/claude.com/oauth')).toBeNull();
    expect(findLoginUrl('visit https://claude.com.evil.example/x')).toBeNull();
    expect(findLoginUrl('visit https://claude.ai/login?x=1 now')).toBe('https://claude.ai/login?x=1');
  });
  it('strips colours, links and carriage returns', () => {
    expect(plain('\u001b[94mhi\u001b[39m\r\n')).toBe('hi\n');
  });
  it('does not show your code back in a message, though the terminal echoes it', () => {
    const out = 'wrong-code\r\nInvalid code. Please try again.\r\nPaste code here if prompted > ';
    expect(lastWords(without(out, 'wrong-code'))).toBe('Invalid code. Please try again.');
    expect(without('abc', '')).toBe('abc');
  });
  it('reports the last things said, without the prompt', () => {
    expect(lastWords('one\r\ntwo\r\nInvalid code. Please try again.\r\nPaste code here if prompted > ')).toBe('two Invalid code. Please try again.');
    expect(lastWords('')).toBe('');
  });
});

describe('who is signed in', () => {
  it('reads Claude Code\'s own status', () => {
    expect(parseStatus('{"loggedIn":true,"authMethod":"claude.ai","email":"a@b.c","subscriptionType":"max"}')).toEqual({ loggedIn: true, method: 'claude.ai', email: 'a@b.c', plan: 'max' });
    expect(parseStatus('{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}')).toEqual({ loggedIn: false, method: 'none', email: undefined, plan: undefined });
  });
});

describe('the login itself', () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.CLAUDE_CODE_OAUTH_TOKEN };
  afterEach(() => {
    for (const [k, v] of [['ANTHROPIC_API_KEY', saved.key], ['CLAUDE_CODE_OAUTH_TOKEN', saved.token]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('counts a key or token in the environment as signed in, since agents use it', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    expect(await new ClaudeAuth(() => 'does-not-exist').status()).toEqual({ loggedIn: true, method: 'api key' });
    delete process.env.ANTHROPIC_API_KEY;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'x';
    expect(await new ClaudeAuth(() => 'does-not-exist').status()).toEqual({ loggedIn: true, method: 'subscription token' });
  });

  it('says plainly when the claude command is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const s = await new ClaudeAuth(() => 'no-such-claude-command').status();
    expect(s.loggedIn).toBe(false);
    expect(s.error).toMatch(/not found/);
  });

  it('refuses a code when no sign-in is waiting', async () => {
    await expect(new ClaudeAuth(() => 'x').submitCode('abc')).rejects.toThrow(/No sign-in is waiting/);
  });
});
