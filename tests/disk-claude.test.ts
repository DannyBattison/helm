import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanHeavy, dirSize, reclaimable, reclaimableBytes } from '../src/core/disk';
import { ClaudeAuth, findLoginUrl, lastWords, parseStatus, plain, without } from '../src/core/claudeAuth';

let root: string;
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: root });
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-disk-'));
  g('init', '-q', '-b', 'main');
  writeFileSync(join(root, '.gitignore'), 'node_modules/\ndist/\n');
  mkdirSync(join(root, 'node_modules', 'p'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'p', 'i.js'), 'x'.repeat(5000));
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'o.js'), 'y'.repeat(100));
  mkdirSync(join(root, 'build'));
  writeFileSync(join(root, 'build', 'tracked.txt'), 'kept');
  g('add', '-f', 'build/tracked.txt', '.gitignore');
  g('commit', '-qm', 'i');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('disk', () => {
  it('measures a folder', async () => {
    const r = await dirSize(join(root, 'node_modules'));
    expect(r.bytes).toBeGreaterThanOrEqual(5000);
    expect(r.partial).toBe(false);
  });
  it('finds only ignored, untracked heavy folders, then removes them', async () => {
    expect((await reclaimable(root)).sort()).toEqual(['dist', 'node_modules']);
    expect((await reclaimableBytes(root)).bytes).toBeGreaterThan(5000);
    const out = await cleanHeavy(root);
    expect(out.removed.sort()).toEqual(['dist', 'node_modules']);
    expect(existsSync(join(root, 'node_modules'))).toBe(false);
    expect(existsSync(join(root, 'build', 'tracked.txt'))).toBe(true);
    expect(await reclaimable(join(root, 'nonexistent'))).toEqual([]);
  });
});

describe('claude auth helpers', () => {
  it('strips terminal escapes and finds the login address', () => {
    const out = '\x1b[32mOpen\x1b[0m \x1b]8;;x\x07link\x1b]8;;\x07 https://claude.ai/oauth/authorize?code=1&x=2\x1b[0m\r\nPaste code here';
    expect(plain(out)).not.toContain('\x1b');
    expect(findLoginUrl(out)).toBe('https://claude.ai/oauth/authorize?code=1&x=2');
    expect(findLoginUrl('https://evil.example/claude.ai/x')).toBeNull();
  });
  it('hides what was typed and summarises the last lines', () => {
    expect(without('echo SECRET done', 'SECRET')).toBe('echo  done');
    expect(without('abc', '')).toBe('abc');
    expect(lastWords('one\n\ntwo\nPaste code here\nthree\n')).toBe('two three');
    expect(lastWords('x'.repeat(500))).toHaveLength(300);
  });
  it('parses the status command output', () => {
    expect(parseStatus('{"loggedIn":true,"authMethod":"oauth","email":"a@b","subscriptionType":"max"}')).toEqual({ loggedIn: true, method: 'oauth', email: 'a@b', plan: 'max' });
    expect(parseStatus('{}')).toEqual({ loggedIn: false, method: 'none', email: undefined, plan: undefined });
    expect(() => parseStatus('nope')).toThrow();
  });
  it('treats keys in the environment as signed in, and reports a missing command', async () => {
    const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.CLAUDE_CODE_OAUTH_TOKEN };
    try {
      delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const a = new ClaudeAuth(() => '/no/such/claude');
      expect((await a.status()).error).toMatch(/not found/);
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 't';
      expect(await a.status()).toEqual({ loggedIn: true, method: 'subscription token' });
      process.env.ANTHROPIC_API_KEY = 'k';
      expect(await a.status()).toEqual({ loggedIn: true, method: 'api key' });
      await expect(a.submitCode('123')).rejects.toThrow(/No sign-in/);
      a.cancel();
    } finally {
      if (saved.k === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.k;
      if (saved.t === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN; else process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.t;
    }
  });
});
