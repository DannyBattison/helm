// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const log = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../src/renderer/src/api', () => ({ api: { logRenderer: log, saveDiagnostics: vi.fn().mockResolvedValue('diagnostics.zip') } }));
import { ErrorBoundary } from '../src/renderer/src/ui/ErrorBoundary';

it('isolates a failed view, logs diagnostics and retries without losing navigation', () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  let broken = true;
  function View() { if (broken) throw new Error('malformed imported record'); return <p>Recovered view</p>; }
  try {
    act(() => root.render(<><nav>Navigation</nav><ErrorBoundary><View /></ErrorBoundary></>));
    expect(host.querySelector('nav')?.textContent).toBe('Navigation');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Something in this view broke');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('malformed imported record'));
    broken = false;
    act(() => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(host.textContent).toContain('Recovered view');
  } finally { act(() => root.unmount()); host.remove(); spy.mockRestore(); }
});
