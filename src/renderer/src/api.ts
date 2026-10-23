import type { HelmApi, HelmEvents } from '@shared/types';

/** Typed proxy: `api.createSession(x)` invokes the main-process handler of the same name. */
export const api = new Proxy({} as HelmApi, {
  get: (_t, name: string) => (...args: unknown[]) => window.helmBridge.invoke(name, ...args)
});

export const on = <K extends keyof HelmEvents>(channel: K, cb: (p: HelmEvents[K]) => void) => window.helmBridge.on(channel, cb);
export const platform = () => window.helmBridge.platform;
