## 2026-10-28 · Removing a repository can delete the local clone

The remove dialog offers "Also delete the local directories", off by default. It deletes the clone and any linked worktrees of it, never anything on GitHub. When ticked, the dialog warns about untracked files, uncommitted changes and commits that are on no remote, and requires typing the repository name to confirm. Plain removal (stop tracking only) still needs no typing. Repositories with sessions still cannot be removed, so session worktrees are never swept up.
