# helm

A desktop app for supervising many Claude Code sessions across many GitHub repositories at once.

- Sign in with GitHub, add repositories (clone from your account, from a URL, or register an existing clone), and start sessions.
- Every session runs in its own git worktree on an `agent/<name>` branch. Your checkout is never touched.
- One window for what every agent is doing: approve commands, answer questions, watch plan usage or cost budgets, browse and edit code (Monaco) in a session or in your own checkout, review diffs, open pull requests, browse history.
- Local Claude Code sessions started elsewhere (VS Code, the CLI) show up read-only in the sidebar, the Overview and each repository's Claude sessions tab.
- Code is syntax-highlighted everywhere it appears, with a language only when helm is confident; fonts for the interface, data and code are configurable.
- Subagents show as a tree under their session, each with its own transcript, and are limited per session and per repository.
- Works for subscriptions (shows your Claude plan usage, with optional percentage limits) and for API tokens (dollar budgets, in your currency).

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

Requires Node 22+, git on PATH, and a Claude login. If the terminal reports that `conpty.node` is missing, run `npm rebuild @homebridge/node-pty-prebuilt-multiarch`. helm runs sessions with the Claude Agent SDK, which uses the credentials from your Claude Code login or `ANTHROPIC_API_KEY`. The SDK ships its own Claude Code binary; set a CLI path in Settings to use yours instead.

## GitHub sign-in

helm signs in with GitHub's OAuth device flow, using a registered OAuth app whose public client ID is built in (`src/main/store.ts`). Click Continue with GitHub, enter the code in your browser, approve. To use your own OAuth app (device flow enabled, no secret needed), set `HELM_GITHUB_CLIENT_ID` or change it in Settings → Account.

You can also sign in with a personal access token (scopes `repo`, `read:org`, `workflow`). The token is stored encrypted with the OS keychain via Electron `safeStorage`.

## How it works

- `src/main`: the main process owns all state and persists it under the user data directory. `sessions.ts` drives the Agent SDK (`canUseTool` for approvals, interrupt, resume, budgets), `git.ts` and `repos.ts` use the git CLI, `github.ts` the GitHub API, `terminal.ts` node-pty.
- `src/preload`: a thin bridge. The renderer calls the typed `HelmApi` in `src/shared/types.ts`.
- `src/renderer`: React. `ui/` holds the design-system primitives, `views/` the screens, `styles/tokens/` the design tokens.

Worktrees are created at `~/.helm/worktrees/<repo>/<session>`; clones go to `~/code/<owner>/<name>`. Both are configurable.

## Not built yet

- Continuing a session that was started outside helm. The Claude sessions tab shows local ones read-only.

- Menu-bar or tray dropdown (the taskbar or dock badge shows how many sessions need you).
- Search across files and commits in the ⌘K palette (it searches sessions, repositories and actions).
- Code signing, auto-update and app icons.
