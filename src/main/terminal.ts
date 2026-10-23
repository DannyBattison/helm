import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { home, uid } from './util';

interface Term {
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
}

let ptyMod: any | undefined;
function loadPty() {
  if (ptyMod !== undefined) return ptyMod;
  try { ptyMod = require('@homebridge/node-pty-prebuilt-multiarch'); } catch { ptyMod = null; }
  return ptyMod;
}

export class Terminals {
  private terms = new Map<string, Term>();
  constructor(private onData: (id: string, d: string) => void, private onExit: (id: string) => void) {}

  open(cwd: string | null, cols: number, rows: number): string {
    const id = uid();
    const dir = cwd || home;
    const win = process.platform === 'win32';
    const shell = process.env.SHELL || (win ? 'powershell.exe' : '/bin/bash');
    const pty = loadPty();
    let why = pty ? '' : ' (the terminal module did not load)';
    if (pty) {
      try {
        const p = pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: dir, env: process.env });
        p.onData((d: string) => this.onData(id, d));
        p.onExit(() => { this.terms.delete(id); this.onExit(id); });
        this.terms.set(id, { write: (d) => p.write(d), resize: (c, r) => { try { p.resize(c, r); } catch { /* exited */ } }, kill: () => { try { p.kill(); } catch { /* exited */ } } });
        return id;
      } catch (e: any) { why = ': ' + String(e?.message || e); }
    }
    const ps = /powershell|pwsh/i.test(shell);
    const child: ChildProcessWithoutNullStreams = spawn(shell, ps ? ['-NoLogo'] : ['-i'], { cwd: dir, env: process.env });
    this.onData(id, `\x1b[2mNo pseudo-terminal available${why}. Using a plain shell.\x1b[0m\r\n`);
    child.stdout.on('data', (d) => this.onData(id, d.toString().replace(/\r?\n/g, '\r\n')));
    child.stderr.on('data', (d) => this.onData(id, d.toString().replace(/\r?\n/g, '\r\n')));
    child.on('exit', () => { this.terms.delete(id); this.onExit(id); });
    // Without a tty there is no line editing, so echo input and send complete lines.
    let line = '';
    this.terms.set(id, {
      write: (d) => {
        for (const ch of d) {
          if (ch === '\r') { this.onData(id, '\r\n'); child.stdin.write(line + '\n'); line = ''; }
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
