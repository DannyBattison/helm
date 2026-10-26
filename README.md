# helm

[![CI](https://github.com/DannyBattison/helm/actions/workflows/ci.yml/badge.svg)](https://github.com/DannyBattison/helm/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/DannyBattison/helm/branch/main/graph/badge.svg)](https://codecov.io/gh/DannyBattison/helm)
[![Buy me a coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-%E2%98%95-yellow)](https://buymeacoffee.com/dannybattison)

Supervise many Claude Code sessions across many GitHub repositories, from one window. Available as a desktop app or in your browser.

**Website and downloads: [takethehelm.dev](https://takethehelm.dev)**

## Features

- **Isolated sessions.** Each session works in its own git worktree on an `agent/<name>` branch. Your checkout is never touched.
- **One place for everything.** Approve commands, answer questions, and watch plan usage or cost budgets across all agents.
- **Inbox.** Everything waiting on you, cleared from the keyboard or from the tray menu.
- **Review.** Diffs with hunk-level accept/ask/reject, a read-only review by Claude, and a forecast of which sessions would conflict. Open and merge pull requests.
- **Checkpoints.** Restore a worktree or fork a session from any of your messages. Compare runs of one task and keep the best.
- **Code and terminal.** Browse and edit code (Monaco) in a session or your own checkout.
- **Subagents, queues and free agents.** Subagent trees, per-session limits, queued sessions, GitHub issues as sessions, and agents not tied to a repository.
- **Reports.** Spend, throughput, approvals, an audit log and CSV export. Works with a Claude subscription or API tokens.
- **Search.** ⌘K across sessions, conversations, commits and code.

## Hosted version

Run helm on a server and use it from a browser:

```
docker run -d --name helm -p 127.0.0.1:8787:8787 \
  -v helm-home:/home/helm \
  -e HELM_HOSTED_ALLOWED_USER=your-github-username \
  -e HELM_HOSTED_SECRET=$(openssl rand -hex 32) \
  ghcr.io/dannybattison/helm-hosted:latest
```

Open <http://127.0.0.1:8787>, sign in with GitHub, then sign in to Claude when asked.

- `HELM_HOSTED_ALLOWED_USER` (required): the one GitHub user allowed in. That person can run commands in the container.
- `HELM_HOSTED_SECRET`: signs the login cookie. Keep it fixed or you are signed out on every restart.
- `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (optional): use a key or token instead of signing in to Claude in the app.
- `HELM_GIT_NAME`, `HELM_GIT_EMAIL` (optional): who agent commits are made as.
- The `helm-home` volume holds all state, clones and logins.

Put TLS in front before exposing it beyond your own machine. If the image is private, make the package public on GitHub or `docker login ghcr.io`. More in [hosted/README.md](hosted/README.md).

## Develop

```
npm install
npm run dev        # desktop app with hot reload
npm run build      # production bundles
npm run dist       # installers
npm test           # tests
npm run typecheck
```

Needs Node 22+, git, and a Claude login (or `ANTHROPIC_API_KEY`). Layout: `src/core` (the app's logic, no Electron), `src/renderer` (React UI, shared), `desktop/` (Electron), `hosted/` (browser version). Decisions are logged in [decisions/](decisions/).

## Support

If helm is useful to you, you can [buy me a coffee](https://buymeacoffee.com/dannybattison).
