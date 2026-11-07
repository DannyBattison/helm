import { describe, expect, it } from 'vitest';
import { parseHelmCommand, slashAt, slashMatches } from '../src/shared/slashCommands';

describe('slash commands', () => {
  it('finds the slash word only at the start of the message', () => {
    expect(slashAt('/sch', 4)).toBe('sch');
    expect(slashAt('/', 1)).toBe('');
    expect(slashAt('look at /tmp', 12)).toBeNull();
    expect(slashAt('/a b', 4)).toBeNull();
  });
  it('lists helm commands first and agent commands only for agents that have them', () => {
    const claude = slashMatches('', 'claude', undefined, false).map((c) => c.name);
    expect(claude).toContain('compact');
    expect(claude.indexOf('schedule')).toBeLessThan(claude.indexOf('compact'));
    expect(slashMatches('', 'codex', undefined, false).map((c) => c.name)).not.toContain('compact');
    expect(slashMatches('co', 'claude', undefined, false).map((c) => c.name)).toEqual(['compact']);
  });
  it('hides commands the agent or session cannot use', () => {
    expect(slashMatches('plan', 'qwen', { planMode: false }, false)).toEqual([]);
    expect(slashMatches('agent', 'claude', undefined, true)).toEqual([]);
    expect(slashMatches('compact', 'claude', undefined, true)).toEqual([]);
  });
  it('parses helm commands and leaves agent commands alone', () => {
    expect(parseHelmCommand('/notify off')?.arg).toBe('off');
    expect(parseHelmCommand('/schedule')?.cmd.name).toBe('schedule');
    expect(parseHelmCommand('/compact')).toBeNull();
    expect(parseHelmCommand('/unknown')).toBeNull();
    expect(parseHelmCommand('hello /notify')).toBeNull();
  });
});
