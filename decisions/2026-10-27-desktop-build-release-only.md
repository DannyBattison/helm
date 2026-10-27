## 2026-10-27 · Desktop installers come only from releases

The `desktop-build` workflow (unsigned installers on every push to main) is removed. `release.yml` already builds the macOS, Windows and Linux installers and attaches them to the GitHub release, so the per-push build only duplicated that cost on every merge. This supersedes "Desktop builds on every push to main". Old hosted images were pruned with the manual `prune-images` workflow.
