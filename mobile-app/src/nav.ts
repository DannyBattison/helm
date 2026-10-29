/**
 * Which screen the phone app is on. `servers` is the list (and adding one), `instance` is a computer's own helm UI, `settings` is the
 * settings page. The two tabs are always visible; a computer that is open stays connected while Settings is shown over it, and tapping
 * Servers brings it back. Tapping Servers while looking at it goes back to the list (which closes it: helm's UI belongs to one computer per page load).
 */
export type View = 'servers' | 'instance' | 'settings';
export type Tab = 'servers' | 'settings';
export interface Move { view: View; /** Start the page afresh: the only way out of an open computer. */ reload?: boolean }

export function tapTab(view: View, tab: Tab, instanceOpen: boolean): Move {
  if (tab === 'settings') return { view: 'settings' };
  if (view === 'instance') return { view: 'servers', reload: true };
  if (view === 'settings' && instanceOpen) return { view: 'instance' };
  return { view: 'servers' };
}

/** The Android back button: out of a sub-screen, then off Settings or the open computer, then to the home screen. */
export function back(view: View, instanceOpen: boolean, onSubScreen: boolean): Move | 'minimize' {
  if (view === 'servers') return onSubScreen ? { view: 'servers' } : 'minimize';
  return tapTab(view, 'servers', instanceOpen);
}
