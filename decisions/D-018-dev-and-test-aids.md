## D-18 · 2026-10-23 · Dev and test aids
`HELM_DEV_SEED=1` keeps a seeded user and skips the startup status recovery, so a prepared user-data directory can be used for screenshots and manual checks. It has no effect on normal runs. Logic that doesn't need Electron has vitest tests in `tests/`.
Why: lets the UI be checked against a real git worktree without a GitHub account.
