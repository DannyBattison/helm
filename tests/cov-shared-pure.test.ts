import { describe, expect, it, vi } from 'vitest';
import { currencyForRegion, currencySymbol, fmtMoney, fromDisplay, rateFor, toDisplay } from '../src/shared/money';
import { diagnostics, scrub } from '../src/shared/diagnostics';
import { feedbackTask, issueTask, pullNumber } from '../src/shared/issues';
import { prBody, prSummary, prTitle, replaceSummary } from '../src/shared/prText';
import { Advisor, readOnlyDecision } from '../src/core/advisor';

describe('money', () => {
  it('converts with live rates, falling back to built-ins, then 1', () => {
    expect(rateFor('GBP', { GBP: 0.5 })).toBe(0.5);
    expect(rateFor('GBP', {})).toBe(0.75);
    expect(rateFor('XXX')).toBe(1);
    expect(toDisplay(10, 'GBP', { GBP: 0.5 })).toBe(5);
    expect(fromDisplay(5, 'GBP', { GBP: 0.5 })).toBe(10);
  });
  it('formats, dropping decimals for whole amounts only on request', () => {
    expect(fmtMoney(40, 'USD', undefined, { whole: true })).toBe('$40');
    expect(fmtMoney(40, 'USD')).toBe('$40.00');
    expect(fmtMoney(40.5, 'USD', undefined, { whole: true })).toBe('$40.50');
    expect(fmtMoney(1, 'JPY')).toMatch(/150$/);
  });
  it('survives an invalid currency code', () => {
    expect(fmtMoney(2, 'not-a-code')).toBe('not-a-code 2.00');
    expect(currencySymbol('not-a-code')).toBe('not-a-code');
    expect(currencySymbol('GBP')).toBe('£');
  });
  it('maps regions to currencies', () => {
    expect(currencyForRegion('gb')).toBe('GBP');
    expect(currencyForRegion('DE')).toBe('EUR');
    expect(currencyForRegion('ZZ')).toBeNull();
    expect(currencyForRegion()).toBeNull();
  });
});

describe('diagnostics', () => {
  const settings: any = { billing: 'api', defaultModel: 'sonnet', permMode: 'default', deliver: 'pr', mergeMethod: 'squash', afterMerge: 'archive', maxRunning: 0, maxSubagentsSession: 2, maxSubagentsRepo: 4, remoteControl: true, tray: false, autoUpdate: true, claudePath: '/x/claude', defaultBackend: 'claude' };
  const base = { now: 0, app: { version: '1', electron: '2', node: '3', chrome: '4', platform: 'linux', arch: 'x64', os: 'x', packaged: false }, agents: [{ label: 'Claude', version: null }], gitVersion: null, home: '/home/bob', settings, repos: [{ id: 'o/r', private: true, defaultBranch: 'main' }] as any };
  it('scrubs the home folder in all spellings and ignores short ones', () => {
    expect(scrub('/home/bob/x C:\\home\\bob', '/home/bob')).toContain('~/x');
    expect(scrub('\\home\\bob\\y', '/home/bob')).toBe('~\\y');
    expect(scrub('/a/b', '/a')).toBe('/a/b');
    expect(scrub('plain', '')).toBe('plain');
  });
  it('lists every session flag and an empty state', () => {
    const empty = diagnostics({ ...base, sessions: [], log: [] });
    expect(empty).toContain('by status: none');
    expect(empty).toContain('unlimited');
    expect(empty).toContain('not found');
    expect(empty).toContain('(development build)');
    const s: any = { id: 'a', repoId: 'o/r', status: 'idle', model: 'sonnet', effort: 'high', permMode: 'plan', commits: [1], files: 2, queued: true, archivedAt: 1, worktreeGone: true, stuck: true, error: '/home/bob/secret', lastAccess: 1 };
    const out = diagnostics({ ...base, sessions: [s, { ...s, id: 'b', lastAccess: 2, effort: undefined, queued: false }], log: ['at /home/bob/z'] });
    for (const w of ['sonnet/high', 'queued', 'archived', 'worktree gone', 'stuck', 'error: ~/secret', '(private)', 'at ~/z']) expect(out).toContain(w);
    expect(out.indexOf('- b ·')).toBeLessThan(out.indexOf('- a ·'));
  });
});

describe('issues', () => {
  const issue: any = { number: 3, title: 'T', body: 'a\r\n<!-- hidden -->b', url: 'u', labels: ['bug'], author: 'x', comments: 0, updated: '' };
  it('builds an issue task with labels and discussion', () => {
    const t = issueTask(issue, [{ author: 'y', body: ' hi ', at: '' }, { author: 'z', body: '  ', at: '' }]);
    expect(t).toContain('Labels: bug');
    expect(t).toContain('@y: hi');
    expect(t).not.toContain('hidden');
    expect(t).not.toContain('@z');
  });
  it('handles an empty body, no labels, no discussion and clips long text', () => {
    const t = issueTask({ ...issue, body: '', labels: [] }, []);
    expect(t).toContain('(no description)');
    expect(t).not.toContain('Labels');
    expect(t).not.toContain('Discussion');
    expect(issueTask({ ...issue, body: 'x'.repeat(7000) }, [])).toContain('…');
  });
  it('builds feedback with inline and general comments', () => {
    const t = feedbackTask({ number: 1, title: 'P', url: 'u' }, [{ author: 'a', body: 'fix', path: 'f.ts', line: 4, at: '' }, { author: 'b', body: 'nofile', path: 'g.ts', at: '' }, { author: 'c', body: 'gen', at: '' }]);
    expect(t).toContain('- f.ts:4 (@a): fix');
    expect(t).toContain('- g.ts (@b)');
    expect(t).toContain('- @c: gen');
    expect(feedbackTask({ number: 1, title: 'P', url: 'u' }, [])).not.toContain('General');
  });
  it('finds pull numbers', () => {
    expect(pullNumber('https://github.com/o/r/pull/42')).toBe(42);
    expect(pullNumber('nope')).toBeNull();
    expect(pullNumber()).toBeNull();
  });
});

describe('prText', () => {
  it('shortens titles at word boundaries', () => {
    expect(prTitle('\n\n  short  title ')).toBe('short title');
    expect(prTitle('word '.repeat(30), 20)).toBe('word word word…');
    expect(prTitle('x'.repeat(100), 20)).toBe('x'.repeat(19) + '…');
    expect(prTitle('')).toBe('');
  });
  it('summarises with and without stats, commits and issue', () => {
    const full = prSummary({ task: ' do it ', commits: [{ msg: 'one' }, { msg: 'two' }], issue: 5, files: 1, add: 2, del: 3 });
    expect(full).toContain('- two\n- one');
    expect(full).toContain('1 file changed, +2 −3');
    expect(full).toContain('Closes #5');
    expect(prSummary({ task: 't', commits: [], files: 2 })).toContain('2 files changed, +0 −0');
    expect(prSummary({ task: 't', commits: [] })).not.toContain('Changes');
    expect(prBody('S', 'id')).toBe('S\n\nCreated with helm · session id');
  });
  it('replaces only a helm block', () => {
    const old = prSummary({ task: 'old', commits: [] });
    expect(replaceSummary(`intro\n${old}\noutro`, 'NEW')).toBe('intro\nNEW\noutro');
    expect(replaceSummary('rewritten', 'NEW')).toBeNull();
  });
});

describe('advisor', () => {
  it('allows looking and refuses changes', () => {
    expect(readOnlyDecision('Edit', {}).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'git status' }).behavior).toBe('allow');
    expect(readOnlyDecision('Bash', { command: 'git branch -a' }).behavior).toBe('allow');
    expect(readOnlyDecision('Bash', { command: 'rm -rf x' }).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', { command: 'ls; rm x' }).behavior).toBe('deny');
    expect(readOnlyDecision('Bash', {}).behavior).toBe('deny');
    expect(readOnlyDecision('AskUserQuestion', {}).behavior).toBe('deny');
    expect(readOnlyDecision('Read', {}).behavior).toBe('allow');
  });

  function make(events: any[], opts: { throwAfter?: boolean; closed?: boolean } = {}) {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let started: any;
    const agent: any = {
      closed: !!opts.closed,
      send: vi.fn(() => release()),
      interrupt: vi.fn(async () => { throw new Error('x'); }),
      close: vi.fn(),
      events: (async function* () { await gate; for (const e of events) yield e; if (opts.throwAfter) throw new Error('boom'); })()
    };
    const hooks = { onSession: vi.fn(), onUsage: vi.fn() };
    const backend: any = { start: (o: any) => { started = o; return agent; } };
    const adv = new Advisor(backend, {} as any, hooks);
    return { adv, agent, hooks, started: () => started };
  }
  const asst = (text: string, extra: any = {}) => ({ t: 'assistant', blocks: [{ type: 'text', text }], ...extra });

  it('collects text, reports session and usage, ignores subagent messages', async () => {
    const { adv, hooks, started } = make([{ t: 'init', sessionId: 'S' }, asst('hello', { usage: { in: 1 } }), asst('ignored', { parentId: 'p' }), asst('world'), { t: 'result' }]);
    const p = adv.ask('hi');
    expect(adv.busy).toBe(true);
    await expect(adv.ask('again')).rejects.toThrow('already replying');
    expect(await p).toBe('hello\n\nworld');
    expect(hooks.onSession).toHaveBeenCalledWith('S');
    expect(hooks.onUsage).toHaveBeenCalledTimes(1);
    expect(await started().canUseTool('Edit', {})).toMatchObject({ behavior: 'deny' });
    expect(await started().admitSubagent()).toMatch(/Read-only/);
    await adv.interrupt();
    adv.close();
    await new Promise((r) => setTimeout(r, 0));
    expect(adv.dead).toBe(true);
    await expect(adv.ask('x')).rejects.toThrow('stopped');
  });
  it('uses the result text when nothing else was said, and fails on an error result', async () => {
    const a = make([{ t: 'result', text: 'final' }]);
    expect(await a.adv.ask('q')).toBe('final');
    const b = make([{ t: 'result', isError: true, text: 'bad' }]);
    await expect(b.adv.ask('q')).rejects.toThrow('bad');
    const c = make([{ t: 'result', isError: true }]);
    await expect(c.adv.ask('q')).rejects.toThrow('The agent failed.');
  });
  it('rejects when the stream throws or ends mid-reply, but not when closed', async () => {
    await expect(make([], { throwAfter: true }).adv.ask('q')).rejects.toThrow('boom');
    await expect(make([]).adv.ask('q')).rejects.toThrow('The agent stopped.');
    expect(await make([], { closed: true }).adv.ask('q')).toBe('');
    expect(await make([], { closed: true, throwAfter: true }).adv.ask('q')).toBe('');
  });
});
