/** A prompt a session sends by itself at a set time, once or on repeat. */

export type Repeat = 'none' | 'hour' | 'day' | 'weekday' | 'week';

export interface ScheduledPrompt {
  id: string;
  text: string;
  /** When it is next sent (ms). */
  at: number;
  repeat: Repeat;
}

export const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'none', label: 'Once' },
  { value: 'hour', label: 'Every hour' },
  { value: 'day', label: 'Every day' },
  { value: 'weekday', label: 'Weekdays' },
  { value: 'week', label: 'Every week' }
];

/** The first time after `now` that a repeating prompt due at `at` comes round. A schedule that missed several slots fires once, then moves on. */
export function nextAfter(at: number, repeat: Repeat, now: number): number | null {
  if (repeat === 'none') return null;
  const d = new Date(at);
  for (let i = 0; i < 10_000 && d.getTime() <= now; i++) {
    if (repeat === 'hour') d.setHours(d.getHours() + 1);
    else {
      d.setDate(d.getDate() + (repeat === 'week' ? 7 : 1));
      if (repeat === 'weekday') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    }
  }
  return d.getTime();
}

/** Parses a `datetime-local` value (local time) into ms, or null. */
export function parseLocal(v: string): number | null {
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/** A `datetime-local` value for a moment, in local time. */
export function toLocal(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export function validateScheduled(text: string, at: number, now: number): string | null {
  if (!text.trim()) return 'Write the prompt to send.';
  if (!Number.isFinite(at)) return 'Choose when to send it.';
  if (at <= now) return 'Choose a time in the future.';
  return null;
}

export function describeScheduled(p: Pick<ScheduledPrompt, 'at' | 'repeat'>): string {
  const when = new Date(p.at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return p.repeat === 'none' ? when : `${when} · ${REPEATS.find((r) => r.value === p.repeat)!.label.toLowerCase()}`;
}
