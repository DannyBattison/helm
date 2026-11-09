## 2026-11-09 · Sidebar groups repositories by organisation; settings search covers every setting

The "Show organisation in the sidebar" setting (`showOwner`) is gone. Instead, when the repositories in the sidebar belong to more than one organisation, each organisation is a level of its own above its repositories; with a single organisation the tree stays flat and repositories show just their name. Free agents stay at the top level.

Settings search now matches the title and description of every setting row (read from the source of `Settings.tsx` and `RepoSettings.tsx` by `settingsIndex`), not only page names and a few keywords, so searching for any setting finds its page.

Why: a prefix on every name cost width and repeated the same org; grouping removes the repetition and only appears when it carries information.
