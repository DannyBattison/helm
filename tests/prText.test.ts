import { describe, expect, it } from 'vitest';
import { parsePr, prBody, prSummary, prTitle, prTitleFrom, replaceSummary } from '../src/shared/prText';

describe('prTitle', () => {
  it('keeps a short title', () => expect(prTitle('Fix the bug')).toBe('Fix the bug'));
  it('uses the first line and cuts long text at a word', () => {
    const t = prTitle('opening a pull request can fail if the title is too long: make sure the title is brief\nand more');
    expect(t.length).toBeLessThanOrEqual(72);
    expect(t.endsWith('…')).toBe(true);
  });
});

describe('replaceSummary', () => {
  const a = prBody(prSummary({ task: 'T', commits: [{ msg: 'one' }] }), 's1');
  it('refreshes the helm block and keeps the rest', () => {
    const n = replaceSummary('intro\n\n' + a, prSummary({ task: 'T', commits: [{ msg: 'two' }, { msg: 'one' }] }))!;
    expect(n).toContain('- one\n- two');
    expect(n.startsWith('intro')).toBe(true);
    expect(n).toContain('Created with helm');
  });
  it('leaves a rewritten description alone', () => expect(replaceSummary('mine', 'x')).toBeNull());
});

describe('templates', () => {
  const ctx = { task: 'Please can you make the thing do the other thing, thanks a lot, really', commits: [{ msg: 'Add retry to the uploader' }, { msg: 'Extract uploader' }], branch: 'agent/x', base: 'main', issue: 4, files: 2, add: 5, del: 1 };
  it('titles from the first commit, not the task', () => expect(prTitleFrom({}, ctx)).toBe('Extract uploader'));
  it('falls back to the task with no commits', () => expect(prTitleFrom({}, { ...ctx, commits: [] })).toContain('Please can you'));
  it('fills custom templates', () => {
    expect(prTitleFrom({ prTitleTemplate: '[{{branch}}] {{commit}}' }, ctx)).toBe('[agent/x] Extract uploader');
    const b = prSummary(ctx, { prBodyTemplate: 'Into {{base}}\n{{commits}}\n{{issue}}' });
    expect(b).toContain('Into main\n- Extract uploader\n- Add retry to the uploader\nCloses #4');
    expect(b).not.toContain('Please can you');
  });
  it('drops empty optional lines', () => expect(prSummary({ ...ctx, issue: undefined }, { prBodyTemplate: 'A\n\n{{issue}}\n\nB' })).toContain('A\n\nB'));
  it('reads the agent answer', () => {
    expect(parsePr({ title: ' Fix it ', body: 'Done' }, '')).toEqual({ title: 'Fix it', body: 'Done' });
    expect(parsePr(undefined, 'sure {"title":"T","body":"B"}')).toEqual({ title: 'T', body: 'B' });
    expect(parsePr(undefined, 'nope')).toBeNull();
  });
});
