import { contextBridge, ipcRenderer } from 'electron';
import type { HelmBridge, HelmEvents } from '../../src/shared/types';

// HELM_RESET_ROUTE=1 forgets the page helm would reopen. For a page that freezes the window, so it can be started at all.
if (process.env.HELM_RESET_ROUTE) { try { localStorage.removeItem('helm-route'); } catch { /* storage unavailable */ } }

const bridge: HelmBridge = {
  platform: process.platform,
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on<K extends keyof HelmEvents>(channel: K, cb: (payload: HelmEvents[K]) => void) {
    const handler = (_e: unknown, payload: HelmEvents[K]) => cb(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
};

contextBridge.exposeInMainWorld('helmBridge', bridge);
