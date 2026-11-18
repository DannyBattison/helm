## 2026-11-18 · The hosted image always includes git-lfs

`git-lfs` is in the always-installed package list of `hosted/Dockerfile`, and `git lfs install --system` registers its filters in the system gitconfig so every user, worktrees and clones included, gets them without a per-user setup. Without it, cloning a repository that uses LFS leaves pointer files in the checkout.

Why: user request. Always-on rather than an INCLUDE category because it is small and a repository's need for it isn't known ahead. Not tested with a real `docker build` (no Docker here).
