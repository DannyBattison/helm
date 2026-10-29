# Activity

A log of everything helm and its agents do, and who did it. Open it from **Activity** in the sidebar (**Alt+4**).

> **In short**
> - One line per event, grouped into **Today** and **Earlier**, newest first.
> - Filter by **All**, **Needs you**, **Git**, **Sessions** or **Agent actions**.
> - Use it to answer "what happened while I was away?"

## What is logged

- Git work helm does for you: fetches, pushes, commits, clones, worktrees created and removed, pull requests opened or merged, direct merges.
- Changes to sessions: started, renamed, archived, restored, stopped, paused, deleted, and archived automatically after being idle.
- Approvals and answers, and what agents ran.
- Failures, such as a push that was refused.

Each row shows the time, an icon, who did it (you, helm, or an agent with its logo), what happened and the repository. Click an agent's name to open its session. Hover a row for more detail. Failed actions are shown in red.

**Show older** loads earlier events.

## How long it is kept

Under **Settings, then About and support**, **Keep the activity log for** removes old events. Sessions and their conversations are not affected. See [Settings](Settings.md#about-and-support).

> **For developers:** the log is an append-only file in helm's data folder, so it never slows the app down. The [Reports](Reports.md) **Audit** tab shows it as a table you can export.

## See also

- [Inbox](Inbox.md)
- [Reports](Reports.md)
- [Safety and limits](Safety-and-Limits.md)
