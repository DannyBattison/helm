import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { AgentLogo, hasAgentLogo } from '../src/renderer/src/ui/AgentLogo';
import { Avatar } from '../src/renderer/src/ui/Avatar';

describe('agent logos', () => {
  it('has a mark for Claude and for Codex (the ChatGPT mark), and none for others', () => {
    expect(hasAgentLogo('claude')).toBe(true);
    expect(hasAgentLogo('codex')).toBe(true);
    expect(hasAgentLogo('gemini')).toBe(false);
    expect(hasAgentLogo(undefined)).toBe(false);
    expect(renderToStaticMarkup(React.createElement(AgentLogo, { backend: 'gemini' }))).toBe('');
  });
  it('draws the agent\'s own mark in its avatar and the robot when it has none', () => {
    const html = (backend?: string) => renderToStaticMarkup(React.createElement(Avatar, { agent: true, backend, name: 'x', size: 22 }));
    expect(html('claude')).toContain('aria-label="Claude"');
    expect(html('claude')).toContain('#D97757');
    expect(html('codex')).toContain('aria-label="ChatGPT"');
    expect(html('codex')).not.toContain('ph-robot');
    expect(html(undefined)).toContain('ph-robot');
    expect(html('gemini')).toContain('ph-robot');
  });
});
