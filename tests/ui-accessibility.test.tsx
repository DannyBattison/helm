// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Checkbox } from '../src/renderer/src/ui/Checkbox';
import { Switch } from '../src/renderer/src/ui/Switch';
import { Tabs } from '../src/renderer/src/ui/Tabs';
import { TreeItem } from '../src/renderer/src/ui/TreeItem';
import { keyboardClick } from '../src/renderer/src/ui/keyboard';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('uses native, named controls and changes a checkbox once inside a clickable row', () => {
  const changed = vi.fn(), row = vi.fn();
  act(() => root.render(<div onClick={row}><Checkbox label="Include file" checked={false} onChange={changed} /><Switch label="Notifications" checked={false} onChange={changed} /></div>));
  const controls = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(controls[0].getAttribute('aria-label')).toBe('Include file');
  expect(controls[1].getAttribute('role')).toBe('switch');
  act(() => controls[0].click());
  expect(changed).toHaveBeenCalledExactlyOnceWith(true);
  expect(row).not.toHaveBeenCalled();
});
it('supports arrow navigation between tabs', () => {
  const changed = vi.fn();
  act(() => root.render(<Tabs value="a" onChange={changed} tabs={[{ value: 'a', label: 'Conversation' }, { value: 'b', label: 'Review' }]} />));
  const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
  expect(tabs[0].tabIndex).toBe(0); expect(tabs[1].tabIndex).toBe(-1);
  act(() => tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(changed).toHaveBeenCalledWith('b'); expect(document.activeElement).toBe(tabs[1]);
});
it('activates rows by keyboard without swallowing nested button events', () => {
  const row = vi.fn(), nested = vi.fn();
  act(() => root.render(<div {...keyboardClick} onClick={row}><button onClick={(e) => { e.stopPropagation(); nested(); }}>Approve</button></div>));
  const container = host.firstElementChild!;
  act(() => container.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(row).toHaveBeenCalledTimes(1);
  act(() => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(row).toHaveBeenCalledTimes(1);
});
it('supports keyboard activation and expansion in navigation rows', () => {
  const click = vi.fn(), toggle = vi.fn();
  act(() => root.render(<TreeItem label="Repository" expandable expanded={false} onClick={click} onToggle={toggle} />));
  const row = host.firstElementChild!;
  act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
  act(() => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  expect(click).toHaveBeenCalledOnce(); expect(toggle).toHaveBeenCalledOnce();
});
