import { describe, expect, it } from 'vitest';
import { prBody, prSummary, prTitle, replaceSummary } from '../src/shared/prText';

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
