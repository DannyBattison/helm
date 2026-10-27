import { describe, expect, it } from 'vitest';
import { BackendRegistry } from '../src/core/backend';
import { defaultAgent, normalizeEnabled } from '../src/shared/agents';

const known = ['claude', 'codex'];

describe('turning agents on and off', () => {
  it('keeps a valid choice, in the order of the agents', () => {
    expect(normalizeEnabled(['codex'], known, ['claude', 'codex'])).toEqual(['codex']);
    expect(normalizeEnabled(['codex', 'claude'], known, [])).toEqual(['claude', 'codex']);
  });
  it('never leaves none on: it keeps what was on before, or the first agent', () => {
    expect(normalizeEnabled([], known, ['codex'])).toEqual(['codex']);
    expect(normalizeEnabled([], known, [])).toEqual(['claude']);
    expect(normalizeEnabled(undefined, known, undefined)).toEqual(['claude']);
  });
  it('ignores agents that do not exist and repeats', () => {
    expect(normalizeEnabled(['gemini', 'codex', 'codex'], known, ['claude'])).toEqual(['codex']);
    expect(normalizeEnabled(['gemini'], known, ['claude'])).toEqual(['claude']);
  });
  it('defaults to an agent that is on', () => {
    expect(defaultAgent('claude', ['claude', 'codex'], known)).toBe('claude');
    expect(defaultAgent('claude', ['codex'], known)).toBe('codex');
    expect(defaultAgent('gone', [], known)).toBe('claude');
  });
});

const fake = (id: string) => ({
  id, label: id, shortName: id, identity: { name: id, email: 'x@y' }, models: [], bundled: true,
  capabilities: { subagents: false, planMode: false, effort: false, fork: false, cost: false, planUsage: false },
  version: async () => '1', start: () => { throw new Error('unused'); }, review: async () => ({ text: '', cost: 0, failure: '' })
}) as any;

describe('what the interface is told about an agent that is off', () => {
  const reg = new BackendRegistry([fake('claude'), fake('codex')]);
  it('separates being set up from being turned on', async () => {
    const [claude, codex] = await reg.info({}, ['claude']);
    expect([claude.configured, claude.enabled, claude.ready]).toEqual([true, true, true]);
    expect([codex.configured, codex.enabled, codex.ready]).toEqual([true, false, false]);
  });
  it('treats every agent as on when no list is given', async () => {
    expect((await reg.info()).map((b) => b.ready)).toEqual([true, true]);
  });
});
