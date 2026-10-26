import { describe, expect, it } from 'vitest';
import { commandSummary } from '../src/shared/commandSummary';

describe('commandSummary', () => {
  it('prefers the description the agent gave', () => {
    expect(commandSummary('rm -rf dist', '  Clear the   build output ')).toBe('Clear the build output');
    expect(commandSummary('x', 'a'.repeat(200)).length).toBe(90);
  });
  it('names common git and package-manager commands', () => {
    expect(commandSummary('git push -u origin feature')).toBe('Push to GitHub');
    expect(commandSummary('git -C /tmp status')).toBe('Check git status');
    expect(commandSummary('npm install')).toBe('Install dependencies');
    expect(commandSummary('pnpm run test:unit')).toBe('Run the tests');
    expect(commandSummary('npm run build')).toBe('Run the build script');
  });
  it('skips cd, env assignments and notes when more follows', () => {
    expect(commandSummary('cd app && npm test && git status')).toBe('Run the tests and more');
    expect(commandSummary('CI=1 npx vitest run')).toBe('Run npx');
  });
  it('falls back to the program name', () => {
    expect(commandSummary('ffmpeg -i a.mp4 b.gif')).toBe('Run ffmpeg');
    expect(commandSummary('')).toBe('Run a command');
  });
});
