import React from 'react';
import { setUI, useUI } from '../store';
import { Button, Dialog, Meter } from '../ui';
import { percent } from '../uploads';

const size = (n: number) => (n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

/** In hosted helm, leaving or closing the tab would cut uploads off: the browser asks first, and this dialog shows what is still being sent. Inside the app, navigating never stops an upload. */
export function UploadsGuard() {
  const uploads = useUI((u) => u.uploads);
  const open = useUI((u) => u.uploadsOpen);
  const hosted = !!window.helmBridge?.hosted;
  const busy = hosted && uploads.length > 0;
  React.useEffect(() => {
    if (!busy) return;
    // Browsers only allow their own confirmation text here. When the user stays, the dialog below shows the progress.
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; setUI({ uploadsOpen: true }); };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [busy]);
  if (!busy || !open) return null;
  return (
    <Dialog width={460} title="Uploads in progress" description="Closing or leaving this tab would stop them. Stay on this page until they finish; you can keep using helm meanwhile."
      onClose={() => setUI({ uploadsOpen: false })} footer={<Button variant="primary" onClick={() => setUI({ uploadsOpen: false })}>Keep waiting</Button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {uploads.map((x) => (
          <Meter key={x.key} tone="accent" value={x.size ? x.sent : 1} max={x.size || 1} label={x.name} detail={x.size ? `${size(x.sent)} of ${size(x.size)} · ${percent(x)}%` : 'Empty file'} />
        ))}
      </div>
    </Dialog>
  );
}
