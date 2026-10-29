# Archive

Where finished sessions go to rest. Archived sessions leave the sidebar and Overview but keep their conversation, numbers and branch.

> **In short**
> - Archive a session from its right-click menu, or let helm do it when it has been idle for a while.
> - Open **Archive** from the sidebar. **Restore** brings a session back.
> - Merged sessions are archived, not deleted.

## Archiving

- Right-click a session and choose **Archive session**. A running session must be stopped first.
- helm can archive automatically. Under **Settings, then Worktrees**, **Archive sessions not opened for** sets the number of days. Sessions that are running, waiting on you, or finished but not yet reviewed are never archived automatically.
- When a session's work is merged, helm archives it (configurable, see **When its work is merged** in [Settings](Settings.md#worktrees)).

## The Archive page

A table of archived sessions with their repository, when they were archived and why ("by you", or "idle for N days"). Use **Filter archived sessions** to search.

- **Restore** puts the session back in the sidebar.
- Sessions started outside helm that you archived are listed here too, with their own **Restore**.
- To show archived sessions in the sidebar, use the archive icon next to **Repositories**.

## Disk space

An archived session still has its worktree on disk. Settings can remove it after a number of days, and can clear build output (like `node_modules`) at archive time. The branch and conversation are always kept, and unsaved or unpushed work is never removed. You can also remove worktrees by hand from **Reports, then System**. See [Reports](Reports.md#system-and-disk).

## Deleting

To remove a session for good, right-click it and choose **Delete session**. helm asks first if there is work that would be lost. You can turn the confirmation off for sessions with nothing to lose in [Settings](Settings.md#agents).

## See also

- [Core concepts](Core-Concepts.md)
- [Pull requests and merging](Pull-Requests-and-Merging.md)
