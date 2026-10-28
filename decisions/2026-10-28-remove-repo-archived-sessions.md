## 2026-10-28 · Removing a repository deletes its archived sessions

Archived sessions are hidden from the left tree, so a repository that only had archived sessions could not be removed: the dialog said it still had sessions and nothing in the UI could delete them. Removing a repository now ignores archived sessions in that check and deletes them (and their worktrees, never their branches) along with it. Active sessions still block removal.
