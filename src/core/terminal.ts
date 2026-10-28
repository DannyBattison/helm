import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { ShellOption } from '../shared/types';
import { home, uid } from './util';

interface Term {
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
}

interface Shell {
  id: string;
  label: string;
  cmd: string;
  args: (cwd: string) => string[];
}

let ptyMod: any | undefined;
function loadPty() {
  if (ptyMod !== undefined) return ptyMod;
  try { ptyMod = require('@homebridge/node-pty-prebuilt-multiarch'); } catch { ptyMod = null; }
  return ptyMod;
}

const win = process.platform === 'win32';

/** The first place on the PATH, or in the extra places given, that has an executable of this name. */
function find(names: string[], extra: string[] = []): string | null {
  const dirs = [...(process.env.PATH || '').split(delimiter), ...extra].filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = join(d, n); if (existsSync(p)) return p; }
  return null;
}

/** `wsl -l -q` prints UTF-16. */
function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    if (!win) return resolve([]);
    execFile('wsl.exe', ['-l', '-q'], { encoding: 'buffer', timeout: 4000, windowsHide: true }, (err, out) => {
      if (err) return resolve([]);
      const text = Buffer.isBuffer(out) ? out.toString('utf16le') : String(out);
      resolve(text.split(/\r?\n/).map((l) => l.replace(/\0/g, '').trim()).filter((l) => l && !/^docker-desktop/.test(l)));
    });
  });
}

let cache: Shell[] | null = null;

/** The shells this computer has, best first: zsh, then the user's own SHELL, Git Bash, WSL, PowerShell, cmd. */
export async function detectShells(): Promise<Shell[]> {
  if (cache) return cache;
  const out: Shell[] = [];
  const add = (s: Shell | null) => { if (s && !out.some((x) => x.id === s.id)) out.push(s); };
  const zsh = find(win ? ['zsh.exe'] : ['zsh'], win ? [] : ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']);
  if (zsh) add({ id: 'zsh', label: 'zsh', cmd: zsh, args: () => ['-i'] });
  if (!win) {
    const own = process.env.SHELL;
    if (own && existsSync(own) && !/zsh$/.test(own)) add({ id: 'login', label: own.split('/').pop() || 'Login shell', cmd: own, args: () => ['-i'] });
    for (const p of ['/bin/bash', '/usr/bin/bash']) if (existsSync(p)) { add({ id: 'bash', label: 'bash', cmd: p, args: () => ['-i'] }); break; }
  } else {
    const gitBash = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean).map((d) => join(d as string, 'Git', 'bin', 'bash.exe')).find((p) => existsSync(p));
    // A login shell, so it reads your profile and has the usual prompt, and CHERE_INVOKING keeps it in the folder it was opened in.
    if (gitBash) add({ id: 'git-bash', label: 'Git Bash', cmd: gitBash, args: () => ['--login', '-i'] });
    for (const d of await wslDistros()) add({ id: 'wsl:' + d, label: `WSL: ${d}`, cmd: 'wsl.exe', args: (cwd) => ['-d', d, '--cd', cwd] });
    const pwsh = find(['pwsh.exe']);
    if (pwsh) add({ id: 'pwsh', label: 'PowerShell 7', cmd: pwsh, args: () => ['-NoLogo'] });
    add({ id: 'powershell', label: 'Windows PowerShell', cmd: 'powershell.exe', args: () => ['-NoLogo'] });
    add({ id: 'cmd', label: 'Command Prompt', cmd: process.env.ComSpec || 'cmd.exe', args: () => [] });
  }
  cache = out;
  return out;
}

export async function shellOptions(): Promise<ShellOption[]> {
  return (await detectShells()).map((s) => ({ id: s.id, label: s.label }));
}

export class Terminals {
  private terms = new Map<string, Term>();
  constructor(private onData: (id: string, d: string) => void, private onExit: (id: string) => void) {}

  /** `choice` is a shell id from `shellOptions`, `auto`, or `custom` (with the command in `custom`). */
  async open(cwd: string | null, cols: number, rows: number, choice = 'auto', custom = '', extraEnv: Record<string, string> = {}): Promise<string> {
    const id = uid();
    const dir = cwd || home;
    const shells = await detectShells();
    let sh: Shell | undefined;
    if (choice === 'custom' && custom.trim()) {
      const parts = custom.trim().match(/"[^"]+"|\S+/g)!.map((x) => x.replace(/^"|"$/g, ''));
      sh = { id: 'custom', label: custom, cmd: parts[0], args: () => parts.slice(1) };
    } else if (choice !== 'auto') sh = shells.find((s) => s.id === choice);
    sh ||= shells[0] || { id: 'fallback', label: 'shell', cmd: win ? 'powershell.exe' : '/bin/sh', args: () => [] };
    const pty = loadPty();
    let why = pty ? '' : ' (the terminal module did not load)';
    const env = { ...process.env, ...extraEnv, TERM: 'xterm-256color', COLORTERM: 'truecolor', CHERE_INVOKING: '1' } as Record<string, string>;
    if (pty) {
      try {
        const p = pty.spawn(sh.cmd, sh.args(dir), { name: 'xterm-256color', cols, rows, cwd: dir, env });
        p.onData((d: string) => this.onData(id, d));
        p.onExit(() => { this.terms.delete(id); this.onExit(id); });
        this.terms.set(id, { write: (d) => p.write(d), resize: (c, r) => { try { p.resize(c, r); } catch { /* exited */ } }, kill: () => { try { p.kill(); } catch { /* exited */ } } });
        return id;
      } catch (e: any) { why = `: could not start ${sh.label} (${String(e?.message || e)})`; }
    }
    // No native module: `script` gives a real pseudo-terminal (line editing, Tab completion, history, full-screen programs).
    const script = win ? null : find(['script'], ['/usr/bin', '/bin']);
    if (script && !/powershell|pwsh/i.test(sh.cmd)) {
      const mac = process.platform === 'darwin';
      const quoted = [sh.cmd, ...sh.args(dir)].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
      const child = spawn(script, mac ? ['-q', '/dev/null', sh.cmd, ...sh.args(dir)] : ['-qfc', `stty cols ${cols} rows ${rows}; exec ${quoted}`, '/dev/null'], { cwd: dir, env });
      child.stdout.on('data', (d) => this.onData(id, d.toString()));
      child.stderr.on('data', (d) => this.onData(id, d.toString()));
      child.on('exit', () => { this.terms.delete(id); this.onExit(id); });
      this.terms.set(id, { write: (d) => { try { child.stdin.write(d); } catch { /* exited */ } }, resize: () => undefined, kill: () => child.kill() });
      return id;
    }
    const ps = /powershell|pwsh/i.test(sh.cmd);
    const child: ChildProcessWithoutNullStreams = spawn(sh.cmd, ps ? ['-NoLogo'] : ['-i'], { cwd: dir, env });
    this.onData(id, `\x1b[2mNo pseudo-terminal available${why}. Using a plain shell.\x1b[0m\r\n`);
    child.stdout.on('data', (d) => this.onData(id, d.toString().replace(/\r?\n/g, '\r\n')));
    child.stderr.on('data', (d) => this.onData(id, d.toString().replace(/\r?\n/g, '\r\n')));
    child.on('exit', () => { this.terms.delete(id); this.onExit(id); });
    // Without a tty there is no line editing, so echo input and send complete lines. Pasted text arrives as one chunk.
    let line = '';
    this.terms.set(id, {
      write: (d) => {
        for (const ch of d) {
          if (ch === '\r' || ch === '\n') { this.onData(id, '\r\n'); child.stdin.write(line + '\n'); line = ''; }
          else if (ch === '\x7f') { if (line) { line = line.slice(0, -1); this.onData(id, '\b \b'); } }
          else if (ch >= ' ') { line += ch; this.onData(id, ch); }
        }
      },
      resize: () => undefined,
      kill: () => child.kill()
    });
    return id;
  }

  write(id: string, d: string) { this.terms.get(id)?.write(d); }
  resize(id: string, c: number, r: number) { this.terms.get(id)?.resize(c, r); }
  close(id: string) { this.terms.get(id)?.kill(); this.terms.delete(id); }
  closeAll() { for (const t of this.terms.values()) t.kill(); this.terms.clear(); }
}
