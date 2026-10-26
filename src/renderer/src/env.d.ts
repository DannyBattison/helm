import type { HelmBridge } from '../../shared/types';

declare global {
  interface Window {
    helmBridge: HelmBridge;
  }
}
export {};
