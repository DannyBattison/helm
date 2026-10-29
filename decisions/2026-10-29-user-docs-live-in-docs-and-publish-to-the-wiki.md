## 2026-10-29 · User docs live in docs/ and are published to the GitHub wiki

`docs/` holds a flat set of Markdown pages (one per view or feature) written for newcomers, developers and power users, with `docs/STYLE.md` as the writing guide. Pages link to each other as `Page-Name.md`, which works when browsing the folder; `.github/scripts/prepare-wiki.mjs` copies them for the wiki with the `.md` removed (leaving out `README.md` and `STYLE.md`) and fails on any broken page link or heading anchor. The `wiki` workflow runs it on pushes to `main` that touch `docs/` and by hand, then replaces the contents of the repository's wiki with the result using `GITHUB_TOKEN`. The wiki is therefore never edited directly. It needs a first page created in the GitHub UI once, since GitHub only creates the wiki repository then. `tests/docs.test.ts` runs the script, so broken links fail CI.

Why: user request. Flat files because a GitHub wiki has no folders; one source of truth so the wiki cannot drift.
