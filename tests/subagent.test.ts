import { describe, expect, it } from 'vitest';
import messages from './fixtures/subagent-messages.json';
import { SessionManager } from '../src/main/sessions';

// Real messages from Claude Code's getSubagentMessages for a subagent that read README.md.
describe('subagent transcript conversion', () => {
  const sm: any = new SessionManager({} as any, {} as any);

  it('turns tool calls and replies into transcript events', () => {
    const ev = sm.convertMessages(messages, 'C:/Users/GGUK/.helm/worktrees/storefront/use-the-agent-tool-2');
    expect(ev.map((e: any) => e.k)).toEqual(['tools', 'agent']);
    expect(ev[0].items[0][0]).toBe('Read');
    expect(ev[0].items[0][1]).toBe('README.md');
    expect(ev[0].items[0][2]).toBe('1 lines');
    expect(ev[1].text).toContain('# storefront');
  });
});
