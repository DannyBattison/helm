# Style guide for the helm wiki

Read this before writing or editing a page. It applies to every file in `docs/`.

## Who we write for

Three kinds of reader, and every page should work for all of them:

- **Casual vibe coders**: don't know git. Never assume they know "worktree", "diff", "rebase", "PR". Explain the first time, in one plain sentence, or link to [Glossary](Glossary.md).
- **Developers**: want to know what touches their checkout and how to stay in control. They skim, so lead with the answer.
- **Power users**: run many sessions and several agents. They want the shortcuts, limits, queues and automation details.

## Page shape

1. `# Title` (matches the file name, with spaces for hyphens).
2. One or two sentences: what this is and why you would use it. No jargon.
3. A `> **In short**` quote box: 2 to 4 bullets with the key facts.
4. Body, in sections that answer "how do I…" questions (`## Do the thing`). Numbered steps for procedures. Name the exact buttons, tabs and menu items as they appear in the app, in **bold**.
5. Where something is aimed at one audience, say so with a short labelled aside, e.g. `> **For power users:** …`, `> **For developers:** …`, `> **New to git?** …`.
6. `## See also`: 2 to 5 links.

## Writing rules

- Plain, friendly, direct. Short paragraphs and sentences. Active voice. "you", not "the user".
- No hype, no emoji, no "simply" or "just".
- Accuracy over completeness: **read the source** (`src/renderer/src/views/*`, `src/shared/*`, `src/core/*`, and `decisions/`) and only document what exists. Use the labels in the UI code. If you are unsure, leave it out rather than guess.
- Say where something differs between desktop, browser (hosted) and phone only if it does.
- Keyboard shortcuts: use the defaults from `src/shared/shortcuts.ts`, write `Mod` as **Cmd** (Mac) / **Ctrl** (Windows, Linux), and note they can be changed in Settings.
- No screenshots (they go stale). Describe where things are instead ("in the left sidebar", "top right").
- Don't link to source files from the wiki pages, except in Contributing. Don't mention decision file names.

## Links

The wiki is read in two places: the `docs/` folder on GitHub, and the GitHub wiki, which the publish script fills from this folder. Write every link to another page as `[Text](Page-Name.md)` (file name with `.md`). The publish script removes the `.md` for the wiki. Link to anchors as `Page-Name.md#heading-slug`. Files are flat (no subfolders), named `Title-Case-With-Hyphens.md`.

Use ASCII hyphens, not em dashes. Use sentence case for headings.
