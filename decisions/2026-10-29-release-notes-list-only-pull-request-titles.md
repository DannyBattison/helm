## 2026-10-29 · Release notes list only pull request titles

The release workflow asks GitHub to generate the notes, then strips ` by @user in <pull request link>` from each item, so the changelog shows just the pull request title. GitHub's own `--generate-notes` format cannot be changed by a `.github/release.yml` template, hence the post-processing. The "New Contributors" lines (`@x made their first contribution in …`) are left as GitHub writes them. Not run: the next release shows it.
