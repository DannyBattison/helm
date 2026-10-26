## D-140 · 2026-10-26 · The merge dialog lists the pull request's checks, each a link to GitHub
Under "Its checks are still running" (or failing) the merge dialog now lists every check run with its state (Running, Passed, Failed, Skipped); clicking one opens its page on GitHub. `PullRequest` gains `checkRuns` (name, state, URL), filled from the same check-runs request that already gave the summary, for open pull requests only. Older commit statuses (not check runs) are still not shown. Not run in the app; `tsc` is not installed in the worktree.
Why: user request.
