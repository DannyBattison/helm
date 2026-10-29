import type React from 'react';

/** What a menu handler needs of a right-click, so a long press can stand in for one. */
export interface PressPoint { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }

const HOLD_MS = 450;
const SLOP = 10;
// One finger at a time, so the state is shared: a re-render between touchstart and the timer must not lose it.
let timer: number | undefined;
let from = { x: 0, y: 0 };
let firedAt = 0;
const cancel = () => { if (timer !== undefined) window.clearTimeout(timer); timer = undefined; };

/**
 * Props for an element with a right-click menu: the right click itself, and a long press for touch screens (iOS never sends a
 * contextmenu event; Android does, and opening twice at the same point is harmless). The click that ends a long press is swallowed.
 */
export function menuProps(open: (e: PressPoint) => void) {
  return {
    'data-longpress': '',
    onContextMenu: (e: React.MouseEvent) => open(e),
    onTouchStart: (e: React.TouchEvent) => {
      cancel();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      from = { x: t.clientX, y: t.clientY };
      timer = window.setTimeout(() => {
        timer = undefined;
        firedAt = Date.now();
        try { navigator.vibrate?.(12); } catch { /* not allowed */ }
        open({ clientX: from.x, clientY: from.y, preventDefault() {}, stopPropagation() {} });
      }, HOLD_MS);
    },
    onTouchMove: (e: React.TouchEvent) => { const t = e.touches[0]; if (t && Math.hypot(t.clientX - from.x, t.clientY - from.y) > SLOP) cancel(); },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onClickCapture: (e: React.MouseEvent) => { if (Date.now() - firedAt < 700) { e.stopPropagation(); e.preventDefault(); } }
  };
}
