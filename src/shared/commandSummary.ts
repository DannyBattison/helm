/**
 * A few words saying what a shell command does, for the header over a command preview. The agent's own description of the
 * command (the Bash tool takes one) is used when it gave one; otherwise this reads the command itself and names the common
 * ones, and for the rest says "Run" and the program.
 */
export function commandSummary(cmd: string, description?: unknown): string {
  const given = typeof description === 'string' ? description.trim().replace(/\s+/g, ' ') : '';
  if (given) return given.length > 90 ? given.slice(0, 89) + '…' : given;
  // Look at the first real command: past `cd dir &&`, env assignments and sudo.
  const parts = cmd.trim().split(/\s*(?:&&|\|\||;|\n)\s*/).filter((p) => p && !/^cd(\s|$)/.test(p) && !/^(set|export)\s/.test(p));
  const words = (parts[0] || cmd).trim().split(/\s+/).filter((w) => !/^[A-Z_][A-Z0-9_]*=/.test(w) && w !== 'sudo' && w !== 'time');
  // `git -C dir status`: the options that take a value are not the subcommand.
  for (let i = 1; i < words.length; i++) if (['-C', '-c'].includes(words[i]) && words[0].endsWith('git')) words.splice(i, 2);
  const [prog = '', a = '', b = ''] = words;
  const sub = [a, b].filter((w) => !w.startsWith('-'))[0] || '';
  const more = parts.length > 1 ? ' and more' : '';
  const name = prog.replace(/^.*\//, '');
  const pm = ['npm', 'pnpm', 'yarn', 'bun'].includes(name);
  if (name === 'git') {
    const map: Record<string, string> = { push: 'Push to GitHub', pull: 'Pull from GitHub', fetch: 'Fetch from GitHub', commit: 'Commit changes', add: 'Stage changes', status: 'Check git status', diff: 'Show changes', log: 'Show git history', checkout: 'Switch branch', switch: 'Switch branch', branch: 'Work with branches', merge: 'Merge a branch', rebase: 'Rebase the branch', reset: 'Reset git state', stash: 'Stash changes', clone: 'Clone a repository', restore: 'Restore files', show: 'Show a commit' };
    return (map[sub] || `Run git ${sub}`.trim()) + more;
  }
  if (pm) {
    if (['install', 'i', 'ci', 'add'].includes(sub)) return 'Install dependencies' + more;
    if (sub === 'test' || (sub === 'run' && /^test/.test(words.find((w, i) => i >= 2 && !w.startsWith('-')) || ''))) return 'Run the tests' + more;
    if (sub === 'run' || sub === 'exec') return `Run the ${words.find((w, i) => i >= 2 && !w.startsWith('-')) || 'package'} script` + more;
    if (['build', 'start', 'dev', 'lint', 'typecheck'].includes(sub)) return `Run ${sub}` + more;
  }
  if (['vitest', 'jest', 'pytest', 'mocha'].includes(name) || (name === 'go' && sub === 'test') || (name === 'cargo' && sub === 'test')) return 'Run the tests' + more;
  if (['tsc', 'eslint', 'prettier'].includes(name)) return `Run ${name}` + more;
  const plain: Record<string, string> = { ls: 'List files', cat: 'Read a file', head: 'Read a file', tail: 'Read a file', grep: 'Search files', rg: 'Search files', find: 'Find files', mkdir: 'Create a folder', rm: 'Delete files', mv: 'Move files', cp: 'Copy files', touch: 'Create a file', sed: 'Edit text', curl: 'Make a web request', wget: 'Download a file', chmod: 'Change permissions', echo: 'Print text', node: 'Run a Node script', python: 'Run a Python script', python3: 'Run a Python script', gh: 'Use the GitHub CLI', docker: 'Run docker', make: 'Run make' };
  return (plain[name] || (name ? `Run ${name}` : 'Run a command')) + more;
}
