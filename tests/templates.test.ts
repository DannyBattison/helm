import { describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATES, cleanMessageTemplates, cleanPromptTemplates, composeMessage, messageBody, promptsFor, renderTemplate, templateVars } from '../src/shared/templates';
import { effectiveSettings } from '../src/shared/repoSettings';
import { defaultSettings } from '../src/core/store';
import { feedbackTask, issueTask } from '../src/shared/issues';

describe('templates', () => {
  it('finds variables once, in order', () => {
    expect(templateVars('{{a}} and {{ b }} and {{a}} {{not valid}}')).toEqual(['a', 'b']);
  });
  it('fills values, leaves unknown names, and does not substitute inside values', () => {
    expect(renderTemplate('x {{a}} {{zzz}}', { a: '{{zzz}}' })).toBe('x {{zzz}} {{zzz}}');
  });
  it('drops a line holding only an empty variable, with one blank line', () => {
    expect(renderTemplate('head\n\n{{opt}}\n\ntail', { opt: '' })).toBe('head\n\ntail');
    expect(renderTemplate('head\n\n{{opt}}', { opt: '' })).toBe('head');
    expect(renderTemplate('head\n{{opt}}\ntail', { opt: '' })).toBe('head\ntail');
    expect(renderTemplate('head\n\n{{opt}}\n\ntail', { opt: 'mid' })).toBe('head\n\nmid\n\ntail');
  });
  it('uses an override only when it has text', () => {
    expect(messageBody({ messageTemplates: { resume: 'Go on.' } }, 'resume')).toBe('Go on.');
    expect(messageBody({ messageTemplates: { resume: '  ' } }, 'resume')).toBe('Continue where you left off.');
    expect(composeMessage(undefined, 'resolveConflict', { target: 'origin/main', steps: 'git merge origin/main' })).toContain('conflict with origin/main. Please resolve it now');
  });
  it('declares every variable its default text uses', () => {
    for (const t of MESSAGE_TEMPLATES) expect(templateVars(t.body).filter((v) => !t.vars.some((x) => x.name === v))).toEqual([]);
  });
  it('shapes issue and feedback tasks from a custom text', () => {
    const issue = { number: 3, title: 'T', body: 'B', url: 'u', labels: [], author: 'a', comments: 0, updated: '' };
    expect(issueTask(issue, [], 'Do #{{number}}\n\n{{labels}}\n\n{{body}}')).toBe('Do #3\n\nB');
    expect(feedbackTask({ number: 4, title: 'P', url: 'u' }, [{ author: 'r', body: 'fix', at: '' }], '{{inline}}\n\n{{general}}')).toBe('General comments:\n- @r: fix');
  });
  it('cleans stored values', () => {
    expect(cleanMessageTemplates({ resume: 'x', bogus: 'y', requestChanges: '' })).toEqual({ resume: 'x' });
    expect(cleanPromptTemplates([{ id: '1', name: 'a', body: 'b' }, { id: '1', name: 'dup', body: '' }, { id: 2 }, null])).toEqual([{ id: '1', name: 'a', body: 'b' }]);
  });
  it('lists a repository\'s prompts before the global ones, a same name replacing', () => {
    const g = [{ id: 'g1', name: 'Review', body: 'g' }, { id: 'g2', name: 'Docs', body: 'd' }];
    const r = [{ id: 'r1', name: 'review', body: 'r' }];
    expect(promptsFor(g, r).map((p) => [p.id, p.scope])).toEqual([['r1', 'repo'], ['g2', 'global']]);
  });
  it('merges a repository\'s templates over the defaults', () => {
    const d = { ...defaultSettings(), messageTemplates: { resume: 'A', requestChanges: 'B' }, promptTemplates: [{ id: 'g', name: 'G', body: '' }] };
    const e = effectiveSettings(d, { settings: { messageTemplates: { resume: 'C' }, promptTemplates: [{ id: 'r', name: 'R', body: '' }] } });
    expect(e.messageTemplates).toEqual({ resume: 'C', requestChanges: 'B' });
    expect(e.promptTemplates.map((p) => p.id)).toEqual(['r', 'g']);
  });
});
