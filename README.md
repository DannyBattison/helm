# helm

A desktop app for supervising many Claude Code sessions across many GitHub repositories at once.

- Sign in with GitHub, add repositories (clone from your account, from a URL, or register an existing clone), and start sessions.
- Every session runs in its own git worktree on an `agent/<name>` branch. Your checkout is never touched.
- One window for what every agent is doing: approve commands, answer questions, watch token and cost budgets, read and lightly edit code (Monaco), review diffs, open pull requests, browse history.

Design reference: `design_handoff_helm_desktop/` (not tracked in git). Decisions and deviations are logged in [DECISIONS.md](DECISIONS.md).

## Run

```
npm install
npm run dev        # development with hot reload
npm run build      # production bundles into out/
npm run pack       # unpacked app in release/ (npm run dist for an installer)
npm test           # logic tests
npm run typecheck
```

Requires Node 22+, git on PATH, and a Claude login. helm runs sessions with the Claude Agent SDK, which uses the credentials from your Claude Code login or `ANTHROPIC_API_KEY`. The SDK ships its own Claude Code binary; set a CLI path in Settings to use yours instead.

## GitHub sign-in

helm uses GitHub's OAuth device flow. A GitHub OAuth app has to exist for that, and only you can create it:

1. github.com/settings/developers → New OAuth App, tick "Enable Device Flow".
2. Paste its client ID on the sign-in screen (or set `HELM_GITHUB_CLIENT_ID`). No client secret is needed.

Alternatively, sign in with a personal access token (scopes `repo`, `read:org`, `workflow`). The token is stored encrypted with the OS keychain via Electron `safeStorage`.

## How it works

- `src/main`: the main process owns all state and persists it under the user data directory. `sessions.ts` drives the Agent SDK (`canUseTool` for approvals, interrupt, resume, budgets), `git.ts` and `repos.ts` use the git CLI, `github.ts` the GitHub API, `terminal.ts` node-pty.
- `src/preload`: a thin bridge. The renderer calls the typed `HelmApi` in `src/shared/types.ts`.
- `src/renderer`: React. `ui/` holds the design-system primitives, `views/` the screens, `styles/tokens/` the design tokens.

Worktrees are created at `~/.helm/worktrees/<repo>/<session>`; clones go to `~/code/<owner>/<name>`. Both are configurable.

## Not built yet

- Menu-bar or tray dropdown (the taskbar or dock badge shows how many sessions need you).
- Search across files and commits in the ⌘K palette (it searches sessions, repositories and actions).
- Code signing, auto-update and app icons.
