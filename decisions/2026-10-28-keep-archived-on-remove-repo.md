## 2026-10-28 · Remove dialog can keep a repository's archived sessions

The remove-repository dialog offers "Keep its archived sessions". Kept sessions stay in the Archive as read-only history (their safe worktrees are freed first; unsafe ones are left alone), and can't be restored until the repository is added again. Without it, archived sessions are deleted with the repository, as before.
