import React from 'react';
import { describeScheduled, parseLocal, REPEATS, toLocal, validateScheduled, type Repeat } from '@shared/scheduled';
import type { Session as S } from '@shared/types';
import { api } from '../api';
import { toast } from '../store';
import { Button, IconButton, Select } from '../ui';

/** The clock beside the paperclip: a small popup that sends the prompt in the box at a chosen time, once or on repeat, and lists what is already scheduled. */
export function SchedulePrompt({ s, text, onScheduled }: { s: S; text: string; onScheduled(): void }) {
  const [open, setOpen] = React.useState(false);
  const [when, setWhen] = React.useState('');
  const [repeat, setRepeat] = React.useState<Repeat>('none');
  const [prompt, setPrompt] = React.useState('');
  const box = React.useRef<HTMLDivElement>(null);
  const list = s.scheduled || [];
  const toggle = () => {
    if (!open) { setPrompt(text); setWhen(toLocal(Math.ceil((Date.now() + 3600_000) / 900_000) * 900_000)); }
    setOpen(!open);
  };
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key, true); };
  }, [open]);
  const at = parseLocal(when) ?? NaN;
  const problem = validateScheduled(prompt, at, Date.now());
  const save = async () => {
    try { await api.schedulePrompt(s.id, { text: prompt, at, repeat }); toast({ tone: 'neutral', title: 'Prompt scheduled' }); if (prompt.trim() === text.trim()) onScheduled(); setOpen(false); }
    catch (e) { toast({ tone: 'error', title: 'Could not schedule', description: (e as Error).message }); }
  };
  const field = { display: 'flex', flexDirection: 'column', gap: 4, font: '500 12px/1.5 var(--font-sans)' } as const;
  return (
    <div ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <IconButton icon="clock" label={list.length ? `Schedule a prompt (${list.length} scheduled)` : 'Schedule a prompt'} size="sm" onClick={toggle} />
      {open ? (
        <div role="dialog" aria-label="Schedule a prompt" style={{ position: 'absolute', left: 0, bottom: 'calc(100% + 8px)', width: 320, zIndex: 30, padding: 12, display: 'flex', flexDirection: 'column', gap: 10, borderRadius: 'var(--radius-lg)', background: 'var(--bg-raised)', boxShadow: 'var(--shadow-popover, 0 8px 24px rgba(0,0,0,.4)), inset 0 0 0 1px var(--border-strong)' }}>
          <label style={field}>Prompt
            <textarea autoFocus value={prompt} rows={3} onChange={(e) => setPrompt(e.target.value)} placeholder="What should the agent be told?"
              style={{ resize: 'none', boxSizing: 'border-box', width: '100%', border: 'none', borderRadius: 'var(--radius-md)', background: 'var(--bg-input)', color: 'var(--text-1)', font: '400 12.5px/1.5 var(--font-sans)', padding: '6px 8px', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{ ...field, flex: 1, minWidth: 0 }}>Send at
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', font: '400 12px/1.5 var(--font-sans)', color: 'var(--text-1)', background: 'var(--bg-input)', border: 'none', borderRadius: 'var(--radius-md)', padding: '5px 6px', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }} />
            </label>
            <label style={field}>Repeat
              <Select size="sm" value={repeat} onChange={(e: any) => setRepeat(e.target.value as Repeat)} options={REPEATS} />
            </label>
          </div>
          {list.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <span style={{ font: '500 11.5px/1.5 var(--font-sans)', color: 'var(--text-3)' }}>Scheduled</span>
              {list.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '400 12px/1.4 var(--font-sans)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.text}</div>
                    <div style={{ font: '400 11px/1.4 var(--font-mono)', color: 'var(--text-3)' }}>{describeScheduled(p)}</div>
                  </div>
                  <IconButton icon="x" label="Cancel this scheduled prompt" size="sm" onClick={() => void api.cancelScheduledPrompt(s.id, p.id)} />
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ flex: 1, font: '400 11.5px/1.4 var(--font-sans)', color: 'var(--text-3)' }}>{prompt.trim() || at ? problem ?? '' : ''}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            <Button size="sm" variant="primary" icon="clock" disabled={!!problem} onClick={() => void save()}>Schedule</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
