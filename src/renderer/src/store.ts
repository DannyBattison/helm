import { useSyncExternalStore } from 'react';
import type { AppState, ExternalSession, HelmEvents, Session, TranscriptEvent } from '@shared/types';
import { currencySymbol, fmtMoney, fromDisplay, toDisplay } from '@shared/money';
import { api, on } from './api';

export type Route =
  | { screen: 'overview'; filter?: string }
  | { screen: 'activity' }
  | { screen: 'archive' }
  | { screen: 'repo'; id: string; tab?: string }
  | { screen: 'external'; repoId: string; id: string }
  | { screen: 'session'; id: string; tab?: string; sub?: string; file?: string; line?: number }
  | { screen: 'settings'; section?: string };

export interface ToastItem {
  id: number;
  tone: 'ready' | 'attention' | 'error' | 'neutral';
  title: string;
  description?: string;
  sessionId?: string;
  tab?: string;
}

export interface UI {
  app: AppState | null;
  route: Route;
  transcripts: Record<string, TranscriptEvent[]>;
  /** Claude Code sessions helm did not start, per repository id. */
  externals: Record<string, ExternalSession[]>;
  toasts: ToastItem[];
  adding: boolean;
  newSession: { repoId?: string } | null;
  /** The session whose delete dialog is open. */
  deleting: string | null;
  mergingPr: { repoId: string; number: number; sessionId?: string } | null;
  renaming: string | null;
  /** The repository whose remove dialog is open. */
  removingRepo: string | null;
  /** Show archived sessions in the left tree. Off by default. */
  showArchived: boolean;
  palette: boolean;
  term: boolean;
  /** Set while resolving the first state snapshot fails. */
  fatal?: string;
}

function loadRoute(): Route {
  try {
    // If the last start never got going (the window froze on the page it restored), do not go back to that page.
    const started = localStorage.getItem('helm-start-at');
    const settled = localStorage.getItem('helm-start-ok');
    const crashed = started && settled !== started;
    localStorage.setItem('helm-start-at', String(Date.now()));
    setTimeout(() => { try { localStorage.setItem('helm-start-ok', localStorage.getItem('helm-start-at') || ''); } catch { /* storage unavailable */ } }, 6000);
    if (crashed) return { screen: 'overview' };
    return JSON.parse(localStorage.getItem('helm-route') || '') || { screen: 'overview' };
  } catch { return { screen: 'overview' }; }
}

let ui: UI = { app: null, route: loadRoute(), transcripts: {}, externals: {}, toasts: [], adding: false, newSession: null, deleting: null, mergingPr: null, renaming: null, removingRepo: null, showArchived: (() => { try { return localStorage.getItem('helm-show-archived') === '1'; } catch { return false; } })(), palette: false, term: false };
const listeners = new Set<() => void>();

export function setUI(patch: Partial<UI> | ((u: UI) => Partial<UI>)) {
  ui = { ...ui, ...(typeof patch === 'function' ? patch(ui) : patch) };
  listeners.forEach((l) => l());
}
export const getUI = () => ui;
export function useUI<T>(sel: (u: UI) => T): T {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => sel(ui));
}

export function go(route: Route) {
  try { localStorage.setItem('helm-route', JSON.stringify(route)); } catch { /* storage unavailable */ }
  setUI({ route });
}

let toastId = 1;
export function toast(t: Omit<ToastItem, 'id'>) {
  const id = toastId++;
  setUI((u) => ({ toasts: [...u.toasts.slice(-3), { ...t, id }] }));
  setTimeout(() => dismissToast(id), 9000);
}
export const dismissToast = (id: number) => setUI((u) => ({ toasts: u.toasts.filter((t) => t.id !== id) }));

export async function loadTranscript(id: string) {
  const t = await api.getTranscript(id);
  setUI((u) => ({ transcripts: { ...u.transcripts, [id]: t } }));
}

/** Local Claude Code sessions from outside helm, for every repository. Cheap enough to repeat while the window is in use. */
let externalsBusy = false;
export async function refreshExternals() {
  const repos = ui.app?.repos;
  if (!repos?.length || externalsBusy) return;
  externalsBusy = true;
  try {
    const entries = await Promise.all(repos.map(async (r) => [r.id, await api.listExternalSessions(r.id).catch(() => [] as ExternalSession[])] as const));
    setUI({ externals: Object.fromEntries(entries) });
  } finally { externalsBusy = false; }
}

export async function init() {
  on('state', (app) => setUI({ app }));
  on('transcript', ({ sessionId, index, event }) => {
    setUI((u) => {
      const cur = u.transcripts[sessionId];
      if (!cur) return {};
      const next = cur.slice();
      next[index] = event;
      return { transcripts: { ...u.transcripts, [sessionId]: next } };
    });
  });
  on('toast', (t: HelmEvents['toast']) => toast(t));
  on('navigate', (n) => go(n as Route));
  setInterval(() => { if (document.hasFocus()) void refreshExternals(); }, 15000);
  window.addEventListener('focus', () => void refreshExternals());
  try {
    setUI({ app: await api.getState() });
    void refreshExternals();
  } catch (e: any) {
    setUI({ fatal: String(e?.message || e) });
  }
}

// ---- selectors
export const useApp = () => useUI((u) => u.app)!;
export const useSession = (id: string): Session | undefined => useUI((u) => u.app?.sessions.find((s) => s.id === id));
export const useTranscript = (id: string) => useUI((u) => u.transcripts[id]);

/** Formats USD amounts in the user's display currency. `from` and `to` convert typed amounts. */
export function useMoney() {
  const app = useApp();
  const cur = app.settings.currency;
  return {
    cur,
    sym: currencySymbol(cur),
    fmt: (usd: number, whole = false) => fmtMoney(usd, cur, app.rates, { whole }),
    to: (usd: number) => toDisplay(usd, cur, app.rates),
    from: (v: number) => fromDisplay(v, cur, app.rates)
  };
}

export const useSubscription = () => useUI((u) => u.app?.settings.billing === 'subscription');
