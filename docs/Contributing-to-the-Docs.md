# Contributing to the docs

These pages live in the `docs/` folder of the helm repository and are published automatically to this wiki.

> **In short**
> - Edit the Markdown files in `docs/` and open a pull request. Do not edit the wiki directly: the next publish overwrites it.
> - Follow the style guide in `docs/STYLE.md`.
> - Merging to `main` publishes the wiki.

## Writing a page

1. Add or edit `docs/Page-Name.md` (flat folder, Title-Case-With-Hyphens).
2. Link to other pages as `[Text](Other-Page.md)`, and to a heading as `[Text](Other-Page.md#heading-slug)`. The publish step turns these into wiki links.
3. Add new pages to `docs/_Sidebar.md` and the list in `docs/Home.md`.
4. Run the tests. One of them checks that every link and heading anchor in `docs/` resolves.

Describe what is in the app, using the words on its buttons. If a feature changes, update its page in the same pull request.

## How publishing works

The `wiki` workflow (`.github/workflows/wiki.yml`) runs on every push to `main` that touches `docs/`, and by hand from the **Actions** tab. It runs `.github/scripts/prepare-wiki.mjs`, which checks the links, copies the pages, rewrites `.md` links for the wiki and leaves out `README.md` and `STYLE.md`. Then it pushes to the repository's wiki.

**One-time setup:** GitHub only creates a wiki's git repository when its first page exists. In the repository's **Settings**, make sure **Wikis** is on, open the **Wiki** tab and create any page (it will be overwritten). Then run the workflow.
