import { contextBridge, ipcRenderer } from 'electron';
import type { HelmBridge, HelmEvents } from '../shared/types';

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
