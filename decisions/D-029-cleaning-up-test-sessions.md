## D-29 · 2026-10-23 · Cleaning up test sessions
Testing with real sessions creates worktrees under `~/.helm/worktrees` and project folders in `~/.claude/projects`. These were removed after testing. The same applies to any session you delete in helm: the worktree goes, but Claude Code's own session history under `~/.claude` stays, as it does for any Claude Code session.
Why: avoid leaving test clutter in the user's Claude history.
