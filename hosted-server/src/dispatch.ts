import { CLIENT_SIDE } from './protocol';

/** Runs an API call by name. Only the functions `core.ts` exposes, and not the ones that belong to the user's computer. */
export async function dispatch(api: Record<string, unknown>, name: unknown, args: unknown): Promise<unknown> {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(api, name) || typeof api[name] !== 'function') throw new Error(`Unknown call: ${String(name).slice(0, 60)}`);
  if ((CLIENT_SIDE as readonly string[]).includes(name)) throw new Error(`${name} is done by the browser, not the server`);
  if (!Array.isArray(args)) throw new Error('Arguments must be a list');
  return (api[name] as (...a: unknown[]) => unknown)(...args);
}
