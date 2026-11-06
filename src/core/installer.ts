import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * One-click installs of the agent command-line tools (desktop only). Codex and Qwen Code come from npm, using the npm that ships with
 * helm and run on Electron's own Node, into a folder of helm's own: nothing global is touched and no admin rights are needed.
 * Ollama is not an npm package, so it is installed with Ollama's own installer script.
 */

export interface NpmTool { id: 'codex' | 'qwen'; pkg: string; bin: string; label: string }
export const NPM_TOOLS: Record<string, NpmTool> = {
  codex: { id: 'codex', pkg: '@openai/codex', bin: 'codex', label: 'Codex' },
  qwen: { id: 'qwen', pkg: '@qwen-code/qwen-code', bin: 'qwen', label: 'Qwen Code' }
};

export const toolsDir = (dataDir: string) => join(dataDir, 'tools');
/** Whether a path is one of the tools helm installed itself. */
export const isManaged = (dataDir: string, path?: string) => !!path && resolve(path).startsWith(resolve(toolsDir(dataDir)) + (process.platform === 'win32' ? '\\' : '/'));

/** Runs a command, keeping the end of its output for an error message. Resolves with the exit code. */
function exec(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<{ code: number; out: string }> {
  return new Promise((done) => {
    const p = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const take = (d: Buffer) => { out = (out + d).slice(-4000); };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    const timer = setTimeout(() => { p.kill(); out += '\nTimed out.'; }, timeout);
    p.on('error', (e) => { clearTimeout(timer); done({ code: -1, out: e.message }); });
    p.on('exit', (code) => { clearTimeout(timer); done({ code: code ?? -1, out }); });
  });
}
const tail = (s: string) => s.trim().split('\n').slice(-6).join('\n').slice(-600);

/** The script a package's executable runs, read from its package.json, so it can be started by Electron's Node rather than by `#!/usr/bin/env node`. */
export async function entryOf(dir: string, tool: NpmTool): Promise<string> {
  const pj = join(dir, 'node_modules', ...tool.pkg.split('/'), 'package.json');
  const j = JSON.parse(await readFile(pj, 'utf8'));
  const bin = typeof j.bin === 'string' ? j.bin : j.bin?.[tool.bin] ?? Object.values<string>(j.bin || {})[0];
  if (!bin) throw new Error(`${tool.pkg} has no command to run.`);
  return join(dirname(pj), bin);
}

/**
 * Installs (or updates to the latest) a tool into helm's tools folder. `npmCli` is npm's `npm-cli.js`. Scripts are not run, which keeps
 * third-party install code off the machine; both tools get their native parts as ordinary packages. Resolves to the script to run.
 */
export async function installNpmTool(o: { dataDir: string; npmCli: string; tool: NpmTool }): Promise<string> {
  if (!existsSync(o.npmCli)) throw new Error('The npm that comes with helm is missing. Reinstall helm.');
  const dir = toolsDir(o.dataDir);
  await mkdir(dir, { recursive: true });
  // Without a package.json of its own, npm would look upward for one and install there.
  if (!existsSync(join(dir, 'package.json'))) await writeFile(join(dir, 'package.json'), '{"name":"helm-tools","private":true}\n');
  const r = await exec(process.execPath, [o.npmCli, 'install', '--prefix', dir, '--ignore-scripts', '--no-audit', '--no-fund', '--no-progress', '--loglevel=error', `${o.tool.pkg}@latest`], { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, 10 * 60_000);
  if (r.code !== 0) throw new Error(`Installing ${o.tool.label} failed.\n${tail(r.out) || 'npm gave no reason. Check your network connection.'}`);
  return entryOf(dir, o.tool);
}

export const OLLAMA_SH = 'curl -fsSL https://ollama.com/install.sh | sh';
export const OLLAMA_PS1 = 'irm https://ollama.com/install.ps1 | iex';
export const ollamaCommand = () => (process.platform === 'win32' ? OLLAMA_PS1 : OLLAMA_SH);

/**
 * Installs Ollama with its own installer: per user on Windows, into /Applications on macOS (which may ask for a password to link the
 * command, and which helm cannot answer), and system-wide with a service on Linux, which needs administrator rights.
 */
export async function installOllama(): Promise<void> {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const r = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', OLLAMA_PS1], env, 15 * 60_000);
    if (r.code !== 0) throw new Error(`Installing Ollama failed.\n${tail(r.out)}`);
    return;
  }
  if (process.platform === 'linux' && process.getuid?.() !== 0) {
    const sudo = await exec('sudo', ['-n', 'true'], env, 5000);
    if (sudo.code !== 0) throw new Error(`Ollama's installer needs administrator rights on Linux (it sets up a service), and helm cannot ask for your password. Run this in a terminal, then come back:\n${OLLAMA_SH}`);
  }
  const r = await exec('sh', ['-c', OLLAMA_SH], env, 15 * 60_000);
  if (r.code === 0) return;
  // On a Mac the app is in place before the command is linked into /usr/local/bin; the link is what may need a password, and helm finds the app's own copy.
  if (process.platform === 'darwin' && existsSync('/Applications/Ollama.app')) {
    await exec('open', ['-a', 'Ollama', '--args', 'hidden'], env, 10_000);
    return;
  }
  throw new Error(`Installing Ollama failed.\n${tail(r.out)}`);
}
