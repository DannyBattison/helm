// Turns docs/ into the files of the GitHub wiki: node prepare-wiki.mjs <docs dir> <output dir>
//
// - Checks that every link to another page, and every #heading anchor, resolves; exits 1 if not.
// - Copies the pages, rewriting `[x](Page-Name.md#a)` to `[x](Page-Name#a)`, which is how a wiki links.
// - Leaves out README.md and STYLE.md (for the repository, not the wiki).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [docs, out] = process.argv.slice(2);
if (!docs || !out) { console.error('usage: prepare-wiki.mjs <docs dir> <output dir>'); process.exit(2); }

const SKIP = new Set(['README.md', 'STYLE.md']);
const pages = readdirSync(docs).filter((f) => f.endsWith('.md'));
const text = Object.fromEntries(pages.map((f) => [f, readFileSync(join(docs, f), 'utf8')]));

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
const slug = (h) => h.trim().toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
const anchors = (md) => {
  const seen = new Map(), set = new Set();
  let fence = false;
  for (const line of md.split('\n')) {
    if (/^```/.test(line)) fence = !fence;
    const m = !fence && /^#{1,6}\s+(.*?)\s*#*$/.exec(line);
    if (!m) continue;
    const s = slug(m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_]/g, ''));
    const n = seen.get(s) || 0;
    seen.set(s, n + 1);
    set.add(n ? `${s}-${n}` : s);
  }
  return set;
};
const anchorsOf = Object.fromEntries(pages.map((f) => [f, anchors(text[f])]));

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const problems = [];
const rewritten = {};
for (const f of pages) {
  let fence = false;
  rewritten[f] = text[f].split('\n').map((line, i) => {
    if (/^```/.test(line)) fence = !fence;
    if (fence) return line;
    // Odd-numbered pieces are inline code (a closed pair of backticks), left as written.
    return line.split(/(`[^`]+`)/).map((piece, k) => k % 2 ? piece : piece.replace(LINK, (whole, target) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return whole;
      const [file, hash] = target.split('#');
      const page = file || f;
      if (!page.endsWith('.md') || !text[page]) problems.push(`${f}:${i + 1}: no page "${target}" (links to pages need the .md)`);
      else if (hash && !anchorsOf[page].has(hash)) problems.push(`${f}:${i + 1}: no heading "#${hash}" in ${page}`);
      return whole.replace(`(${target})`, `(${file ? file.slice(0, -3) : ''}${hash ? '#' + hash : ''})`);
    })).join('');
  }).join('\n');
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of pages) if (!SKIP.has(f)) writeFileSync(join(out, f), rewritten[f]);
console.log(`Prepared ${pages.length - SKIP.size} wiki pages in ${out}`);
