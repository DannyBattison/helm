// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { el, hide, hideTabs, show, showTabs, STYLE } from '../src/ui';

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; document.documentElement.removeAttribute('style'); });

describe('el', () => {
  it('makes an element with text, class and click handler', () => {
    const on = vi.fn();
    const b = el('button', 'Hi', 'primary', on);
    expect(b.textContent).toBe('Hi');
    expect(b.className).toBe('primary');
    b.click();
    expect(on).toHaveBeenCalledOnce();
  });
  it('leaves out the class and handler when not given', () => {
    const d = el('div');
    expect(d.className).toBe('');
    expect(d.onclick).toBeNull();
  });
});

describe('show / hide', () => {
  it('shows strings as paragraphs and elements as given, in one screen', () => {
    const btn = el('button', 'Go');
    show('hello', btn);
    const screen = document.getElementById('helm-screen')!;
    expect(screen.className).toBe('h');
    expect(screen.querySelector('main > p')!.textContent).toBe('hello');
    expect(screen.querySelector('main > button')).toBe(btn);
  });
  it('replaces the previous screen and adds the style once', () => {
    show('one');
    show('two');
    expect(document.querySelectorAll('#helm-screen')).toHaveLength(1);
    expect(document.getElementById('helm-screen')!.textContent).toBe('two');
    expect(document.querySelectorAll('#helm-style')).toHaveLength(1);
    expect(document.getElementById('helm-style')!.textContent).toBe(STYLE);
  });
  it('hide removes the screen, and is fine with none', () => {
    show('x');
    hide();
    expect(document.getElementById('helm-screen')).toBeNull();
    expect(() => hide()).not.toThrow();
  });
});

describe('tab bar', () => {
  it('lights the active tab, reserves room, and calls back with the tapped tab', () => {
    const on = vi.fn();
    showTabs('servers', on);
    const [servers, settings] = Array.from(document.querySelectorAll<HTMLButtonElement>('#helm-tabs button'));
    expect(servers.className).toBe('on');
    expect(settings.className).toBe('');
    expect(servers.getAttribute('aria-label')).toBe('Servers');
    expect(settings.textContent).toBe('Settings');
    expect(document.documentElement.style.getPropertyValue('--tabs')).toContain('56px');
    settings.click();
    expect(on).toHaveBeenCalledWith('settings');
    servers.click();
    expect(on).toHaveBeenLastCalledWith('servers');
  });
  it('re-lighting reuses the one bar', () => {
    showTabs('servers', () => undefined);
    showTabs('settings', () => undefined);
    expect(document.querySelectorAll('#helm-tabs')).toHaveLength(1);
    const [servers, settings] = Array.from(document.querySelectorAll('#helm-tabs button'));
    expect(servers.className).toBe('');
    expect(settings.className).toBe('on');
  });
  it('hideTabs removes the bar and the variable', () => {
    showTabs('servers', () => undefined);
    hideTabs();
    expect(document.getElementById('helm-tabs')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--tabs')).toBe('');
  });
});
