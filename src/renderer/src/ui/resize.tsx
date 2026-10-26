import React from 'react';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const read = (key: string) => { try { return localStorage.getItem('helm-size-' + key); } catch { return null; } };
const write = (key: string, v: string) => { try { localStorage.setItem('helm-size-' + key, v); } catch { /* storage unavailable */ } };

function track(onMove: (dx: number) => void, onEnd: () => void) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'col-resize';
    const mv = (ev: MouseEvent) => onMove(ev.clientX - x0);
    const up = () => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = prev;
      onEnd();
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  };
}

/**
 * A pane width that the user can drag. `dir` is 1 when the handle sits on the pane's right edge
 * and -1 when it sits on the left edge (a right-hand pane).
 */
export function usePaneWidth(key: string, def: number, min: number, max: number, dir: 1 | -1 = 1) {
  const [w, setW] = React.useState(() => { const v = parseFloat(read(key) || ''); return Number.isFinite(v) ? clamp(v, min, max) : def; });
  const ref = React.useRef(w);
  ref.current = w;
  const start = (e: React.MouseEvent) => {
    const w0 = ref.current;
    track((dx) => setW(clamp(w0 + dir * dx, min, max)), () => write(key, String(ref.current)))(e);
  };
  return [w, start, () => { setW(def); write(key, String(def)); }] as const;
}

/** The drag handle: place it inside a `position: relative` pane. */
export function Grip({ onMouseDown, onDoubleClick, edge = 'right' }: { onMouseDown: (e: React.MouseEvent) => void; onDoubleClick?: () => void; edge?: 'left' | 'right' }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} role="separator" aria-orientation="vertical"
      style={{ position: 'absolute', top: 0, bottom: 0, [edge]: -3, width: 6, cursor: 'col-resize', zIndex: 20, display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: 2, height: '100%', background: hover ? 'var(--accent)' : 'transparent', transition: 'background var(--dur-fast) var(--ease-out)' }} />
    </div>
  );
}

export interface Col {
  /** Default width in px. Ignored for the flexible column. */
  w: number;
  min: number;
  /** The column that absorbs leftover space. At most one. */
  flex?: boolean;
  /** Not resizable, and no handle after it. */
  fixed?: boolean;
}

/**
 * Column widths for a CSS-grid table. `template` goes into `gridTemplateColumns` for the header
 * and every row; `cell(i, label)` renders a header cell with a drag handle on its right edge.
 */
export function useColumns(key: string, cols: Col[]) {
  const sig = cols.map((c) => `${c.w}:${c.min}${c.flex ? 'f' : ''}${c.fixed ? 'x' : ''}`).join(',');
  const load = () => {
    try {
      const saved = JSON.parse(read(key) || 'null');
      if (Array.isArray(saved) && saved.length === cols.length) return cols.map((c, i) => (c.fixed || c.flex ? c.w : clamp(+saved[i] || c.w, c.min, 1200)));
    } catch { /* ignore */ }
    return cols.map((c) => c.w);
  };
  const [ws, setWs] = React.useState<number[]>(load);
  const ref = React.useRef(ws);
  ref.current = ws;
  React.useEffect(() => { setWs(load()); }, [sig]);

  const template = cols.map((c, i) => (c.flex ? `minmax(${c.min}px,1fr)` : `${c.fixed ? c.w : ws[i]}px`)).join(' ');

  const flexAt = cols.findIndex((c) => c.flex);
  const sized = (j: number) => j >= 0 && j < cols.length && !cols[j].fixed && !cols[j].flex;
  /**
   * What a drag on column i's right edge changes, so that the edge itself always follows the mouse:
   * - before the flexible column, or in a table with none: column i alone. The flexible column absorbs the change, or the table grows to the right.
   * - the flexible column: the column to its right, the other way round, so the flexible column's edge moves with the mouse.
   * - after the flexible column: column i and its right neighbour trade width. Resizing column i alone would move its left edge instead,
   *   because everything right of the flexible column is anchored to the table's right edge.
   * Returns null when the edge cannot move (nothing to take the space from).
   */
  const plan = (i: number): { grow?: number; take?: number } | null => {
    if (cols[i].fixed) return null;
    if (flexAt < 0 || i < flexAt) return { grow: i };
    if (i === flexAt) return sized(i + 1) ? { take: i + 1 } : null;
    return sized(i + 1) ? { grow: i, take: i + 1 } : null;
  };
  const start = (i: number) => (e: React.MouseEvent) => {
    const pl = plan(i);
    if (!pl) return;
    const w0 = [...ref.current];
    // Limits on how far the edge may move: neither column may drop below its minimum or pass 1200px.
    const lo = pl.grow != null ? cols[pl.grow].min - w0[pl.grow] : pl.take != null ? w0[pl.take] - 1200 : 0;
    const hi = Math.min(pl.grow != null ? 1200 - w0[pl.grow] : Infinity, pl.take != null ? w0[pl.take] - cols[pl.take].min : Infinity);
    track(
      (dx) => {
        const d = clamp(dx, Math.min(lo, hi), hi);
        setWs(w0.map((v, j) => (j === pl.grow ? v + d : j === pl.take ? v - d : v)));
      },
      () => write(key, JSON.stringify(ref.current))
    )(e);
  };
  const reset = () => { const d = cols.map((c) => c.w); setWs(d); write(key, JSON.stringify(d)); };

  const resizable = (i: number) => i < cols.length - 1 && plan(i) !== null;
  // A plain function, not a component: a component declared here would remount on every render and drop the drag.
  const cell = (i: number, children?: React.ReactNode, style?: React.CSSProperties) => (
    <span key={i} style={{ position: 'relative', minWidth: 0, ...style }}>
      {children}
      {resizable(i) ? (
        <span onMouseDown={start(i)} onDoubleClick={reset} title="Drag to resize. Double-click to reset."
          style={{ position: 'absolute', top: -6, bottom: -6, right: -8, width: 8, cursor: 'col-resize', display: 'flex', justifyContent: 'center', zIndex: 5 }}>
          <span style={{ width: 1, height: '100%', background: 'var(--border)' }} />
        </span>
      ) : null}
    </span>
  );
  // The narrowest the table can be. Below this a phone scrolls it sideways instead of squeezing the cells.
  const minWidth = cols.reduce((n, c, i) => n + (c.flex ? c.min : c.fixed ? c.w : ws[i]), 0) + 12 * (cols.length - 1);
  return { template, cell, reset, minWidth };
}

/** Phone widths: below this the sidebar is a drawer and every page lays itself out in one column. */
export const PHONE = 768;
/** Below this there is no room for a side panel next to the main content (the session's usage panel, the review sidebar): it folds away. */
export const COMPACT = 1100;

/** True while the window is narrower than `max` pixels. */
export function useNarrow(max = PHONE) {
  const query = `(max-width: ${max - 1}px)`;
  const [narrow, setNarrow] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setNarrow(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return narrow;
}

/** True when there is no room for a side panel next to the main content. */
export const useCompact = () => useNarrow(COMPACT);
