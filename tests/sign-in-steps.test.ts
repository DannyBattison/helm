import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { SignInSteps } from '../src/renderer/src/views/SignInSteps';

const noop = () => undefined;
const html = (label: string, step: { url: string; code?: string; needsCode: boolean }) => renderToStaticMarkup(React.createElement(SignInSteps, { backend: { label }, step, code: '', setCode: noop, busy: false, onOpen: noop, onPaste: noop, onCopy: async () => undefined, onSubmit: noop, onCancel: noop }));

describe('sign-in steps for each agent', () => {
  const claude = html('Claude Code', { url: 'https://claude.example/auth', needsCode: true });
  const codex = html('Codex', { url: 'https://auth.example/device', code: 'ABCD-1234', needsCode: false });

  it('both open the page in step 1, with a button to copy the link', () => {
    for (const h of [claude, codex]) {
      expect(h).toContain('Open the sign-in page');
      expect(h).toMatch(/Open (Claude Code|Codex) sign-in/);
      expect(h).toContain('Copy link');
    }
  });
  it('Codex shows its code with a button to copy it', () => {
    expect(codex).toContain('Enter this code there');
    expect(codex).toContain('ABCD-1234');
    expect(codex).toContain('Copy code');
    expect(codex).toContain('Waiting for you to finish');
  });
  it('Claude asks for the code it shows to be pasted, with a Paste button', () => {
    expect(claude).toContain('Paste the code it shows');
    expect(claude).toContain('Paste');
    expect(claude).toContain('Continue');
    expect(claude).not.toContain('Copy code');
  });
  it('both can be cancelled', () => {
    expect(claude).toContain('Cancel');
    expect(codex).toContain('Cancel');
  });
});
