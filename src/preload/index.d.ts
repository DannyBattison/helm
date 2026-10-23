import type { HelmEvents } from '../shared/types';

declare global {
  interface Window {
    helmBridge: {
      platform: string;
      invoke(channel: string, ...args: unknown[]): Promise<any>;
      on<K extends keyof HelmEvents>(channel: K, cb: (payload: HelmEvents[K]) => void): () => void;
    };
  }
}
export {};
