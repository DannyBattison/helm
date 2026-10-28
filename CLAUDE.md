# helm

- Log every decision as its own file, `decisions/YYYY-MM-DD-short-slug.md`, first line `## YYYY-MM-DD · Title` (see `decisions/README.md`). Append-only; never edit old entries. Don't add numbered `D-NNN` entries or recreate `DECISIONS.md`.
- Decision files never conflict, so no renumbering after merges. `tests/decisions.test.ts` checks the file names and headings.
- Commit as you go.
- Fresh worktrees have no `node_modules`: run `npm ci` before tests or `tsc`. Missing-package failures (`highlight.js`, `yaml`) in `command`/`github-*` tests just mean this wasn't done.
- Always run `npm run typecheck` together with the tests (`npx vitest run`); tests don't typecheck. Install with `npm ci --include=dev` (and in `hosted/`) in case `NODE_ENV=production` is set, otherwise `@types/node`/`ws` are missing.
