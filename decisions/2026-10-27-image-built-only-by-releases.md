## 2026-10-27 · The hosted image is built only by the release workflow

Pushes to `main` no longer build or publish the hosted image (so no `:main` or `:sha-<commit>` tags). Releases call `hosted-image.yml`, and it can still be run by hand from the Actions tab to publish a branch for testing. This supersedes the `:main`/`:sha-` tags mentioned in `2026-10-27-latest-follows-releases.md`.
