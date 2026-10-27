import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/core/backend';
import { ClaudeBackend } from '../src/core/claudeBackend';

// Runs one short turn against a real, signed-in Claude Code. Skipped unless HELM_CLAUDE_REAL is set:
//   HELM_CLAUDE_REAL=1 npx vitest run tests/claude-real.test.ts
const real = process.env.HELM_CLAUDE_REAL ? describe : describe.skip;

real('Claude (real install)', () => {
  const b = new ClaudeBackend({ sdk: () => process.env.HELM_CLAUDE_BIN || undefined, cli: () => process.env.HELM_CLAUDE_BIN || undefined });

  it('is signed in and reports a version', async () => {
    expect(await b.version()).toMatch(/\d/);
    expect((await b.auth.status()).loggedIn).toBe(true);
  }, 30000);

  it('runs a turn and reports its text, its usage and its end', async () => {
    const h = b.start({
      cwd: mkdtempSync(join(tmpdir(), 'helm-claude-')), model: 'haiku', permMode: 'plan', systemAppend: '',
      canUseTool: async (_t, input) => ({ behavior: 'allow', updatedInput: input }), admitSubagent: async () => undefined
    });
    const events: AgentEvent[] = [];
    const run = (async () => { for await (const e of h.events) { events.push(e); if (e.t === 'result') break; } })();
    h.send('Reply with the single word ok. Do not use any tools.');
    await run;
    h.close();
    expect(events[0].t).toBe('init');
    expect(events.some((e) => e.t === 'assistant' && e.blocks.some((x) => x.type === 'text'))).toBe(true);
    expect(events.some((e) => e.t === 'assistant' && !!e.usage)).toBe(true);
    const end = events.find((e) => e.t === 'result') as Extract<AgentEvent, { t: 'result' }>;
    expect(end.isError).toBe(false);
  }, 120000);
});
