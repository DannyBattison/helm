## 2026-10-27 · Builds provide artifacts, release publishes

`desktop.yml` and `hosted-image.yml` only build: the installers are uploaded as workflow artifacts, and the images are pushed by digest with no tags (the digests are the artifacts). `release.yml` runs both in parallel and, only when both succeed, tags the commit, creates the GitHub release with the installers attached, and tags the image digests `:X.Y.Z`, `:X.Y` and `:latest` (plus `-full`). Before, the tag was pushed first, so a failed build left a stray tag and image tags. Pushing by digest was chosen over OCI tarball artifacts: no multi-GB artifacts and multi-arch works unchanged. Signing is dropped; installers are unsigned. Run by hand, `desktop` gives installers for any branch and `hosted-image` tags the branch name.

The account is on the free plan, with a small artifact storage quota, so installer artifacts are kept for 1 day when a release builds them (they are on the release by then) and 3 days for manual runs; digest artifacts for 1 day.

Tests and typecheck live only in `ci.yml` (two parallel jobs), which `release.yml` also calls, and publishing waits on it. The installer builds don't run them: the suite assumes Linux (line endings, file modes) and fails on Windows. Sharding the tests was not worth it: the whole `ci` run is about a minute, mostly install.
