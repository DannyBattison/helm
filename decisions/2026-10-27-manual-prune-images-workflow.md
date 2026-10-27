## 2026-10-27 · Manual workflow to prune stale hosted images

`.github/workflows/prune-images.yml` is run by hand only (workflow_dispatch), defaulting to a dry run. It deletes untagged versions of `helm-hosted` and sha/branch tags older than a chosen number of days, and never touches `latest` or release-version tags (with or without `-full`). Reason: every push to main adds a `sha-` tag, so the registry grows without bound, but deleting must stay a deliberate act.
