import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGS: Record<string, any> = { bash, c, cpp, csharp, css, dockerfile, go, ini, java, javascript, json, kotlin, makefile, markdown, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

const BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', md: 'markdown', mdx: 'markdown', py: 'python', go: 'go', rs: 'rust', java: 'java',
  kt: 'kotlin', kts: 'kotlin', swift: 'swift', rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini',
  sql: 'sql', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', mk: 'makefile'
};
const BY_NAME: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile' };

/** The language of a file, from its name. Null when the name does not say, so nothing is guessed. */
export function langFromPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop()!.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  const dot = name.lastIndexOf('.');
  return dot > 0 || name.startsWith('.') ? BY_EXT[name.slice(name.lastIndexOf('.') + 1)] ?? null : null;
}

/** Names a fenced block may use: ```ts, ```shell and so on. */
export function langFromTag(tag: string): string | null {
  const t = tag.trim().toLowerCase().split(/[\s{]/)[0];
  if (!t) return null;
  const alias: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', yml: 'yaml', py: 'python', rs: 'rust', html: 'xml', cs: 'csharp', 'c++': 'cpp', golang: 'go', rb: 'ruby', toml: 'ini', md: 'markdown', jsonc: 'json' };
  const l = alias[t] ?? t;
  return LANGS[l] ? l : null;
}


const cache = new Map<string, string>();

/** Highlights one line of code in a known language. Null for a language helm does not know, or an absurdly long line. */
export function highlightLine(text: string, lang: string | null | undefined): string | null {
  if (!lang || !LANGS[lang] || !text || text.length > 400) return null;
  const key = lang + '\u0000' + text;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let html: string | null = null;
  try { html = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value; } catch { html = null; }
  if (cache.size > 20000) cache.clear();
  cache.set(key, html ?? '');
  return html;
}

type Rule = { lang: string; signals: RegExp[]; decisive?: RegExp[] };
// A CSS rule opens with a selector. Lines that start with a keyword of another language (`interface Repo {`) are not selectors.
// Spaces and tabs only, never `\s`, which would run on across lines. Every extra word needs a separator before it, so a run of letters
// cannot be split between repeats in more than one way. Without that, a line like `npx wrangler login` took tens of seconds.
const CSS_SELECTOR = /^(?![ \t]*(?:interface|class|function|if|else|for|while|switch|try|catch|struct|enum|impl|func|type|do|return|export|const|let|var|def|fn|namespace|module)\b)[ \t]*(?:(?::root|\*|[.#]?[\w-]+)(?:(?:[ \t]*[>+~,][ \t]*|[ \t]+)[.#:]?[\w-]+)*|@media[^{\n]+)[ \t]*\{[ \t]*$/m;
const RULES: Rule[] = [
  { lang: 'typescript', signals: [/^\s*import\s.+\sfrom\s+['"]/m, /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+\w+\s*\(/m, /^\s*(export\s+)?(const|let|var)\s+\w+(\s*:\s*[\w<>[\]|, ]+)?\s*=/m, /=>\s*[{(\w]/, /^\s*(export\s+)?(interface|type)\s+\w+/m, /\bconsole\.\w+\(/, /^\s*(export\s+)?class\s+\w+(\s+extends\s+\w+)?\s*\{/m, /\brequire\(['"]/, /\buse(State|Effect|Ref|Memo)\(/] },
  { lang: 'python', signals: [/^\s*def\s+\w+\(.*\)\s*(->\s*[\w[\], .]+)?:\s*$/m, /^\s*class\s+\w+(\(.*\))?:\s*$/m, /^\s*from\s+[\w.]+\s+import\s+/m, /^\s*(elif|else|try|except|finally|with\s+.+|if\s+.+|for\s+.+\s+in\s+.+|while\s+.+):\s*$/m, /\bself\.\w+/, /^\s*@\w+(\.\w+)*(\(.*\))?\s*$/m, /^\s*print\(/m, /\bif __name__ == ['"]__main__['"]/] },
  { lang: 'go', signals: [/^func\s+(\(\w+\s+\*?\w+\)\s+)?\w+\(/m, /\s:=\s/, /^import\s+(\(|")/m, /\bfmt\.\w+\(/, /^type\s+\w+\s+(struct|interface)\s*\{/m, /\berr\s*!=\s*nil\b/], decisive: [/^package\s+\w+\s*$/m] },
  { lang: 'rust', signals: [/^\s*(pub\s+)?(async\s+)?fn\s+\w+(<.*>)?\(/m, /\blet\s+(mut\s+)?\w+/, /^\s*use\s+[\w:]+(::\{.*\})?;/m, /\bimpl(<.*>)?\s+\w+/, /\bprintln!\(/, /^\s*(pub\s+)?(struct|enum|trait)\s+\w+/m, /->\s*(Result|Option|Self)\b/] },
  { lang: 'java', signals: [/^\s*(public|private|protected)\s+(static\s+)?(final\s+)?[\w<>[\]]+\s+\w+\s*\(/m, /^\s*package\s+[\w.]+;/m, /^\s*import\s+[\w.]+(\.\*)?;/m, /\bSystem\.out\.print/, /^\s*(public\s+)?(final\s+)?class\s+\w+/m, /@Override/] },
  { lang: 'sql', signals: [/\bSELECT\b[\s\S]*\bFROM\b/, /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/, /\b(WHERE|GROUP\s+BY|ORDER\s+BY|LEFT\s+JOIN|INNER\s+JOIN)\b/, /;\s*$/m] },
  { lang: 'bash', signals: [/^\s*\$\s+\S+/m, /^\s*(sudo|cd|ls|npm|pnpm|yarn|git|docker|curl|mkdir|export|echo|cat|grep|rm|cp|mv|chmod|make|python3?|node|npx|brew|apt(-get)?|pip3?)\s+\S+/m, /\|\s*(grep|tee|sort|head|tail|wc|xargs|awk|sed)\b/, /\s&&\s+\w+/, /^\s*(if\s+\[|for\s+\w+\s+in\s|fi$|done$)/m, /\$\{?[A-Za-z_]\w*\}?/], decisive: [/^#!\/(usr\/)?bin\/(env\s+)?(ba|z)?sh/m] },
  { lang: 'css', signals: [CSS_SELECTOR, /^\s*[a-z-]+\s*:\s*[^;]*(px|rem|em|%|#[0-9a-f]{3,8}|rgba?\(|var\(|auto|none|flex|block|solid)[^;]*;\s*$/m, /@(media|import|keyframes)\b/] },
  { lang: 'xml', signals: [/^\s*<(html|head|body|div|span|section|ul|li|a|p|h[1-6]|button|form|input|svg|template|table|nav|header|footer|main)\b[^>]*>/m, /<\/[a-z][\w-]*>\s*$/m], decisive: [/^\s*<!DOCTYPE\s+html/im, /^\s*<\?xml/m] }
];

/**
 * Names a language only when the evidence is strong: valid JSON, a decisive marker such as a shebang or `package main`,
 * or at least two separate language-specific signals with a clear lead over the next language. Otherwise null.
 */
export function detectLanguage(code: string): string | null {
  const text = code.trim();
  if (text.length < 24 || !text.includes('\n')) return null;
  if (/^[{[]/.test(text)) { try { if (typeof JSON.parse(text) === 'object') return 'json'; } catch { /* not JSON */ } }
  const scores = RULES.map((r) => ({ lang: r.lang, score: r.signals.filter((x) => x.test(text)).length + (r.decisive?.some((x) => x.test(text)) ? 2 : 0) })).sort((a, b) => b.score - a.score);
  if (scores[0].score >= 2 && scores[0].score >= scores[1].score + 1) return scores[0].lang;
  // YAML has no distinctive keywords: three or more `key:` lines, and nothing that looks like another language.
  if (scores[0].score === 0 && (text.match(/^[A-Za-z_][\w-]*:(\s+\S.*)?$/gm) || []).length >= 3 && !/[{};]/.test(text)) return 'yaml';
  return null;
}

/** Highlights a block with the language given, or the one detected with confidence. Plain (null) when neither applies. */
export function highlightBlock(code: string, lang?: string | null): { html: string; lang: string } | null {
  if (code.length > 20000) return null;
  const use = lang && LANGS[lang] ? lang : detectLanguage(code);
  if (!use) return null;
  try { return { html: hljs.highlight(code, { language: use, ignoreIllegals: true }).value, lang: use }; } catch { return null; }
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sh = (t: string) => { try { return hljs.highlight(t, { language: 'bash', ignoreIllegals: true }).value; } catch { return esc(t); } };

/** What a heredoc feeds: the file it is written to, or the interpreter it is piped into. Null when the command does not say. */
function heredocLanguage(head: string): string | null {
  const target = head.match(/(?:>>?|\btee(?:\s+-a)?)\s+["']?([^\s"'|&;<>]+)/);
  const fromFile = target ? langFromPath(target[1]) : null;
  if (fromFile) return fromFile;
  const interp = head.match(/\b(python3?|node|ruby|php|bash|zsh|sh|psql|sqlite3|mysql)\b[^\n]*<</);
  const map: Record<string, string> = { python: 'python', python3: 'python', node: 'javascript', ruby: 'ruby', php: 'php', bash: 'bash', zsh: 'bash', sh: 'bash', psql: 'sql', sqlite3: 'sql', mysql: 'sql' };
  return interp ? map[interp[1]] ?? null : null;
}

/**
 * Highlights a shell command for display. A heredoc body is highlighted as the language it is written in (from the
 * target file's extension or the interpreter), else only if the language can be detected confidently; the shell around
 * it is highlighted as shell. Returns null when nothing is worth highlighting.
 */
export function highlightCommand(cmd: string): string | null {
  if (cmd.length > 20000) return null;
  const lines = cmd.split('\n');
  const at = lines.findIndex((l) => /<<-?\s*(['"]?)\w+\1/.test(l));
  if (at < 0) return sh(cmd);
  const delim = lines[at].match(/<<-?\s*(['"]?)(\w+)\1/)![2];
  const end = lines.findIndex((l, i) => i > at && l.trim() === delim);
  const bodyEnd = end < 0 ? lines.length : end;
  const head = lines.slice(0, at + 1).join('\n');
  const body = lines.slice(at + 1, bodyEnd).join('\n');
  const tail = lines.slice(bodyEnd).join('\n');
  const lang = heredocLanguage(head) ?? detectLanguage(body);
  let bodyHtml: string;
  try { bodyHtml = lang && LANGS[lang] ? hljs.highlight(body, { language: lang, ignoreIllegals: true }).value : esc(body); } catch { bodyHtml = esc(body); }
  return sh(head) + '\n' + bodyHtml + (tail ? '\n' + sh(tail) : '');
}
