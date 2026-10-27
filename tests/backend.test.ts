import { describe, expect, it } from 'vitest';
import { BackendRegistry, type AgentBackend } from '../src/core/backend';
import { claudeEvents } from '../src/core/claudeBackend';

const fake = (id: string, models: string[]): AgentBackend => ({
  id, label: id.toUpperCase(), shortName: id, identity: { name: id, email: 'x@y' }, models: models.map((m) => ({ id: m, label: m, price: [1, 2] as [number, number] })),
  capabilities: { subagents: false, planMode: false, effort: false, fork: false, cost: false, planUsage: false },
  version: async () => '1.0', start: () => { throw new Error('unused'); }, review: async () => ({ text: '', cost: 0, failure: '' })
});

describe('BackendRegistry', () => {
  const r = new BackendRegistry([fake('claude', ['sonnet', 'opus']), fake('other', ['x'])]);
  it('falls back to the first backend for an empty or unknown name', () => {
    expect(r.get().id).toBe('claude');
    expect(r.get('gone').id).toBe('claude');
    expect(r.get('other').id).toBe('other');
  });
  it('falls back to the first model when a session names one the backend lacks', () => {
    expect(r.model('claude', 'opus').id).toBe('opus');
    expect(r.model('other', 'opus').id).toBe('x');
  });
  it('describes every backend for the interface', async () => {
    const info = await r.info();
    expect(info.map((b) => [b.id, b.version, b.canSignIn])).toEqual([['claude', '1.0', false], ['other', '1.0', false]]);
  });
});

describe('claudeEvents', () => {
  it('turns an assistant message into text, tool calls and usage', () => {
    const [e] = claudeEvents({ type: 'assistant', parent_tool_use_id: null, message: { usage: { input_tokens: 5, output_tokens: 7, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }, content: [{ type: 'text', text: ' hi ' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }, { type: 'thinking' }] } });
    expect(e).toEqual({ t: 'assistant', parentId: null, usage: { input: 5, output: 7, cacheWrite: 2, cacheRead: 3 }, blocks: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] });
  });
  it('reads tool results, subagent tasks, plan windows and results', () => {
    expect(claudeEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ text: 'a' }, { text: 'b' }], is_error: true }] } }))
      .toEqual([{ t: 'tool_results', results: [{ id: 't1', text: 'a\nb', isError: true }] }]);
    expect(claudeEvents({ type: 'system', subtype: 'task_notification', tool_use_id: 'x', status: 'stopped', summary: 's' })).toEqual([{ t: 'subagent_done', id: 'x', status: 'stopped', summary: 's' }]);
    expect(claudeEvents({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: 9 } } } }))
      .toEqual([{ t: 'plan_usage', fiveHour: { util: 0.4, resetsAt: 9 }, weekly: undefined }]);
    expect(claudeEvents({ type: 'result', is_error: true, subtype: 'error_max_turns', total_cost_usd: 1.5 })).toEqual([{ t: 'result', isError: true, text: 'error_max_turns', costUsd: 1.5 }]);
  });
  it('ignores messages it has no use for', () => {
    expect(claudeEvents({ type: 'stream_event' })).toEqual([]);
  });
});

import { contextWindow, windowLabel } from '../src/shared/reports';

describe('context window', () => {
  it('uses the size the agent reported, then the model name, then how much is already used', () => {
    expect(contextWindow({ ctx: 50_000, ctxMax: 272_000 })).toBe(272_000);
    expect(contextWindow({ ctx: 50_000, modelName: 'claude-sonnet-5-5[1m]' })).toBe(1_000_000);
    expect(contextWindow({ ctx: 250_000 })).toBe(1_000_000);
    expect(contextWindow({ ctx: 50_000 })).toBe(200_000);
  });
  it('words a size for display', () => {
    expect([200_000, 272_000, 1_000_000, 1_500_000].map(windowLabel)).toEqual(['200k', '272k', '1M', '1.5M']);
  });
});
