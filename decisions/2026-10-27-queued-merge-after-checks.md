## 2026-10-27 · Queue a merge until the checks pass

A helm session's open pull request can be merged now, or queued: helm merges it itself once the pull request's checks (GitHub Actions and other check runs) have passed. A pull request with no checks is merged after two minutes, so it is not waited on for ever. Queuing is only for pull requests a session opened, because the queue lives on the session.

While the merge is queued the session is not archived, so it stays in the sidebar (with a merge icon) until the merge completes; after that the usual after-merge setting applies. If the checks fail, the pull request is closed or a draft, or GitHub refuses the merge, the session records the reason, notifies, and appears in the inbox as "Merge failed" with retry (`r`) and cancel (`x`). Merging directly (no pull request) has no checks to wait for, so it cannot be queued.
