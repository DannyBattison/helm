import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFor, mentionsIn, panelDigest, participants, replyLimit } from '../src/shared/panel';
import { readOnlyDecision } from '../src/core/advisor';
import { BackendRegistry, type AgentBackend, type AgentEvent, type AgentStartOptions } from '../src/core/backend';
import { SessionManager } from '../src/core/sessions';
import { Store } from '../src/core/store';
import { FREE_ID, type Panel, type TranscriptEvent } from '../src/shared/types';

const panel: Panel = { owner: 'alpha', members: [{ name: 'beta', model: 'm' }, { name: 'beta-2', model: 'm' }], seen: {} };

describe('panel helpers', () => {
  it('names agents by handle, numbering repeats', () => {
    expect(handleFor('Claude', [])).toBe('claude');
    expect(handleFor('Claude', ['claude'])).toBe('claude-2');
    expect(handleFor('Claude', ['claude', 'claude-2'])).toBe('claude-3');
    expect(participants(panel)).toEqual(['alpha', 'beta', 'beta-2']);
  });
  it('finds @mentions of participants only, in order, never of oneself', () => {
    const names = participants(panel);
    expect(mentionsIn('@beta-2, what do you think? cc @alpha and @nobody', names)).toEqual(['beta-2', 'alpha']);
    expect(mentionsIn('@beta-2 and @beta', names)).toEqual(['beta-2', 'beta']);
    expect(mentionsIn('mail me@beta.com or src/@beta/x.ts', names)).toEqual([]);
    expect(mentionsIn('@all please', names, 'beta')).toEqual(['alpha', 'beta-2']);
  });
  it('reads the cap, -1 meaning none', () => {
    expect(replyLimit(-1)).toBeNull();
    expect(replyLimit(undefined)).toBeNull();
    expect(replyLimit(0)).toBe(1);
    expect(replyLimit(4)).toBe(4);
  });
  it('shows an agent what it has missed, not its own words', () => {
    const t: TranscriptEvent[] = [
      { k: 'user', t: 1, text: 'review this', to: ['beta'] },
      { k: 'agent', text: 'my take', from: 'alpha', re: { index: 0, who: 'you', snippet: 'x' } },
      { k: 'agent', text: 'beta own', from: 'beta' },
      { k: 'tools', items: [] }
    ];
    const d = panelDigest(t, 0, 'beta', panel);
    expect(d).toContain('[you → @beta]: review this');
    expect(d).toContain('[@alpha → @you]: my take');
    expect(d).not.toContain('beta own');
    expect(d).toContain('You are @beta, read-only');
    expect(panelDigest(t, 4, 'beta', panel)).not.toContain('review this');
  });
});

describe('read-only decisions', () => {
  it('refuses edits and commands that change things, allows looking', () => {
    expect(readOnlyDecision('Edit', { file_path: 'a' }).behavior).toBe('deny');
    expect(readOnlyDecision('Write', {}).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'rm -rf x' }).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'cat a.txt > b.txt' }).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'git branch newone' }).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'git branch -a' }).behavior).toBe('allow');
    expect(readOnlyDecision('Bash', { command: 'git log --oneline' }).behavior).toBe('allow');
    expect(readOnlyDecision('AskUserQuestion', {}).behavior).toBe('deny');
    expect(readOnlyDecision('Read', { file_path: 'a' }).behavior).toBe('allow');
  });
});

// ---- a session with scripted agents
interface Seat { opts: AgentStartOptions; got: string[] }
const seats: Record<string, Seat[]> = {};
let script: Record<string, (text: string, n: number) => string> = {};

function fakeBackend(id: string, shortName: string): AgentBackend {
  return {
    id, label: shortName, shortName, identity: { name: id, email: 'x@y' }, models: [{ id: 'm', label: 'm', price: [0, 0] }],
    capabilities: { subagents: false, planMode: true, effort: false, fork: false, cost: false, planUsage: false },
    version: async () => '1', review: async () => ({ text: '', cost: 0, failure: '' }),
    start(opts) {
      const seat: Seat = { opts, got: [] };
      (seats[id] ||= []).push(seat);
      const q: AgentEvent[] = [];
      let wake: (() => void) | undefined;
      let closed = false;
      let n = 0;
      const push = (e: AgentEvent) => { q.push(e); wake?.(); };
      push({ t: 'init', sessionId: id + '-conv', model: 'm' });
      return {
        get closed() { return closed; },
        events: (async function* () { while (!closed) { if (q.length) yield q.shift()!; else await new Promise<void>((r) => (wake = r)); } })(),
        send(text) {
          seat.got.push(text);
          const reply = script[id](text, n++);
          setTimeout(() => { push({ t: 'assistant', parentId: null, blocks: [{ type: 'text', text: reply }] }); push({ t: 'result', isError: false, text: reply }); }, 1);
        },
        interrupt: async () => undefined, setModel: async () => undefined, setEffort: async () => undefined, setPermMode: async () => undefined,
        close() { closed = true; wake?.(); }
      };
    }
  };
}

let root: string, store: Store, sm: SessionManager, n = 0;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'helm-panel-'));
  for (const k of Object.keys(seats)) delete seats[k];
  store = new Store();
  await store.load(join(root, 'data' + ++n));
  store.data.settings.freeRoot = join(root, 'free');
  store.data.settings.enabledAgents = ['a', 'b'];
  store.data.settings.defaultBackend = 'a';
  const hooks: any = { emitState: vi.fn(), emitTranscript: vi.fn(), toast: vi.fn(), notify: vi.fn(), claudePath: () => undefined };
  sm = new SessionManager(store, hooks, new BackendRegistry([fakeBackend('a', 'Alpha'), fakeBackend('b', 'Beta')]));
});
afterEach(async () => { await sm.stopAll(); sm.shutdown(); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

const start = (over: any = {}) => sm.create({ repoId: FREE_ID, base: '', task: 'Plan the work', backend: 'a', model: 'm', budget: 0, permMode: 'edits', panel: [{ backend: 'b', model: 'm' }], ...over });
const agentLines = async (id: string) => (await store.transcript(id)).filter((e): e is Extract<TranscriptEvent, { k: 'agent' }> => e.k === 'agent');

describe('a session with several agents', () => {
  it('has each agent answer in turn, and one that @mentions another brings it in to reply', async () => {
    script = { a: (_t, i) => (i === 0 ? 'Start with the schema. @beta, agree?' : 'Good.'), b: () => 'Yes, schema first.' };
    const id = await start();
    await sm.settled(id);
    const s = sm.get(id)!;
    expect(s.panel).toMatchObject({ owner: 'alpha', members: [{ name: 'beta', backend: 'b' }] });
    const lines = await agentLines(id);
    // alpha answers the task, beta answers everyone (the task) and then alpha's mention
    expect(lines.map((l) => [l.from, l.text])).toEqual([['alpha', 'Start with the schema. @beta, agree?'], ['beta', 'Yes, schema first.'], ['beta', 'Yes, schema first.'], ['alpha', 'Good.']]);
    expect(lines[1].re).toMatchObject({ who: 'you' });
    expect(lines[2].re).toMatchObject({ who: 'alpha', index: 1 });
    // The reader saw the other's words, and was told it is read-only.
    expect(seats.b[0].got[0]).toContain('[@alpha');
    expect(seats.b[0].opts.permMode).toBe('plan');
    expect(seats.b[0].opts.systemAppend).toMatch(/read-only/);
    expect(seats.a[0].opts.systemAppend).toMatch(/the owner/);
  });

  it('stops at the reply cap and says so', async () => {
    store.data.settings.panelReplyCap = 1;
    script = { a: () => 'Thoughts @beta?', b: () => 'ok' };
    const id = await start();
    await sm.settled(id);
    expect((await agentLines(id)).map((l) => l.from)).toEqual(['alpha']);
    expect((await store.transcript(id)).some((e) => e.k === 'note' && /Reply limit reached \(1/.test(e.text))).toBe(true);
  });

  it('with -1 lets them go on until nobody mentions anyone', async () => {
    store.data.settings.panelReplyCap = -1;
    script = { a: (_t, i) => (i < 3 ? 'ping @beta' : 'done'), b: (_t, i) => (i < 3 ? 'pong @alpha' : 'done') };
    const id = await start();
    await sm.settled(id);
    expect((await agentLines(id)).length).toBeGreaterThan(6);
  });

  it('sends a message only to whom it is addressed, as a thread', async () => {
    script = { a: () => 'a says', b: () => 'b says' };
    const id = await start();
    await sm.settled(id);
    const before = (await agentLines(id)).length;
    const idx = (await store.transcript(id)).findIndex((e) => e.k === 'agent' && e.from === 'alpha');
    await sm.send(id, 'why?', [], { to: ['beta'], re: { index: idx, who: 'alpha', snippet: 'a says' } });
    await sm.settled(id);
    const lines = await agentLines(id);
    expect(lines).toHaveLength(before + 1);
    expect(lines.at(-1)).toMatchObject({ from: 'beta', re: { who: 'you' } });
    const user: any = (await store.transcript(id)).filter((e) => e.k === 'user').at(-1);
    expect(user).toMatchObject({ text: 'why?', to: ['beta'], re: { who: 'alpha' } });
    sm.get(id)!.panel!.seen.alpha; // untouched
    await sm.send(id, '@alpha and @beta again');
    await sm.settled(id);
    expect(((await store.transcript(id)).filter((e) => e.k === 'user').at(-1) as any).to).toEqual(['alpha', 'beta']);
  });

  it('adds an agent mid-session, then hands the editing over', async () => {
    script = { a: () => 'a says', b: () => 'b says' };
    const id = await sm.create({ repoId: FREE_ID, base: '', task: 'Solo', backend: 'a', model: 'm', budget: 0, permMode: 'edits' });
    await vi.waitFor(() => expect(sm.get(id)!.status).not.toBe('working'));
    expect(sm.get(id)!.panel).toBeUndefined();
    await sm.addPanelAgent(id, { backend: 'b', model: 'm' });
    const s = sm.get(id)!;
    expect(s.panel).toMatchObject({ owner: 'alpha', members: [{ name: 'beta' }] });
    // earlier agent words are labelled with the owner
    expect((await agentLines(id))[0].from).toBe('alpha');
    await sm.send(id, '@beta any thoughts?');
    await sm.settled(id);
    expect(seats.b[0].got[0]).toContain('Solo');
    await sm.setPanelOwner(id, 'beta');
    expect(s.backend).toBe('b');
    expect(s.panel).toMatchObject({ owner: 'beta', members: [{ name: 'alpha', backend: 'a' }] });
    await sm.send(id, 'go');
    await sm.settled(id);
    expect(seats.b.at(-1)!.opts.permMode).toBe('edits');
    expect(seats.a.at(-1)!.opts.permMode).toBe('plan');
    await expect(sm.removePanelAgent(id, 'beta')).rejects.toThrow(/owner/);
    await sm.removePanelAgent(id, 'alpha');
    expect(s.panel).toBeUndefined();
  });
});
