import { describe, expect, it } from 'vitest';
import { billingOf, livePlan, planBackends } from '../src/renderer/src/lib';

const future = Math.floor(Date.now() / 1000) + 3600;
const caps = { subagents: true, planMode: true, effort: true, fork: true, cost: true, planUsage: true };
const be = (id: string, over: any = {}) => ({ id, label: id, shortName: id, models: [], capabilities: caps, version: '1', installed: true, canSignIn: true, ready: true, login: { loggedIn: true, method: 'x', billing: 'subscription' }, ...over });
const app = (backends: any[], extra: any = {}): any => ({
  settings: { defaultBackend: 'claude', billing: 'subscription' },
  backends, plan: { at: 1, fiveHour: { util: 0.4, resetsAt: future } },
  plans: { claude: { at: 1, fiveHour: { util: 0.4, resetsAt: future }, weekly: { util: 0.2, resetsAt: future } }, codex: { at: 1, fiveHour: { util: 0.1, resetsAt: future }, weekly: { util: 0.05, resetsAt: future } } },
  ...extra
});

describe('plan limits for several agents', () => {
  it('lists both agents when both are signed in on a plan, each with its own windows', () => {
    const a = app([be('claude'), be('codex')]);
    expect(planBackends(a).map((b) => b.id)).toEqual(['claude', 'codex']);
    expect(livePlan(a, 'claude').weekly?.util).toBe(0.2);
    expect(livePlan(a, 'codex').weekly?.util).toBe(0.05);
    expect(livePlan(a, 'codex').fiveHour?.util).toBe(0.1);
  });
  it('leaves out an agent that is not signed in, not installed, or paid per token', () => {
    expect(planBackends(app([be('claude'), be('codex', { ready: false })])).map((b) => b.id)).toEqual(['claude']);
    expect(planBackends(app([be('claude'), be('codex', { login: { loggedIn: true, method: 'api key', billing: 'api' } })])).map((b) => b.id)).toEqual(['claude']);
    expect(planBackends(app([be('claude'), be('codex')], { settings: { defaultBackend: 'claude', billing: 'api' } })).map((b) => b.id)).toEqual(['codex']);
  });
  it('reads Claude\'s billing from the setting and any other agent\'s from its account', () => {
    const a = app([be('claude'), be('codex', { login: { loggedIn: true, method: 'api key', billing: 'api' } })]);
    expect(billingOf(a, 'claude')).toBe('subscription');
    expect(billingOf(a, 'codex')).toBe('api');
  });
  it('shows a window that has reset as unknown', () => {
    const a = app([be('claude'), be('codex')], { plans: { codex: { at: 1, weekly: { util: 0.9, resetsAt: 5 } } } });
    expect(livePlan(a, 'codex').weekly).toBeUndefined();
  });
});
