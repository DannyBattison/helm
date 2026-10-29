# helm

[![CI](https://github.com/DannyBattison/helm/actions/workflows/ci.yml/badge.svg)](https://github.com/DannyBattison/helm/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/DannyBattison/helm/graph/badge.svg?token=XHW1TVGY1K)](https://codecov.io/gh/DannyBattison/helm)
[![Latest release](https://img.shields.io/github/v/release/DannyBattison/helm?label=release)](https://github.com/DannyBattison/helm/releases/latest)
[![Release date](https://img.shields.io/github/release-date/DannyBattison/helm?label=released)](https://github.com/DannyBattison/helm/releases/latest)
[![Buy me a coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-%E2%98%95-yellow)](https://buymeacoffee.com/dannybattison)

Supervise many coding-agent sessions (Claude Code, and Codex) across many GitHub repositories, from one window. Available as a desktop app, in your browser, and as a phone app.

**Website and downloads: [takethehelm.dev](https://takethehelm.dev)**

## Features

- **Isolated sessions.** Each session works in its own git worktree on an `agent/<name>` branch. Your checkout is never touched. helm pushes the branch after every commit (you can turn that off).
- **Claude and Codex.** Pick the agent per session. A session can also have extra read-only agents that give a second opinion, while one owner makes the changes.
- **One place for everything.** Approve commands, answer questions, and watch plan usage or cost budgets across all agents. Sessions show as a list or a kanban board.
- **Inbox.** Everything waiting on you, cleared from the keyboard or from the tray menu.
- **Review.** Diffs with hunk-level accept/ask/reject, a read-only review by an agent, and a forecast of which sessions would conflict. Open pull requests, see their checks, and merge (or queue a merge for when checks pass).
- **Checkpoints.** Restore a worktree or fork a session from any of your messages. Compare runs of one task and keep the best.
- **Code and terminal.** Browse and edit code (Monaco) in a session or your own checkout, with a tabbed terminal that starts where you are.
- **Subagents, queues and free agents.** Subagent trees, per-session limits, queued sessions, GitHub issues as sessions, and agents not tied to a repository.
- **Automated agents.** Saved prompts that start sessions on a schedule or when a pull request or issue appears on GitHub.
- **Attachments and artifacts.** Give a new session files of any type, and keep what agents produce as artifacts, optionally uploaded to the repository.
- **MCP servers.** Configure them globally or per repository.
- **Reports.** Spend, throughput, approvals, an audit log and CSV export. Works with a subscription or API tokens.
- **Search.** ⌘K across sessions, conversations, commits and code. Keyboard shortcuts can be changed in Settings.
- **Several machines.** Sync history between helm instances, or export and import it as a file.
- **Phone app.** Reach a hosted server by URL, or your desktop directly over an encrypted peer-to-peer link (Settings → Phone app on the desktop gives a code to scan). See [mobile/README.md](mobile/README.md).

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
npm ci
npm run dev          # desktop app with hot reload
npm run build        # production bundles
npm run dist         # desktop installers
npm test             # tests
npm run typecheck    # run this with the tests; they don't typecheck
npm run hosted:build # browser version
npm run mobile:sync  # phone app (see mobile/README.md)
```

Needs Node 22+, git, and a Claude login (or `ANTHROPIC_API_KEY`); Codex needs the `codex` CLI. Layout: `src/core` (the app's logic, no Electron), `src/shared` (code used by every front end), `src/renderer` (React UI, shared), `desktop/` (Electron), `hosted/` (browser version and Docker image), `mobile/` (Capacitor phone app). Releases are built by the `release` GitHub workflow. Decisions are logged one file each in [decisions/](decisions/).

## Support

If helm is useful to you, you can [buy me a coffee](https://buymeacoffee.com/dannybattison).
