## 2026-10-26 · Themed confirm dialog for removing a worktree

Removing a worktree (project > Branches & worktrees) used the native `confirm()` popup. It now opens the app's own `Dialog` with a danger button, showing the branch note and the worktree path. Other `confirm()` uses (Settings sign-out) are unchanged.
