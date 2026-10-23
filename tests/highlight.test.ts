import { describe, expect, it } from 'vitest';
import { highlightBlock, highlightLine, langFromPath, langFromTag } from '../src/renderer/src/highlight';

describe('language from a file name', () => {
  it('knows common extensions and special file names', () => {
    expect(langFromPath('src/App.tsx')).toBe('typescript');
    expect(langFromPath('C:\\code\\main.go')).toBe('go');
    expect(langFromPath('Dockerfile')).toBe('dockerfile');
    expect(langFromPath('infra/Makefile')).toBe('makefile');
    expect(langFromPath('package.json')).toBe('json');
  });
  it('does not guess for unknown names', () => {
    expect(langFromPath('LICENSE')).toBeNull();
    expect(langFromPath('notes.xyz')).toBeNull();
    expect(langFromPath('archive.tar.gz')).toBeNull();
  });
  it('maps fence tags, including aliases', () => {
    expect(langFromTag('ts')).toBe('typescript');
    expect(langFromTag('shell')).toBe('bash');
    expect(langFromTag('python title="x.py"')).toBe('python');
    expect(langFromTag('')).toBeNull();
    expect(langFromTag('klingon')).toBeNull();
  });
});

describe('highlighting a block', () => {
  it('uses the language it is given', () => {
    const r = highlightBlock('def add(a, b):\n    return a + b', 'python');
    expect(r?.lang).toBe('python');
    expect(r?.html).toContain('hljs-keyword');
  });

  it('recognises clear code without being told the language', () => {
    const cases: Record<string, string> = {
      typescript: `import { useState } from 'react';

export function Counter({ start }: { start: number }) {
  const [n, setN] = useState(start);
  return <button onClick={() => setN(n + 1)}>{n}</button>;
}`,
      go: `package main

import "fmt"

func main() {
\tfmt.Println("hello")
}`,
      sql: `SELECT u.id, COUNT(o.id) AS orders
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at > '2024-01-01'
GROUP BY u.id;`,
      python: `def add(a, b):
    total = a + b
    return total

class Cart:
    def __init__(self):
        self.items = []`,
      rust: `fn main() {
    let v: Vec<i32> = vec![1, 2, 3];
    for x in &v { println!("{}", x); }
}`,
      json: `{
  "name": "helm",
  "version": "0.1.0",
  "private": true
}`,
      bash: `cd /tmp && npm install --save-dev vitest
export FOO=bar
echo "done" | tee out.txt`,
      css: `.panel > .row {
  display: flex;
  padding: 8px 12px;
  color: var(--text-1);
}`,
      yaml: `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest`
    };
    for (const [lang, code] of Object.entries(cases)) expect(`${lang}:${highlightBlock(code)?.lang}`).toBe(`${lang}:${lang}`);
  });

  it('does not mistake TypeScript interfaces for CSS', () => {
    const iface = `export interface Repo {
  id: string;
  name: string;
  private: boolean;
}`;
    expect(highlightBlock(iface)?.lang).not.toBe('css');
  });

  it('leaves prose, short fragments and output plain', () => {
    expect(highlightBlock('The first line of the README is the project name.\nIt is followed by a short description of what helm does.')).toBeNull();
    expect(highlightBlock('ok')).toBeNull();
    expect(highlightBlock('x = 1')).toBeNull();
    expect(highlightBlock('2 files changed, 14 insertions(+), 3 deletions(-)\n 3 passed, 0 failed in 4.2s')).toBeNull();
    expect(highlightBlock('Error: ENOENT: no such file or directory, open "missing.txt"\n    at Object.openSync (node:fs:573:18)')).toBeNull();
  });
});

describe('highlighting a line', () => {
  it('highlights in a known language and returns null otherwise', () => {
    expect(highlightLine('const x = 1;', 'typescript')).toContain('hljs-keyword');
    expect(highlightLine('const x = 1;', null)).toBeNull();
    expect(highlightLine('const x = 1;', 'klingon')).toBeNull();
    expect(highlightLine('a'.repeat(500), 'typescript')).toBeNull();
  });
  it('escapes markup so highlighted text cannot inject HTML', () => {
    expect(highlightLine('const s = "<img src=x onerror=alert(1)>";', 'typescript')).not.toContain('<img');
  });
});
