## D-57 · 2026-10-23 · Commit author and push-on-commit are prompt-level settings
`commitAuthor` is `coauthor` (user authors, `Co-authored-by: helm session` trailer) or `sole` (the agent's Bash gets `GIT_AUTHOR_NAME/EMAIL` for Claude and a non-attributing `Helm-Session:` trailer). `pushOnCommit` replaces the "do not push" instruction with "push after every commit". Both apply when a session next starts. The history view recognises either trailer.
Why: helm cannot hook the agent's own `git commit`, so the system prompt and environment are the only levers.
