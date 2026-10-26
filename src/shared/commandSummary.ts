/**
 * A few words saying what a shell command does, for the header over a command preview. The agent's own description of the
 * command (the Bash tool takes one) is used when it gave one; otherwise this reads the command itself: heredoc bodies are
 * set aside, quotes are respected, only the head of a pipeline is described, and the common programs are named with what
 * they act on ("Search for \"foo\" in src", "Edit Shell.tsx"). Anything unknown says "Run" and the program.
 */
export function commandSummary(cmd: string, description?: unknown): string {
  const given = typeof description === 'string' ? description.trim().replace(/\s+/g, ' ') : '';
  if (given) return given.length > 90 ? given.slice(0, 89) + '…' : given;
  const { text, bodies } = stripHeredocs(cmd);
  // Each real command in the chain, past `cd dir &&` and env assignments, is described and the first few are listed.
  const parts = splitChain(text).filter((p) => !p.piped && p.text && !/^cd(\s|$)/.test(p.text) && !/^(set|export|true|:)(\s|$)/.test(p.text));
  const all = (parts.length ? parts.map((p) => p.text) : [text]).map((p) => describe(p, bodies));
  // Loop and test plumbing says nothing on its own, so it is only named when nothing else is left.
  const real = all.filter((d) => d !== null) as string[];
  const steps = (real.length ? real : all.filter((d): d is string => d !== undefined).map((d) => d ?? 'Run a command')).filter((d, i, a) => d !== a[i - 1]);
  const shown = steps.slice(0, 3);
  const rest = steps.length - shown.length;
  return shown.join(', ') + (rest > 0 ? ` and ${rest} more` : '');
}

/** Takes the bodies of `<<TAG` heredocs out of the command, so their lines are not read as commands. */
function stripHeredocs(cmd: string): { text: string; bodies: string[] } {
  const lines = cmd.split('\n'), out: string[] = [], bodies: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(lines[i].replace(/<<</g, ''));
    out.push(m ? lines[i].replace(/<<-?\s*(['"]?)[A-Za-z_][\w-]*\1/, '') : lines[i]);
    if (!m) continue;
    const body: string[] = [];
    while (++i < lines.length && lines[i].trim() !== m[2]) body.push(lines[i]);
    bodies.push(body.join('\n'));
  }
  return { text: out.join('\n').trim(), bodies };
}

/** Splits on `&&`, `||`, `;`, newlines and `|` outside quotes. A part after a single `|` is flagged: it only filters the output before it. */
function splitChain(text: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = '', q = '', piped = false;
  const flush = (nextPiped: boolean) => { out.push({ text: cur.trim(), piped }); cur = ''; piped = nextPiped; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === '\\' && q === '"') cur += text[++i] ?? ''; else if (c === q) q = ''; continue; }
    if (c === '\\') { cur += c + (text[++i] ?? ''); continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ((c === '&' && text[i + 1] === '&') || (c === '|' && text[i + 1] === '|')) { i++; flush(false); continue; }
    if (c === '|') { flush(true); continue; }
    if (c === ';' || c === '\n') { flush(false); continue; }
    cur += c;
  }
  flush(false);
  return out.filter((p) => p.text);
}

/** Shell words with the quotes removed. */
function tokens(part: string): string[] {
  const out: string[] = [];
  let cur = '', q = '', has = false;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"') cur += part[++i] ?? ''; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (c === '\\') { cur += part[++i] ?? ''; has = true; continue; }
    if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += c; has = true;
  }
  if (cur || has) out.push(cur);
  return out;
}

const base = (p: string) => p.replace(/\/+$/, '').replace(/^.*\//, '') || p;
const clip = (s: string, n = 32) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const list = (files: string[]) => (files.length <= 2 ? files.map(base).join(', ') : `${base(files[0])}, ${base(files[1])} +${files.length - 2}`);
const noop = (p: string) => p === '/dev/null' || p.startsWith('&');

/** Shell keywords that open or close a block, which are not programs. `null` for a part that is only plumbing. */
function describe(part: string, bodies: string[]): string | null {
  let rest = part.trim();
  if (/^(done|fi|esac|\}|\))$/.test(rest) || /^(\[\[?|test)\s/.test(rest)) return null;
  const loop = /^for\s+(?:\(\()?\S+\s+in\s+(.*)$/.exec(rest);
  if (loop) return `Loop over ${clip(loop[1].trim().replace(/\s+/g, ' '), 40)}`;
  // `do cmd`, `then cmd`, `if cmd`, `while cmd`, `{ cmd`: describe the command after the keyword.
  while (/^(do|then|else|elif|if|while|until|!|\{|\()\s+/.test(rest)) rest = rest.replace(/^(do|then|else|elif|if|while|until|!|\{|\()\s+/, '');
  if (/^(do|then|else|fi|done|for|while|if|until|case|true|false|:)$/.test(rest)) return null;
  if (/^(\[\[?|test)\s/.test(rest)) return null;
  return describeCommand(rest, bodies);
}

function describeCommand(part: string, bodies: string[]): string {
  let words = tokens(part);
  // Redirections: `> file` names what is written; `2>&1` and `>/dev/null` are noise.
  let wrote = '';
  const args: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const m = /^(\d*)(>>?|<)(.*)$/.exec(words[i]);
    if (!m) { args.push(words[i]); continue; }
    const target = m[3] || words[++i] || '';
    if (m[2] !== '<' && m[1] !== '2' && !noop(target)) wrote = target;
  }
  words = args.filter((w, i) => !(i === 0 || /^(sudo|time|nohup|env)$/.test(args[i - 1] || '')) || !/^[A-Z_][A-Z0-9_]*=/.test(w)).filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w) && !/^(sudo|time|nohup)$/.test(w));
  const name = base(words[0] || '');
  if (!name) return wrote ? `Write ${base(wrote)}` : 'Run a command';
  const rest = words.slice(1);
  const operands = (valueFlags: string[] = []) => { const o: string[] = []; for (let i = 0; i < rest.length; i++) { if (valueFlags.includes(rest[i])) i++; else if (!rest[i].startsWith('-') || rest[i] === '-') o.push(rest[i]); } return o; };

  if (name === 'git') return describeGit(rest);
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    const sub = rest.find((w) => !w.startsWith('-')) || '';
    const arg = rest.filter((w) => !w.startsWith('-'))[1] || '';
    if (['install', 'i', 'ci', 'add'].includes(sub)) return 'Install dependencies';
    if (sub === 'test' || (sub === 'run' && /^test/.test(arg))) return 'Run the tests';
    if (sub === 'run' || sub === 'exec') return `Run the ${arg || 'package'} script`;
    if (['build', 'start', 'dev', 'lint', 'typecheck'].includes(sub)) return `Run ${sub}`;
    return sub ? `Run ${name} ${sub}` : `Run ${name}`;
  }
  if (name === 'npx' || (name === 'pnpm' && rest[0] === 'dlx')) { const next = rest.filter((w) => !w.startsWith('-')); return next.length ? describeCommand(next.join(' '), bodies) : 'Run npx'; }
  if (['vitest', 'jest', 'pytest', 'mocha'].includes(name) || ((name === 'go' || name === 'cargo') && rest[0] === 'test')) return 'Run the tests';
  if (['tsc', 'eslint', 'prettier'].includes(name)) return `Run ${name}`;

  if (name === 'grep' || name === 'rg' || name === 'ag' || name === 'ack') {
    const e = rest.findIndex((w) => w === '-e' || w === '--regexp');
    const o = operands(['-e', '--regexp', '-g', '--glob', '-t', '--type', '-A', '-B', '-C', '-m', '--include', '--exclude', '--max-count']);
    const pat = e >= 0 ? rest[e + 1] : o.shift();
    const where = o.filter((w) => w !== '.' && !w.startsWith('$'));
    const files = rest.includes('-l') || rest.includes('--files-with-matches');
    return `${files ? 'Find files containing' : 'Search for'} "${clip(pat || '')}"${where.length ? ' in ' + list(where) : ''}`;
  }
  if (name === 'find' || name === 'fd') {
    const i = rest.findIndex((w) => w === '-name' || w === '-iname' || w === '-path');
    const pat = i >= 0 ? rest[i + 1] : name === 'fd' ? operands()[0] : '';
    return pat ? `Find files named ${clip(pat)}` : 'Find files';
  }
  if (name === 'ls' || name === 'tree') { const o = operands(); return o.length ? `List ${list(o)}` : 'List files'; }
  if (['cat', 'head', 'tail', 'less', 'bat', 'nl'].includes(name)) {
    const o = operands(['-n', '-c']);
    if (wrote) return `Write ${base(wrote)}`;
    return o.length ? `Read ${list(o)}` : 'Read a file';
  }
  if (name === 'sed' || name === 'perl') {
    const o = operands(['-e', '-f']); const file = o.length > 1 ? o.slice(1) : [];
    return rest.some((w) => /^-\w*i/.test(w)) && file.length ? `Edit ${list(file)}` : file.length ? `Read ${list(file)} through ${name}` : 'Transform text';
  }
  if (name === 'wc') { const o = operands(); return o.length ? `Count lines in ${list(o)}` : 'Count lines'; }
  if (name === 'diff') { const o = operands(); return o.length >= 2 ? `Compare ${list(o.slice(0, 2))}` : 'Compare files'; }
  if (name === 'mkdir') { const o = operands(); return o.length ? `Create folder ${list(o)}` : 'Create a folder'; }
  if (name === 'rm') { const o = operands(); return o.length ? `Delete ${list(o)}` : 'Delete files'; }
  if (name === 'mv') { const o = operands(); return o.length ? `Move ${list(o.slice(0, -1))}` : 'Move files'; }
  if (name === 'cp') { const o = operands(); return o.length ? `Copy ${list(o.slice(0, -1))}` : 'Copy files'; }
  if (name === 'touch') { const o = operands(); return o.length ? `Create ${list(o)}` : 'Create a file'; }
  if (name === 'chmod' || name === 'chown') { const o = operands(); return o.length > 1 ? `Change permissions on ${list(o.slice(1))}` : 'Change permissions'; }
  if (name === 'curl' || name === 'wget') { const u = operands(['-H', '-d', '-X', '-o', '-O', '-u', '--data', '--header', '--request'])[0] || ''; const host = /^https?:\/\/([^/]+)/.exec(u)?.[1]; return host ? `${name === 'wget' ? 'Download from' : 'Request'} ${host}` : name === 'wget' ? 'Download a file' : 'Make a web request'; }
  if (name === 'echo' || name === 'printf') return wrote ? `Write ${base(wrote)}` : 'Print text';
  if (name === 'tee') { const o = operands(); return o.length ? `Write ${list(o)}` : 'Write a file'; }
  if (name === 'sleep') return `Wait ${rest[0] || ''}`.trim();
  if (name === 'kill' || name === 'pkill') return 'Stop a process';
  if (name === 'make') return rest[0] && !rest[0].startsWith('-') ? `Run make ${rest[0]}` : 'Run make';
  if (name === 'docker') return `Run docker ${rest.find((w) => !w.startsWith('-')) || ''}`.trim();
  if (name === 'gh') { const o = operands(); return o.length ? `GitHub: ${o.slice(0, 2).join(' ')}` : 'Use the GitHub CLI'; }

  if (/^(python|python3|node|deno|bun|ruby|tsx|ts-node)(\.\d+)?$/.test(name) && !(name === 'bun' && ['install', 'run', 'test', 'add'].includes(rest[0]))) {
    const lang = name.startsWith('python') ? 'Python' : name === 'ruby' ? 'Ruby' : 'Node';
    if (rest[0] === '-m') return rest[1] === 'pytest' ? 'Run the tests' : `Run python -m ${rest[1] || ''}`.trim();
    const c = rest.findIndex((w) => w === '-c' || w === '-e' || w === '--eval' || w === '-p');
    const inline = c >= 0 ? rest[c + 1] || '' : rest.length === 0 || rest[0] === '-' ? bodies.join('\n') : '';
    if (c < 0 && rest.length && rest[0] !== '-') return `Run ${base(rest.find((w) => !w.startsWith('-')) || name)}`;
    // An inline script: say which files it names, and whether it writes.
    const files = [...new Set([...inline.matchAll(/['"`]([\w@./~-]*\.[A-Za-z][A-Za-z0-9]{0,4})['"`]/g)].map((m) => m[1]).filter((f) => !/^\.|^[\w-]+\.(?:replace|read|write|open|get|set)$/.test(f)))];
    const writes = /\bwrite|writeFile|\.dump\(|open\([^)]*['"][wa]\+?['"]/.test(inline);
    if (files.length) return `${writes ? 'Edit' : 'Read'} ${list(files)} with ${lang}`;
    return `Run an inline ${lang} script`;
  }
  if (wrote) return `Write ${base(wrote)}`;
  return `Run ${name}`;
}

function describeGit(args: string[]): string {
  const a = [...args];
  // `git -C dir status`: the options that take a value are not the subcommand.
  for (let i = 0; i < a.length; i++) if (a[i] === '-C' || a[i] === '-c') a.splice(i, 2);
  const sub = a.find((w) => !w.startsWith('-')) || '';
  const operands = a.slice(a.indexOf(sub) + 1).filter((w) => !w.startsWith('-'));
  const flag = (f: string) => a.includes(f);
  const m = a.findIndex((w) => w === '-m' || w === '--message');
  switch (sub) {
    case 'commit': return m >= 0 && a[m + 1] ? `Commit: ${clip(a[m + 1].split('\n')[0], 50)}` : 'Commit changes';
    case 'add': return operands.length && !operands.every((o) => o === '.' || o === '-A') ? `Stage ${list(operands)}` : 'Stage changes';
    case 'checkout': case 'switch': return flag('-b') || flag('-c') || flag('-B') ? `Create branch ${operands[0] || ''}`.trim() : operands[0] ? `Switch to ${clip(operands[0], 40)}` : 'Switch branch';
    case 'push': return 'Push to GitHub';
    case 'pull': return 'Pull from GitHub';
    case 'fetch': return 'Fetch from GitHub';
    case 'status': return 'Check git status';
    case 'diff': return operands.length ? `Show changes in ${list(operands)}` : 'Show changes';
    case 'log': return 'Show git history';
    case 'show': return 'Show a commit';
    case 'branch': return operands[0] && (flag('-d') || flag('-D')) ? `Delete branch ${operands[0]}` : 'Work with branches';
    case 'merge': return operands[0] ? `Merge ${operands[0]}` : 'Merge a branch';
    case 'rebase': return operands[0] ? `Rebase onto ${operands[0]}` : 'Rebase the branch';
    case 'reset': return 'Reset git state';
    case 'stash': return 'Stash changes';
    case 'clone': return 'Clone a repository';
    case 'restore': return operands.length ? `Restore ${list(operands)}` : 'Restore files';
    case 'worktree': return 'Manage worktrees';
    default: return `Run git ${sub}`.trim();
  }
}
