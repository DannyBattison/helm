# Code and terminal

Browse and edit code, and run commands, without leaving helm.

> **In short**
> - The **Code** tab is a full editor (Monaco, the editor behind VS Code) for a session's files or your own checkout.
> - **Ctrl+`** opens a terminal that starts where you are.

## The Code tab

Available on every session, and on a repository's page (where it shows your own checkout).

- A file tree on the left. Click a file to open it in tabs.
- **Cmd/Ctrl+P** jumps to a file by name. Search across files is built in.
- **Cmd/Ctrl+S** saves.
- In a session, saving writes into that session's worktree. On the repository page, **saving writes straight to your checkout**, and a label says which you are in. You can switch between **Your checkout** and any session.
- Coloured bars in the margin show lines the session changed, compared with where it branched off, even after the agent committed.
- Clicking a file name in a conversation, or a line in a review comment, opens the file at that line.
- A commit box lets you commit from here.
- Syntax highlighting is on for the common languages.

> **For developers:** if you would rather use your own editor, set **Open files in** under [Settings, Appearance](Settings.md#appearance) and use **Open in** from a repository's menu.

## The terminal

Press **Ctrl+`** to show or hide the terminal drawer at the bottom. Drag its top edge to resize.

- A new tab starts in the session's worktree, or your checkout on a repository page, otherwise your home folder.
- Tabs stay alive when you minimise the drawer or move around. Closing the last tab closes the drawer.
- **Ctrl+Shift+T** new tab, **Ctrl+Shift+W** close, **Ctrl+Tab** or **Ctrl+PageUp/PageDown** switch. Middle-click closes a tab.
- The lightning button is **quick jump**: it lists workspaces, repositories and live sessions and types a `cd` into the current shell. The caret next to **+** opens a new tab in any of them.
- Search the output with **Ctrl+Shift+F** (**Cmd+F** on a Mac). Links are clickable. There are 10,000 lines of scrollback.
- If a shell exits, a bar offers to restart it.
- Pick the shell under [Settings](Settings.md#worktrees) (**Terminal shell**).

In the hosted version the terminal runs on the server.

## See also

- [Changes and review](Changes-and-Review.md)
- [Repository page](Repository-Page.md)
- [Keyboard shortcuts](Keyboard-Shortcuts.md)
