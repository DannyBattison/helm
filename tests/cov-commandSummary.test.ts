import { describe, expect, it } from 'vitest';
import { commandSteps, commandSummary } from '../src/shared/commandSummary';

describe('commandSummary coverage', () => {
  it('ignores a non-string or blank description', () => {
    expect(commandSummary('git status', 42)).toBe('Check git status');
    expect(commandSummary('git status', '   ')).toBe('Check git status');
  });

  it('reads quoting, escapes and redirections', () => {
    expect(commandSummary('echo "a && b" ; ls')).toBe('Print text, List files');
    expect(commandSummary('echo "say \\"hi\\" | x"')).toBe('Print text');
    expect(commandSummary("echo 'a;b'")).toBe('Print text');
    expect(commandSummary(String.raw`echo a\;b`)).toBe('Print text');
    expect(commandSummary('echo hi > out/notes.txt')).toBe('Write notes.txt');
    expect(commandSummary('echo hi >> log.txt 2>&1')).toBe('Write log.txt');
    expect(commandSummary('echo hi > /dev/null')).toBe('Print text');
    expect(commandSummary('echo hi 2> err.txt')).toBe('Print text');
    expect(commandSummary('echo hi >&2')).toBe('Print text');
    expect(commandSummary('> out.txt')).toBe('Write out.txt');
    expect(commandSummary('')).toBe('Run a command');
    expect(commandSummary('mycmd --x > res.json')).toBe('Write res.json');
    expect(commandSummary('cat < in.txt')).toBe('Read a file');
    expect(commandSummary('cat a.txt > b.txt')).toBe('Write b.txt');
  });

  it('skips env assignments and sudo-like prefixes', () => {
    expect(commandSummary('sudo rm -rf build')).toBe('Delete build');
    expect(commandSummary('FOO=1 BAR=2 ls src')).toBe('List src');
    expect(commandSummary('time nohup make test')).toBe('Run make test');
  });

  it('describes package manager variants', () => {
    expect(commandSummary('yarn add left-pad')).toBe('Install dependencies');
    expect(commandSummary('npm test')).toBe('Run the tests');
    expect(commandSummary('npm run')).toBe('Run the package script');
    expect(commandSummary('npm exec foo')).toBe('Run the foo script');
    expect(commandSummary('pnpm lint')).toBe('Run lint');
    expect(commandSummary('npm publish')).toBe('Run npm publish');
    expect(commandSummary('npm')).toBe('Run npm');
    expect(commandSummary('npx')).toBe('Run npx');
    expect(commandSummary('npx -y prettier --write .')).toBe('Run prettier');
    expect(commandSummary('pnpm dlx vitest run')).toBe('Run pnpm dlx');
    expect(commandSummary('go test ./...')).toBe('Run the tests');
    expect(commandSummary('cargo test')).toBe('Run the tests');
    expect(commandSummary('pytest -x')).toBe('Run the tests');
    expect(commandSummary('eslint .')).toBe('Run eslint');
    expect(commandSummary('tsc --noEmit')).toBe('Run tsc');
  });

  it('describes every git subcommand', () => {
    const g = (c: string) => commandSummary('git ' + c);
    expect(g('commit -m "fix: a thing\n\nbody"')).toBe('Commit: fix: a thing');
    expect(g('commit --amend')).toBe('Commit changes');
    expect(g('add .')).toBe('Stage changes');
    expect(g('add -A')).toBe('Stage changes');
    expect(g('add')).toBe('Stage changes');
    expect(g('add a.ts src/b.ts')).toBe('Stage a.ts, b.ts');
    expect(g('checkout -b feat/x')).toBe('Create branch feat/x');
    // Known quirk: `-c` is also git's config option, so `switch -c name` loses its flag and name.
    expect(g('switch -c feat')).toBe('Switch branch');
    expect(g('switch -C feat')).toBe('Switch branch');
    expect(g('checkout main')).toBe('Switch to main');
    expect(g('checkout')).toBe('Switch branch');
    expect(g('pull')).toBe('Pull from GitHub');
    expect(g('fetch --all')).toBe('Fetch from GitHub');
    expect(g('diff')).toBe('Show changes');
    expect(g('diff -- a.ts')).toBe('Show changes in a.ts');
    expect(g('log --oneline')).toBe('Show git history');
    expect(g('show HEAD')).toBe('Show a commit');
    expect(g('branch -D old')).toBe('Delete branch old');
    expect(g('branch')).toBe('Work with branches');
    expect(g('merge dev')).toBe('Merge dev');
    expect(g('merge')).toBe('Merge a branch');
    expect(g('rebase main')).toBe('Rebase onto main');
    expect(g('rebase')).toBe('Rebase the branch');
    expect(g('reset --hard')).toBe('Reset git state');
    expect(g('stash pop')).toBe('Stash changes');
    expect(g('clone x')).toBe('Clone a repository');
    expect(g('restore a.ts')).toBe('Restore a.ts');
    expect(g('restore')).toBe('Restore files');
    expect(g('worktree add x')).toBe('Manage worktrees');
    expect(g('bisect')).toBe('Run git bisect');
    expect(commandSummary('git')).toBe('Run git');
    expect(g('-c user.name=x status')).toBe('Check git status');
    // Known quirk: two value options in a row, the second is not skipped.
    expect(g('-c user.name=x -C dir status')).toBe('Run git dir');
  });

  it('describes searches', () => {
    expect(commandSummary('grep -rn foo src lib')).toBe('Search for "foo" in src, lib');
    expect(commandSummary('rg -e foo -e bar .')).toBe('Search for "foo"');
    expect(commandSummary('rg -l TODO src/a src/b src/c')).toBe('Find files containing "TODO" in a, b +1');
    expect(commandSummary('grep')).toBe('Search for ""');
    expect(commandSummary('grep x $DIR')).toBe('Search for "x"');
    expect(commandSummary('rg --glob "*.ts" pat')).toBe('Search for "pat"');
    expect(commandSummary('find . -name "*.ts"')).toBe('Find files named *.ts');
    expect(commandSummary('find src -type f')).toBe('Find files');
    expect(commandSummary('fd config')).toBe('Find files named config');
    expect(commandSummary('fd')).toBe('Find files');
    expect(commandSummary('grep ' + 'x'.repeat(50) + ' f')).toContain('…');
  });

  it('describes file utilities', () => {
    expect(commandSummary('ls')).toBe('List files');
    expect(commandSummary('tree -L 2 src')).toBe('List 2, src');
    expect(commandSummary('head -n 5 a.txt')).toBe('Read a.txt');
    expect(commandSummary('tail -f')).toBe('Read a file');
    expect(commandSummary('sed -i s/a/b/ f.txt')).toBe('Edit f.txt');
    expect(commandSummary('sed -n 1,5p f.txt')).toBe('Read f.txt through sed');
    expect(commandSummary('sed s/a/b/')).toBe('Transform text');
    expect(commandSummary('perl -pi -e s/a/b/ f.txt')).toBe('Transform text');
    expect(commandSummary('wc -l a b')).toBe('Count lines in a, b');
    expect(commandSummary('wc')).toBe('Count lines');
    expect(commandSummary('diff a b')).toBe('Compare a, b');
    expect(commandSummary('diff a')).toBe('Compare files');
    expect(commandSummary('mkdir -p a/b')).toBe('Create folder b');
    expect(commandSummary('mkdir')).toBe('Create a folder');
    expect(commandSummary('rm')).toBe('Delete files');
    expect(commandSummary('mv a b')).toBe('Move a');
    expect(commandSummary('mv')).toBe('Move files');
    expect(commandSummary('cp a b')).toBe('Copy a');
    expect(commandSummary('cp')).toBe('Copy files');
    expect(commandSummary('touch a.txt')).toBe('Create a.txt');
    expect(commandSummary('touch')).toBe('Create a file');
    expect(commandSummary('chmod +x run.sh')).toBe('Change permissions on run.sh');
    expect(commandSummary('chmod')).toBe('Change permissions');
    expect(commandSummary('tee out.log')).toBe('Write out.log');
    expect(commandSummary('tee')).toBe('Write a file');
    expect(commandSummary('sleep 5')).toBe('Wait 5');
    expect(commandSummary('sleep')).toBe('Wait');
    expect(commandSummary('kill -9 12')).toBe('Stop a process');
    expect(commandSummary('pkill node')).toBe('Stop a process');
  });

  it('describes network, build and tool commands', () => {
    expect(commandSummary('curl -X POST https://api.x.com/v1')).toBe('Request api.x.com');
    expect(commandSummary('curl localhost')).toBe('Make a web request');
    expect(commandSummary('wget https://a.org/f')).toBe('Download from a.org');
    expect(commandSummary('wget f')).toBe('Download a file');
    expect(commandSummary('make')).toBe('Run make');
    expect(commandSummary('make -j4')).toBe('Run make');
    expect(commandSummary('make build')).toBe('Run make build');
    expect(commandSummary('docker compose up')).toBe('Run docker compose');
    expect(commandSummary('docker')).toBe('Run docker');
    expect(commandSummary('gh pr view 3')).toBe('GitHub: pr view');
    expect(commandSummary('gh')).toBe('Use the GitHub CLI');
    expect(commandSummary('terraform apply')).toBe('Run terraform');
  });

  it('describes interpreters and inline scripts', () => {
    expect(commandSummary('python -m pytest')).toBe('Run the tests');
    expect(commandSummary('python3 -m http.server')).toBe('Run python -m http.server');
    expect(commandSummary('python -m')).toBe('Run python -m');
    expect(commandSummary('node build.js')).toBe('Run build.js');
    expect(commandSummary('node --check')).toBe('Run node');
    expect(commandSummary('python3.11 scripts/run.py')).toBe('Run run.py');
    expect(commandSummary(`python -c "print(open('a.txt').read())"`)).toBe('Read a.txt with Python');
    expect(commandSummary(`python -c "open('a.txt','w').write('x')"`)).toBe('Edit a.txt with Python');
    expect(commandSummary(`node -e "require('fs').writeFileSync('x.json', '1')"`)).toBe('Edit x.json with Node');
    expect(commandSummary(`ruby -e "puts 1"`)).toBe('Run an inline Ruby script');
    expect(commandSummary(`node -p`)).toBe('Run an inline Node script');
    expect(commandSummary('bun install')).toBe('Install dependencies');
    expect(commandSummary('bun build.ts')).toBe('Run bun build.ts');
  });

  it('reads heredoc bodies as the script for an interpreter on stdin', () => {
    expect(commandSummary("python3 - <<'EOF'\nprint(open('cfg.yml').read())\nEOF")).toBe('Read cfg.yml with Python');
    expect(commandSummary('node <<-EOS\n\tfs.writeFileSync("o.txt","x")\nEOS')).toBe('Edit o.txt with Node');
    expect(commandSummary('cat <<EOF > notes.md\nhello\nEOF')).toBe('Write notes.md');
    // A herestring is not a heredoc.
    expect(commandSummary('cat <<< "hi"')).toBe('Read hi');
    // An unterminated heredoc swallows the rest.
    expect(commandSummary('cat <<EOF\nrm -rf /\n')).toBe('Read a file');
  });

  it('filters list scripts and plumbing down to meaningful steps', () => {
    expect(commandSummary('for f in a b c; do echo $f; done')).toBe('Loop over a b c, Print text');
    expect(commandSummary('while :; do :; done')).toBe('Run a command');
    expect(commandSummary('for x in ' + 'y '.repeat(40) + '; do true; done')).toContain('Loop over');
    expect(commandSummary('if [ -f a ]; then rm a; fi')).toBe('Delete a');
    expect(commandSummary('[[ -f a ]] && echo yes || echo no')).toBe('Print text');
    expect(commandSummary('test -f a')).toBe('Run a command');
    expect(commandSummary('while ! curl -s https://h.io; do sleep 1; done')).toBe('Request h.io, Wait 1');
    expect(commandSummary('{ ls; }')).toBe('List files');
    expect(commandSummary('cd x && set -e && true')).toBe('Run cd');
    expect(commandSummary('ls | grep foo')).toBe('List files');
    expect(commandSummary('cd')).toBe('Run cd');
  });

  it('collapses repeats and reports every step', () => {
    expect(commandSteps('ls; ls; git status')).toEqual(['List files', 'Check git status']);
    expect(commandSummary('ls a; git status; rm b; mkdir c; touch d')).toBe('List a, Check git status, Delete b and 2 more');
    expect(commandSteps('ls a; git status; rm b; mkdir c')).toHaveLength(4);
  });
});
