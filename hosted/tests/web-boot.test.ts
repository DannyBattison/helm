// @vitest-environment jsdom
/// <reference lib="dom" />
import { beforeEach, describe, expect, it, vi } from 'vitest';

const order: string[] = [];
const bridge = { ready: Promise.resolve().then(() => { order.push('ready'); }) } as any;
vi.mock('../web/bridge', () => ({ createBridge: vi.fn((url: string) => { order.push('bridge ' + url); return bridge; }) }));
vi.mock('../web/layout', () => ({ phoneLayout: vi.fn(() => { order.push('layout'); }) }));
vi.mock('../web/notifications', () => ({ setupNotifications: vi.fn(() => { order.push('notifications'); }) }));
vi.mock('../../src/renderer/src/main', () => { order.push('renderer'); return {}; });

import { boot } from '../web/boot';
import { createBridge } from '../web/bridge';
import { phoneLayout } from '../web/layout';
import { setupNotifications } from '../web/notifications';

beforeEach(() => { order.length = 0; vi.clearAllMocks(); delete (window as any).helmBridge; });

describe('boot', () => {
  it('connects to /ws on this origin, publishes the bridge, and starts the UI only once it is ready', async () => {
    await boot({});
    expect(createBridge).toHaveBeenCalledWith(location.origin.replace(/^http/, 'ws') + '/ws');
    expect((window as any).helmBridge).toBe(bridge);
    expect(document.body.style.background).toBe('rgb(14, 14, 18)');
    expect(phoneLayout).not.toHaveBeenCalled();
    expect(setupNotifications).toHaveBeenCalledWith(bridge, { push: undefined });
    expect(order.indexOf('ready')).toBeLessThan(order.indexOf('notifications'));
  });

  it('applies the phone layout before connecting, and passes push on', async () => {
    await boot({ layout: 'phone', push: true });
    expect(phoneLayout).toHaveBeenCalledTimes(1);
    expect(order.findIndex((o) => o === 'layout')).toBeLessThan(order.findIndex((o) => o.startsWith('bridge')));
    expect(setupNotifications).toHaveBeenCalledWith(bridge, { push: true });
  });
});
