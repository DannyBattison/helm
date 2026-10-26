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
    expect(commandSummary('cd app && npm test && git status')).toBe('Run the tests, Check git status');
    expect(commandSummary('CI=1 npx vitest run')).toBe('Run the tests');
  });
  it('lists the first three steps of a chain and counts the rest', () => {
    expect(commandSummary('git add . && git commit -m x && git push')).toBe('Stage changes, Commit: x, Push to GitHub');
    expect(commandSummary('npm ci && npm run build && npm test && git status && ls')).toBe('Install dependencies, Run the build script, Run the tests and 2 more');
  });
  it('says what a search, read or edit acts on', () => {
    expect(commandSummary('grep -rn "isFreeGroup" src --include=*.tsx')).toBe('Search for "isFreeGroup" in src');
    expect(commandSummary("rg -n 'foo|bar' src/core")).toBe('Search for "foo|bar" in core');
    expect(commandSummary('cat src/shared/types.ts')).toBe('Read types.ts');
    expect(commandSummary("sed -i 's/a/b/' src/x/Dialogs.tsx")).toBe('Edit Dialogs.tsx');
    expect(commandSummary('find . -name "*.test.ts" | head')).toBe('Find files named *.test.ts');
    expect(commandSummary('git commit -m "Fix the header"')).toBe('Commit: Fix the header');
    expect(commandSummary('git add src/a.ts src/b.ts')).toBe('Stage a.ts, b.ts');
    expect(commandSummary('echo hi > out.txt')).toBe('Write out.txt');
  });
  it('does not read heredoc bodies or pipeline filters as commands', () => {
    const script = "cd /x; python3 - <<'E'\ndef sub(p,a,b):\n    s=open(p).read()\n    open(p,'w').write(s)\nsub('src/shared/types.ts','a','b')\nE\ngit diff --stat";
    expect(commandSummary(script.replace(/\\n/g, '\n'))).toBe('Edit types.ts with Python, Show changes');
    expect(commandSummary('npm test 2>&1 | tail -8')).toBe('Run the tests');
    expect(commandSummary("python3 -c \"print(1)\"")).toBe('Run an inline Python script');
    expect(commandSummary('node build.js')).toBe('Run build.js');
  });
  it('looks through loops and conditions to the command inside', () => {
    expect(commandSummary('for f in src/*.ts; do grep -n TODO $f; done')).toBe('Loop over src/*.ts, Search for "TODO"');
    expect(commandSummary('if [ -f package.json ]; then npm ci; fi')).toBe('Install dependencies');
    expect(commandSummary('while true; do sleep 1; done')).toBe('Wait 1');
  });
  it('falls back to the program name', () => {
    expect(commandSummary('ffmpeg -i a.mp4 b.gif')).toBe('Run ffmpeg');
    expect(commandSummary('')).toBe('Run a command');
  });
});
