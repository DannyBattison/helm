import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const home = homedir();
export const expandHome = (p: string) => (p === '~' ? home : p.startsWith('~/') || p.startsWith('~\\') ? join(home, p.slice(2)) : p);
export const uid = () => Math.random().toString(36).slice(2, 10);

export function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, maxBuffer: 256 * 1024 * 1024, timeout: opts.timeout, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const e: any = new Error((stderr || stdout || err.message).toString().trim());
        e.code = (err as any).code;
        return reject(e);
      }
      resolve(stdout.toString());
    });
    if (opts.input != null) child.stdin?.end(opts.input);
  });
}

/** Start of the current week (Monday 00:00 local) as epoch ms. */
export function weekStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function dayStart(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Commands that always ask, whatever is allowed: they kill processes by name or in bulk, which takes down every agent helm runs. */
export const DEFAULT_ALWAYS_ASK = ['pkill *', 'killall *', 'killall5 *', 'skill *', 'xkill *', 'taskkill *', 'kill -1 *', 'kill * -1 *', 'kill 0 *', 'kill $(*', 'kill `*', 'xargs kill *'];

/**
 * True when any part of a chained command (split on `; & | newline`, past `sudo` and env assignments) matches one of the patterns.
 * Checked before the allow lists, so an "always allow" pattern can never cover these.
 */
export function matchesAlwaysAsk(patterns: string[], cmd: string): boolean {
  if (!patterns.length) return false;
  for (const raw of cmd.split(/[;&|\n]+/)) {
    let seg = raw.trim().replace(/^[({]\s*/, '');
    for (;;) {
      const next = seg.replace(/^(?:sudo|command|exec|env|nohup|time)\s+/, '').replace(/^[A-Za-z_]\w*=\S*\s+/, '').replace(/^\/\S*\//, '');
      if (next === seg) break;
      seg = next;
    }
    if (seg && patterns.some((p) => globMatch(p, seg) || globMatch(p, seg + ' _'))) return true;
  }
  return false;
}

/** Glob-ish match where `*` matches anything. */
export function globMatch(pattern: string, text: string): boolean {
  // `*` matches anything. Done by walking both strings, so no pattern can make it backtrack for long.
  const t = text.trim();
  let p = 0, i = 0, star = -1, mark = 0;
  while (i < t.length) {
    if (p < pattern.length && pattern[p] === '*') { star = p++; mark = i; }
    else if (p < pattern.length && pattern[p] === t[i]) { p++; i++; }
    else if (star >= 0) { p = star + 1; i = ++mark; }
    else return false;
  }
  while (p < pattern.length && pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Where a command's card is in a transcript. The place it was given when the command started can be wrong by the time the result
 * arrives, because a subagent's transcript is rebuilt from Claude Code's saved file in between, so look there first and then by id.
 * -1 when the card is gone (the rebuilt transcript already has the finished command).
 */
export function findBash(t: ({ k?: string; id?: string } | null | undefined)[], toolId: string, hint: number): number {
  const at = t[hint];
  if (at && at.k === 'bash' && at.id === toolId) return hint;
  return t.findIndex((e) => !!e && e.k === 'bash' && e.id === toolId);
}

/** Shell syntax that can chain, redirect or substitute, so one pattern must never cover a command using it. */
export const hasShellControl = (cmd: string) => /[;&|`<>\r\n]|\$\(|\$\{/.test(cmd);

/** Turn `pnpm test --update-snapshots` into `pnpm test *`. Compound commands get no pattern. */
export function commandPattern(cmd: string): string | undefined {
  if (hasShellControl(cmd)) return undefined;
  const words = cmd.trim().split(/\s+/);
  if (words.length <= 1) return words[0] + ' *';
  const take = ['git', 'npm', 'pnpm', 'yarn', 'go', 'cargo', 'make', 'docker', 'terraform', 'kubectl'].includes(words[0]) ? 2 : 1;
  return words.slice(0, take).join(' ') + ' *';
}
