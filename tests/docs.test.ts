import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// docs/ is the wiki. The publish script checks every link and heading anchor and exits 1 when one is broken, so running it is the test.
const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'docs');
const script = join(root, '.github/scripts/prepare-wiki.mjs');
const pages = readdirSync(docs).filter((f) => f.endsWith('.md'));

describe('docs/', () => {
  it('names pages Title-Case-With-Hyphens.md, apart from README, STYLE and the wiki navigation', () => {
    for (const f of pages) expect(f).toMatch(/^(_Sidebar|_Footer|README|STYLE|[A-Z][A-Za-z0-9]*(-[A-Za-z0-9]+)*)\.md$/);
  });

  it('has a Home page and lists every page in the sidebar', () => {
    expect(pages).toContain('Home.md');
    const side = readFileSync(join(docs, '_Sidebar.md'), 'utf8');
    for (const f of pages) if (!/^(_|README|STYLE|Home)/.test(f)) expect(side, f).toContain(`(${f})`);
  });

  it('has no broken links or anchors, and publishes without .md in links', () => {
    const out = mkdtempSync(join(tmpdir(), 'helm-wiki-'));
    execFileSync(process.execPath, [script, docs, out], { stdio: 'pipe' });
    expect(existsSync(join(out, 'README.md'))).toBe(false);
    expect(existsSync(join(out, 'STYLE.md'))).toBe(false);
    expect(readFileSync(join(out, 'Home.md'), 'utf8')).not.toMatch(/\]\([A-Za-z-]+\.md/);
  });
});
