## 2026-11-09 · Renaming a repository from helm follows it on GitHub and on disk

The repository's context menu has "Rename repository…". It renames on GitHub (PATCH /repos), then updates the origin URL, renames the clone folder and the worktree folder (`<worktreeRoot>/<name>`) when they carry the old name, runs `git worktree repair`, moves the Claude Code history filed under the old paths, and rekeys everything stored by `owner/name` (sessions, extras, totals, usage, daily, automation scope and seen, uploaded files, history cache). The old id is tombstoned so other machines drop it and pick up the new one when they sync.

It is refused, before anything changes, while any session in the repository (main or extra) is running or waiting on the user: the agent's working folder would move under it. Idle, ready and archived sessions are carried along. Name clashes with existing folders are also checked up front.

Why: the GitHub rename is the step that cannot be undone, so every local precondition is checked first. Once GitHub has the new name helm must follow it, so a failing local step becomes a warning rather than an abort that leaves helm pointing at a dead id.
