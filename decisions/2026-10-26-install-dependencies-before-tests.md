## 2026-10-26 · Run `npm ci` in a fresh worktree before testing

Fresh worktrees have no `node_modules`. Without it, `command.test.ts` (needs `highlight.js`) and the GitHub tests (need `yaml`) fail on import, and `tsc` is not found. These failures are not bugs; run `npm ci` first, after which the full suite passes. Agents should not report them as pre-existing failures.
