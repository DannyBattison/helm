import React from 'react';
import { createPortal } from 'react-dom';
import { inbox, inboxKey } from '@shared/inbox';
import { sessionTitle } from '@shared/types';
import { ago } from '../lib';
import { go, useApp } from '../store';
import { Badge, IconButton, StatusDot } from '../ui';
import { KIND } from './Inbox';

/** The bell in the title bar: a pop-up preview of what is waiting, with a way through to the full inbox. */
export function InboxPreview({ size }: { size: 'md' | 'lg' }) {
  const app = useApp();
  const items = React.useMemo(() => inbox(app.sessions), [app.sessions]);
  const need = app.sessions.filter((s) => s.status === 'attention').length;
  const [open, setOpen] = React.useState(false);
  const btn = React.useRef<HTMLSpanElement>(null);
  const pop = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', down); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [open]);
  const box = open ? btn.current?.getBoundingClientRect() : undefined;
  const shown = items.slice(0, 6);
  return (
    <span ref={btn} style={{ display: 'inline-flex' }}>
      <IconButton size={size} icon="bell" label="Inbox" badge={need > 0} active={open} onClick={() => setOpen((o) => !o)} />
      {open && box ? createPortal(
        <div ref={pop} role="dialog" aria-label="Inbox preview" className="no-drag" style={{ position: 'fixed', zIndex: 300, top: box.bottom + 6, right: Math.max(8, window.innerWidth - box.right), width: Math.min(340, window.innerWidth - 16), maxHeight: 'min(70vh, 460px)', overflowY: 'auto', padding: 4, borderRadius: 'var(--radius-lg)', background: 'var(--bg-overlay)', boxShadow: 'var(--shadow-popover)', animation: 'helm-in var(--dur) var(--ease-out)' }}>
          {shown.length === 0 ? <div style={{ padding: '14px 10px', font: '400 12.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Nothing needs you right now.</div> : shown.map((it) => (
            <div key={inboxKey(it)} role="button" tabIndex={0} className="helm-row-hover" onClick={() => { setOpen(false); go({ screen: 'inbox' }); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', minWidth: 0 }}>
              <StatusDot status={it.session.status} />
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span style={{ font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sessionTitle(it.session)}</span>
                <span style={{ font: '400 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>{ago(it.since)} ago</span>
              </span>
              <Badge tone={KIND[it.kind].tone as any} icon={KIND[it.kind].icon}>{KIND[it.kind].label}</Badge>
            </div>
          ))}
          <div role="button" tabIndex={0} className="helm-row-hover" onClick={() => { setOpen(false); go({ screen: 'inbox' }); }}
            style={{ marginTop: 2, padding: '8px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center', font: '500 12.5px/1.5 var(--font-sans)', color: 'var(--accent-text, var(--accent))', cursor: 'pointer' }}>
            {items.length > shown.length ? `Open inbox (${items.length - shown.length} more)` : 'Open inbox'}
          </div>
        </div>, document.body) : null}
    </span>
  );
}
