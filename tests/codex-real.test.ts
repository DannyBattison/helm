import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../src/core/backend';
import { CodexBackend } from '../src/core/codexBackend';

// Runs against a real Codex install. Skipped unless HELM_CODEX_BIN names the executable:
//   HELM_CODEX_BIN=$(which codex) npx vitest run tests/codex-real.test.ts
// With HELM_CODEX_TURN=1 and Codex signed in (codex login), it also runs one short turn.
const bin = process.env.HELM_CODEX_BIN;
const real = bin ? describe : describe.skip;

real('Codex (real install)', () => {
  const b = new CodexBackend({ cli: () => bin });
  afterAll(() => b.stop());

  it('finds its version and its models', async () => {
    expect(await b.version()).toMatch(/\d+\.\d+/);
    await b.refresh();
    expect(b.models.length).toBeGreaterThan(0);
    expect(b.models.every((m) => m.id && m.label)).toBe(true);
  }, 30000);

  it('reports who is signed in, and offers a device code to sign in', async () => {
    const s = await b.auth.status();
    expect(typeof s.loggedIn).toBe('boolean');
    if (s.loggedIn) return;
    const l = await b.auth.startLogin();
    expect(l.url).toMatch(/^https:\/\//);
    expect(l.code).toMatch(/\w+-\w+/);
    expect(l.needsCode).toBe(false);
    b.auth.cancel();
  }, 30000);

  const turn = process.env.HELM_CODEX_TURN ? it : it.skip;
  turn('runs a turn', async () => {
    expect((await b.auth.status()).loggedIn).toBe(true);
    await b.refresh();
    const h = b.start({
      cwd: process.cwd(), model: b.models[0].id, permMode: 'plan', systemAppend: '',
      canUseTool: async () => ({ behavior: 'deny', message: 'no' }), admitSubagent: async () => undefined
    });
    const events: AgentEvent[] = [];
    const run = (async () => { for await (const e of h.events) { events.push(e); if (e.t === 'result') break; } })();
    h.send('Reply with the single word ok. Do not use any tools.');
    await run;
    h.close();
    const end = events.find((e) => e.t === 'result') as Extract<AgentEvent, { t: 'result' }>;
    expect(end.isError).toBe(false);
    expect(events.some((e) => e.t === 'assistant' && e.blocks.some((x) => x.type === 'text'))).toBe(true);
  }, 120000);
});
