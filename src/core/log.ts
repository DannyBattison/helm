import { appendFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';

const ring: string[] = [];
let file = '';
let size = 0;
let pending: Promise<void> = Promise.resolve();

const stamp = () => new Date().toISOString();

export function logLine(level: 'info' | 'warn' | 'error', message: string) {
  const line = `${stamp()} ${level.toUpperCase()} ${message.replace(/\r?\n/g, '\n    ')}`;
  ring.push(line);
  if (ring.length > 400) ring.splice(0, ring.length - 400);
  if (!file) return;
  size += line.length + 1;
  pending = pending.then(async () => {
    try {
      if (size > 1_000_000) { await rename(file, file.replace(/\.log$/, '.old.log')); size = line.length; }
      await appendFile(file, line + '\n');
    } catch { /* logging must never throw */ }
  });
}

export const recentLog = () => ring.slice();
/** Resolves once every queued line has been written. */
export const flushLog = () => pending;
export const logFile = () => file;

/** Keeps what goes wrong: warnings and errors printed by the main process, and exceptions nobody caught. */
export async function installLogging(dir: string) {
  file = join(dir, 'helm.log');
  try { size = (await stat(file)).size; } catch { size = 0; }
  const fmt = (a: unknown[]) => a.map((x) => (x instanceof Error ? x.stack || x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...a: unknown[]) => { logLine(level, fmt(a)); orig(...a); };
  }
  process.on('uncaughtException', (e) => logLine('error', 'uncaught exception: ' + (e.stack || e.message)));
  process.on('unhandledRejection', (e) => logLine('error', 'unhandled rejection: ' + fmt([e])));
  logLine('info', 'helm started');
}
