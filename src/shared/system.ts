/** Cumulative CPU time in ms across all cores, as `os.cpus()` reports it. */
export interface CpuTimes { busy: number; total: number }

/** One reading, kept so the graphs have a past. `disk` is the free bytes on the disk holding helm's data. */
export interface SystemPoint { t: number; cpu: number | null; mem: number; rss: number; proc: number | null; load: number; disk: number | null }

export const HISTORY_LIMIT = 720;

export interface SystemStatus {
  at: number;
  platform: string;
  arch: string;
  hostname: string;
  uptime: number;
  /** Whole-machine CPU use since the last call (0..1), or null on the first call. */
  cpu: number | null;
  cores: number;
  model: string;
  load: [number, number, number];
  /** Memory of the machine, or of the container when it has a limit. */
  memory: { total: number; used: number; limited: boolean };
  swap?: { total: number; used: number };
  /** The helm process itself: the desktop's main process, or the server. */
  process: { rss: number; heap: number; cpu: number | null; pid: number };
  /** Disk holding helm's data, and the one holding the worktrees. */
  disks: { label: string; path: string; total: number; free: number }[];
  /** Readings every few seconds since helm started, oldest first. */
  history: SystemPoint[];
  sessions: { running: number; total: number };
}

/** CPU use between two readings, 0..1; null when there is nothing to compare or no time passed. */
export function cpuUse(prev: CpuTimes | null, cur: CpuTimes): number | null {
  if (!prev) return null;
  const total = cur.total - prev.total;
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, (cur.busy - prev.busy) / total));
}

/** Sums `os.cpus()` times into busy and total milliseconds. */
export function cpuTimes(cpus: { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]): CpuTimes {
  let busy = 0, total = 0;
  for (const c of cpus) {
    const t = c.times;
    busy += t.user + t.nice + t.sys + t.irq;
    total += t.user + t.nice + t.sys + t.irq + t.idle;
  }
  return { busy, total };
}

/** A cgroup limit file holds a number, `max`, or (v1) a huge number meaning unlimited. Resolves to bytes or null. */
export function parseLimit(text: string | null | undefined, hostTotal: number): number | null {
  const n = Number(String(text ?? '').trim());
  if (!Number.isFinite(n) || n <= 0 || n >= hostTotal) return null;
  return n;
}

export const bytesText = (n: number) => (n >= 1e12 ? (n / 1e12).toFixed(2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.max(0, Math.round(n / 1e3)) + ' kB');

export const durationText = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
