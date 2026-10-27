## 2026-10-27 · Release workflow is manual, with automatic version bumps

The release workflow now runs from `workflow_dispatch` and asks for a major or minor bump. The next version comes from the latest `v*` tag (first release is 0.1.0), is tagged by the workflow, and is applied to `package.json` in each build job (not committed). A final job rewrites the README's "Latest release" line on the default branch.
