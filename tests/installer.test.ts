import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entryOf, installNpmTool, isManaged, NPM_TOOLS, ollamaCommand, toolsDir } from '../src/core/installer';
import { findExe } from '../src/core/qwenBackend';

const tmp = () => mkdtempSync(join(tmpdir(), 'helm-install-'));

/** A stand-in for npm-cli.js: "installs" the package named on its command line, or fails. */
const fakeNpm = (dir: string, bin: unknown, fail = false) => {
  const f = join(dir, 'npm-cli.js');
  writeFileSync(f, `
    const { mkdirSync, writeFileSync } = require('node:fs'); const { join } = require('node:path');
    const a = process.argv.slice(2);
    const prefix = a[a.indexOf('--prefix') + 1];
    const pkg = a.find((x) => x.endsWith('@latest')).replace(/@latest$/, '');
    process.stdout.write(JSON.stringify(a.filter((x) => x.startsWith('--'))) + '\\n');
    if (${fail}) { console.error('npm ERR! network'); process.exit(1); }
    const d = join(prefix, 'node_modules', ...pkg.split('/')); mkdirSync(join(d, 'bin'), { recursive: true });
    writeFileSync(join(d, 'package.json'), JSON.stringify({ name: pkg, bin: ${JSON.stringify(bin)} }));
  `);
  return f;
};

describe('installing agent tools', () => {
  it('installs into helm\'s tools folder without running scripts, and returns the script to run', async () => {
    const data = tmp();
    const entry = await installNpmTool({ dataDir: data, npmCli: fakeNpm(tmp(), { codex: 'bin/codex.js' }), tool: NPM_TOOLS.codex });
    expect(entry).toBe(join(toolsDir(data), 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
    expect(isManaged(data, entry)).toBe(true);
    expect(isManaged(data, '/usr/local/bin/codex')).toBe(false);
    expect(isManaged(data, undefined)).toBe(false);
    expect(isManaged(data, toolsDir(data) + '-other/codex')).toBe(false);
  });
  it('reads a bin given as a string or under another name', async () => {
    const data = tmp();
    expect((await installNpmTool({ dataDir: data, npmCli: fakeNpm(tmp(), 'cli.js'), tool: NPM_TOOLS.qwen })).endsWith('cli.js')).toBe(true);
    const other = tmp();
    await installNpmTool({ dataDir: other, npmCli: fakeNpm(tmp(), { 'qwen-code': 'x.js' }), tool: NPM_TOOLS.qwen });
    expect((await entryOf(toolsDir(other), NPM_TOOLS.qwen)).endsWith('x.js')).toBe(true);
  });
  it('says why an install failed, and when npm is missing', async () => {
    await expect(installNpmTool({ dataDir: tmp(), npmCli: fakeNpm(tmp(), 'a.js', true), tool: NPM_TOOLS.codex })).rejects.toThrow(/Installing Codex failed[\s\S]*network/);
    await expect(installNpmTool({ dataDir: tmp(), npmCli: '/nonexistent/npm-cli.js', tool: NPM_TOOLS.codex })).rejects.toThrow(/npm that comes with helm/);
  });
  it('shows Ollama\'s installer command for the system', () => {
    expect(ollamaCommand()).toBe(process.platform === 'win32' ? 'irm https://ollama.com/install.ps1 | iex' : 'curl -fsSL https://ollama.com/install.sh | sh');
  });
});

describe('finding a program installed since helm started', () => {
  it('looks on the PATH, and takes a configured path over anything', () => {
    const dir = tmp();
    const name = process.platform === 'win32' ? 'zz-helm-probe.exe' : 'zz-helm-probe';
    writeFileSync(join(dir, name), '');
    const was = process.env.PATH;
    process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + was;
    try {
      expect(findExe('zz-helm-probe')).toBe(join(dir, name));
      expect(findExe('zz-helm-probe', '/custom/x')).toBe('/custom/x');
    } finally { process.env.PATH = was; }
  });
});
