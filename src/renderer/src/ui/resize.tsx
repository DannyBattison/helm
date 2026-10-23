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

  /** Dragging a flexible column's edge resizes the nearest sized column to its right, the other way round. */
  const start = (i: number) => (e: React.MouseEvent) => {
    const target = cols[i].flex ? cols.findIndex((c, j) => j > i && !c.fixed && !c.flex) : i;
    if (target < 0) return;
    const sign = cols[i].flex ? -1 : 1;
    const w0 = ref.current[target];
    track(
      (dx) => setWs((cur) => cur.map((v, j) => (j === target ? clamp(w0 + sign * dx, cols[target].min, 1200) : v))),
      () => write(key, JSON.stringify(ref.current))
    )(e);
  };
  const reset = () => { const d = cols.map((c) => c.w); setWs(d); write(key, JSON.stringify(d)); };

  const resizable = (i: number) => !cols[i].fixed && i < cols.length - 1 && (!cols[i].flex ? true : cols.some((c, j) => j > i && !c.fixed && !c.flex));
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
  return { template, cell, reset };
}
