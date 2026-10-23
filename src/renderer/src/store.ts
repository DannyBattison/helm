import { useSyncExternalStore } from 'react';
import type { AppState, HelmEvents, Session, TranscriptEvent } from '@shared/types';
import { api, on } from './api';

export type Route =
  | { screen: 'overview'; filter?: string }
  | { screen: 'activity' }
  | { screen: 'repo'; id: string }
  | { screen: 'session'; id: string; tab?: string }
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
  toasts: ToastItem[];
  adding: boolean;
  newSession: { repoId?: string } | null;
  palette: boolean;
  term: boolean;
  /** Set while resolving the first state snapshot fails. */
  fatal?: string;
}

function loadRoute(): Route {
  try { return JSON.parse(localStorage.getItem('helm-route') || '') || { screen: 'overview' }; } catch { return { screen: 'overview' }; }
}

let ui: UI = { app: null, route: loadRoute(), transcripts: {}, toasts: [], adding: false, newSession: null, palette: false, term: false };
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
  try {
    setUI({ app: await api.getState() });
  } catch (e: any) {
    setUI({ fatal: String(e?.message || e) });
  }
}

// ---- selectors
export const useApp = () => useUI((u) => u.app)!;
export const useSession = (id: string): Session | undefined => useUI((u) => u.app?.sessions.find((s) => s.id === id));
export const useTranscript = (id: string) => useUI((u) => u.transcripts[id]);
