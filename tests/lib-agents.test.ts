import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { agentName, backendFor, backendIdOf, can, defaultChoice, modelChoices, modelOptions, splitChoice } from '../src/renderer/src/lib';
import { Avatar } from '../src/renderer/src/ui/Avatar';

const caps = (over: any = {}) => ({ subagents: true, planMode: true, effort: true, fork: true, cost: true, planUsage: true, ...over });
const be = (id: string, label: string, models: string[], over: any = {}) => ({ id, label, shortName: label, models: models.map((m) => ({ id: m, label: m.toUpperCase(), price: [0, 0] })), capabilities: caps(), version: '1', installed: true, canSignIn: true, configured: true, enabled: true, ready: true, ...over });
const app = (backends: any[], settings: any = {}): any => ({ backends, settings: { defaultBackend: 'claude', defaultModel: 'sonnet', ...settings } });

describe('choosing an agent and model in the interface', () => {
  const both = app([be('claude', 'Claude Code', ['sonnet', 'opus']), be('codex', 'Codex', ['gpt-a'])]);
  it('lists every model of every ready agent, naming the agent when there are several', () => {
    expect(modelChoices(both)).toEqual([{ value: 'claude/sonnet', label: 'Claude Code · SONNET' }, { value: 'claude/opus', label: 'Claude Code · OPUS' }, { value: 'codex/gpt-a', label: 'Codex · GPT-A' }]);
  });
  it('leaves the agent out of the label when only one is ready, and leaves out one that is not', () => {
    const one = app([be('claude', 'Claude Code', ['sonnet']), be('codex', 'Codex', ['gpt-a'], { ready: false })]);
    expect(modelChoices(one)).toEqual([{ value: 'claude/sonnet', label: 'SONNET' }]);
    expect(modelChoices({ settings: {} } as any)).toEqual([]);
  });
  it('splits a choice at the first slash, so a model may contain slashes', () => {
    expect(splitChoice('codex/gpt-a')).toEqual({ backend: 'codex', model: 'gpt-a' });
    expect(splitChoice('x/org/model')).toEqual({ backend: 'x', model: 'org/model' });
  });
  it('defaults to the setting when it can be used, else to the first thing that can', () => {
    expect(defaultChoice(app(both.backends, { defaultBackend: 'codex', defaultModel: 'gpt-a' }))).toBe('codex/gpt-a');
    expect(defaultChoice(app(both.backends, { defaultBackend: 'codex', defaultModel: 'gone' }))).toBe('claude/sonnet');
    expect(defaultChoice(app([], { defaultBackend: 'codex', defaultModel: 'gpt-a' }))).toBe('codex/gpt-a');
  });
  it('offers a session its own agent\'s models', () => {
    expect(modelOptions(both, 'codex')).toEqual([{ value: 'gpt-a', label: 'GPT-A' }]);
    expect(modelOptions(both)).toHaveLength(2);
    expect(modelOptions(app([]))).toEqual([]);
  });
});

describe('what the interface knows of a session\'s agent', () => {
  const both = app([be('claude', 'Claude Code', ['sonnet']), be('codex', 'Codex', ['gpt-a'], { shortName: 'Codex', capabilities: caps({ effort: false }) })]);
  it('finds the agent, falling back to the first for a session saved before there were others', () => {
    expect(backendFor(both, 'codex')?.id).toBe('codex');
    expect(backendFor(both)?.id).toBe('claude');
    expect(backendFor(both, 'gone')?.id).toBe('claude');
    expect(backendIdOf(both, { backend: 'codex' })).toBe('codex');
    expect(backendIdOf(both, undefined)).toBe('claude');
    expect(backendIdOf(app([]), {})).toBe('claude');
  });
  it('names it, and says what it can do', () => {
    expect(agentName(both, { backend: 'codex' })).toBe('Codex');
    expect(agentName(app([]), {})).toBe('Claude');
    expect(can(both, { backend: 'codex' }, 'effort')).toBe(false);
    expect(can(both, { backend: 'claude' }, 'effort')).toBe(true);
    // Before the agents have loaded nothing is hidden.
    expect(can(app([]), {}, 'fork')).toBe(true);
  });
});

describe('avatars', () => {
  const html = (props: any) => renderToStaticMarkup(React.createElement(Avatar, props));
  it('shows a picture, or the first letter of a name', () => {
    expect(html({ src: 'https://x/y.png', name: 'Danny' })).toContain('<img');
    expect(html({ name: 'danny' })).toContain('>D<');
    expect(html({})).toContain('>?<');
  });
});
