// Colour schemes. A scheme is a tint for the surfaces (hue and saturation) and an accent for each theme; everything else is
// worked out from those, so a new scheme is one line. "helm" sets nothing and leaves the stylesheet's own colours.

export interface Scheme { id: string; name: string; hue: number; sat: number; dark: string; light: string }

export const SCHEMES: Scheme[] = [
  { id: 'helm', name: 'Helm', hue: 0, sat: 0, dark: '#a78bfa', light: '#7655d9' },
  { id: 'ocean', name: 'Ocean', hue: 215, sat: 30, dark: '#58a6ff', light: '#1f6feb' },
  { id: 'forest', name: 'Forest', hue: 150, sat: 18, dark: '#4cc38a', light: '#1a7f4b' },
  { id: 'ember', name: 'Ember', hue: 25, sat: 14, dark: '#f0883e', light: '#c2570c' },
  { id: 'rose', name: 'Rose', hue: 335, sat: 16, dark: '#f472b6', light: '#c026a3' },
  { id: 'graphite', name: 'Graphite', hue: 220, sat: 6, dark: '#c6c6d0', light: '#3d3d4a' },
];

export const ACCENT_SWATCHES = ['#a78bfa', '#58a6ff', '#4cc38a', '#f0883e', '#f472b6', '#e5534b', '#d4b106'];

export type StatusKey = 'working' | 'attention' | 'ready' | 'error';
export const STATUS_KEYS: StatusKey[] = ['working', 'attention', 'ready', 'error'];
export const STATUS_LABEL: Record<StatusKey, string> = { working: 'Working', attention: 'Needs attention', ready: 'Ready', error: 'Error' };

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (s: unknown): s is string => typeof s === 'string' && HEX.test(s);

function rgb(h: string): [number, number, number] { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; }
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return '#' + x.map((v, i) => hex2(v + (y[i] - v) * t)).join(''); };
const alpha = (h: string, a: number) => `rgba(${rgb(h).join(',')},${a})`;
const luma = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const hsl = (h: number, s: number, l: number) => `hsl(${h} ${s}% ${l}%)`;

function accentVars(a: string, dark: boolean): Record<string, string> {
  return {
    '--accent': a,
    '--accent-hover': mix(a, dark ? '#ffffff' : '#000000', 0.15),
    '--accent-press': mix(a, dark ? '#000000' : '#000000', dark ? 0.15 : 0.25),
    '--accent-text': dark ? mix(a, '#ffffff', 0.3) : mix(a, '#000000', 0.15),
    '--accent-muted': alpha(a, dark ? 0.14 : 0.1),
    '--bg-selected': alpha(a, dark ? 0.14 : 0.11),
    '--focus-ring': alpha(a, dark ? 0.55 : 0.45),
    '--text-on-accent': luma(a) > 0.4 ? '#14141a' : '#ffffff',
  };
}

function statusVars(k: StatusKey, c: string, dark: boolean): Record<string, string> {
  return {
    [`--status-${k}`]: c,
    [`--status-${k}-bg`]: alpha(c, dark ? 0.13 : 0.1),
    [`--status-${k}-text`]: dark ? mix(c, '#ffffff', 0.25) : mix(c, '#000000', 0.25),
  };
}

export interface Look { scheme?: string; accent?: string; status?: Partial<Record<StatusKey, string>> }

/** The CSS variables to set over the stylesheet's defaults for this scheme, accent and status colours. */
export function schemeVars(look: Look, dark: boolean): Record<string, string> {
  const s = SCHEMES.find((x) => x.id === look.scheme) ?? SCHEMES[0];
  const v: Record<string, string> = {};
  if (s.id !== 'helm') {
    const H = s.hue, S = s.sat;
    const L = dark ? { app: 6.5, side: 8.5, edit: 4.5, raised: 10.5, sub: 12, bor: 16, str: 23 } : { app: 98.5, side: 96, edit: 100, raised: 100, sub: 93, bor: 90, str: 83 };
    const sat = dark ? S : Math.min(S * 1.4, 40);
    Object.assign(v, {
      '--bg-app': hsl(H, sat, L.app), '--bg-sidebar': hsl(H, sat, L.side), '--bg-panel': hsl(H, sat, dark ? L.side : 97),
      '--bg-editor': hsl(H, sat, L.edit), '--bg-raised': hsl(H, sat, L.raised), '--bg-overlay': hsl(H, sat, L.raised), '--bg-input': hsl(H, sat, L.edit),
      '--border-subtle': hsl(H, sat, L.sub), '--border': hsl(H, sat, L.bor), '--border-strong': hsl(H, sat, L.str),
    });
    Object.assign(v, accentVars(dark ? s.dark : s.light, dark));
  }
  if (isHex(look.accent)) Object.assign(v, accentVars(look.accent, dark));
  for (const k of STATUS_KEYS) { const c = look.status?.[k]; if (isHex(c)) Object.assign(v, statusVars(k, c, dark)); }
  return v;
}
