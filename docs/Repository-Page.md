# Repository page

Click a repository in the sidebar to open its page. It is the home for everything about one project outside any single session.

> **In short**
> - Tabs: **History**, **Code**, **Outside sessions**, **Memory**, **MCP servers**, **Fixtures**, **Branches & worktrees**, **Issues**, **Actions**, **Settings** and **Pull requests**.
> - The header has **New session**, fetch from GitHub, and push buttons.

Right-click a repository in the sidebar for a menu: **New session**, the tabs above, **Fetch from GitHub**, **Open on GitHub**, open in your editor or file manager, copy its path or URL, and **Remove from helm**.

## History

Recent commits on the repository, with author, message and time. Click a commit for the files it changed and their diffs. The GitHub icon opens the commit's checks on GitHub. Switch between **Unified** and **Split** diffs. History is cached and loads more as you scroll.

## Code

Browse and edit your own checkout, or any session's worktree. See [Code and terminal](Code-and-Terminal.md). Saving here writes straight to your checkout.

## Outside sessions

Claude Code sessions started outside helm (the terminal, VS Code), found by this repository's folder. You can read their transcripts live, and **Continue in helm** to copy one into a helm session. They are read-only and can be archived. See [Checkpoints and Compare](Checkpoints-and-Compare.md#continue-a-session-started-outside-helm).

## Memory

The notes agents read at the start of every session. See [Memory](Memory.md).

## MCP servers

Extra tools for agents in this repository. See [MCP servers](MCP-Servers.md).

## Fixtures

Files you upload once and every session in the repository can use, such as data, secrets or notes that should not be committed.
- They are copied (or, if you choose, linked read-only, which is instant and uses no extra disk) into the top of every new worktree, and kept out of commits.
- Drop files anywhere on the tab. A **.zip** can be unpacked into a folder of the same name. Uploads resume if interrupted.
- A file the repository already tracks is never overwritten. Free agents do not get fixtures.
- To copy files your checkout already has but git does not track (like `.env`), use **Copy untracked files** in the repository's Settings.

## Branches & worktrees

Every branch and worktree helm created for this repository, with what is in each, so you can remove ones you no longer need. Removing a worktree asks first and is refused with unsaved work.

## Issues

Open GitHub issues. **Start session** opens the New session dialog with the issue's text, labels and recent comments filled in, and the pull request will say "Closes #n". Filter with **Filter issues**. See [Issues and GitHub](Issues-and-GitHub.md).

## Actions

Run GitHub Actions workflows by hand. It lists active workflows and, for those that can be started manually, a **Run** dialog with a branch or tag picker and a form for the workflow's inputs. This starts the workflow on GitHub as you; it runs there, not on your computer. Recent runs and their results are shown. Each run is logged in [Activity](Activity.md).

## Pull requests

Open pull requests with their checks. **Merge**, or **Fix comments** to start a session that addresses the review comments. See [Pull requests and merging](Pull-Requests-and-Merging.md).

## Settings

Per-repository versions of the global defaults: model, effort, permissions, budget, standing instructions, branch prefix, fetching, files to copy into new worktrees, commit style and author, auto push, merge and clean-up behaviour. Anything you leave on the default follows [Settings](Settings.md#repositories). You can also **Hide this repository**: it disappears from the sidebar, search, new session and Overview but keeps all its data, and can be shown again from Settings. Hiding is refused while it has sessions that are not archived.

Removing a repository from helm asks whether to keep archived sessions, and can delete the local clone.

## See also

- [Starting a session](Starting-a-Session.md)
- [Core concepts](Core-Concepts.md)
- [Settings](Settings.md)
