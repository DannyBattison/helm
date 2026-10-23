import { describe, expect, it } from 'vitest';
import { highlightCommand } from '../src/renderer/src/highlight';

const lines = (...l: string[]) => l.join('\n');

describe('highlighting a shell command', () => {
  it('highlights the shell and the JavaScript a heredoc writes to a .mjs file', () => {
    const cmd = lines(
      "mkdir -p mobile/scripts && cat > mobile/scripts/build.mjs <<'EOF'",
      '#!/usr/bin/env node',
      "import { spawnSync } from 'node:child_process';",
      "const win = platform() === 'win32';",
      'function run(bin, argv) {',
      '  return spawnSync(bin, argv);',
      '}',
      'EOF'
    );
    const html = highlightCommand(cmd)!;
    expect(html).toContain('hljs-keyword'); // import, const and function in the body
    expect(html).toContain('hljs-string');
    expect(html).toMatch(/mkdir<\/span>|mkdir/); // the shell line is still there
    expect(html.trimEnd().endsWith('EOF')).toBe(true);
    expect(html.split('\n').length).toBe(cmd.split('\n').length); // lines are preserved one for one
  });

  it('uses the interpreter when there is no target file', () => {
    const html = highlightCommand(lines("python3 - <<'PY'", 'def add(a, b):', '    return a + b', "print(add(1, 2))", 'PY'))!;
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-built_in'); // print
  });

  it('does not guess for an unknown file type, and still keeps the text', () => {
    const html = highlightCommand(lines('cat > notes.xyz <<EOF', 'just some words', 'and more words', 'EOF'))!;
    expect(html).toContain('just some words');
    expect(html).not.toMatch(/hljs-keyword[^>]*>just/);
  });

  it('escapes markup in a heredoc body', () => {
    const html = highlightCommand(lines('cat > page.html <<EOF', '<img src=x onerror=alert(1)>', 'EOF'))!;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;');
  });

  it('copes with a heredoc that is never closed and with plain multi-line commands', () => {
    expect(highlightCommand(lines('cat > a.js <<EOF', 'const x = 1;'))).toContain('const');
    expect(highlightCommand(lines('cd /tmp', 'npm install --save-dev vitest', 'echo "done"'))).toContain('hljs-');
  });

  it('keeps long single commands highlighted too', () => {
    const long = 'echo ' + 'a'.repeat(600) + ' | grep a';
    expect(highlightCommand(long)).toContain('hljs-');
  });
});
