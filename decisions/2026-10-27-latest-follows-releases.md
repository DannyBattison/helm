## 2026-10-27 · `latest` follows releases, for the GitHub release and the Docker image

The release workflow marks its GitHub release as latest and calls the hosted-image workflow with the new version, which publishes `:X.Y.Z`, `:X.Y` and `:latest` (plus `-full` variants). Tags pushed with `GITHUB_TOKEN` don't trigger other workflows, so the image build is called directly rather than triggered by the tag. Pushes to `main` now publish `:main` and `:sha-<commit>` only, so `:latest` no longer moves with unreleased code.
