# The window

A tour of helm's layout. It is the same on desktop, in the browser and on a phone, except that on narrow screens the sidebar becomes a menu you open from the top left.

> **In short**
> - Left: a sidebar with pages and your repositories and sessions.
> - Top: search, **New session**, pause and continue all, your Inbox, and the theme toggle.
> - Bottom: a status bar with counts and usage.

## The sidebar

Top section, pages:
- **Overview**: every repository and session. See [Overview and Needs you](Overview-and-Needs-You.md).
- **Inbox**: everything waiting on you, with a count. See [Inbox](Inbox.md).
- **Activity**: a log of what happened. See [Activity](Activity.md).
- **Reports**: spend, speed and safety numbers. See [Reports](Reports.md).
- **Archive**: sessions you have put away. See [Archive](Archive.md).

Then **Repositories**:
- The **+** adds a repository. The archive icon shows or hides archived sessions.
- Each repository folds open to show its sessions, and sessions fold open to show their [subagents](Extra-Agents-and-Subagents.md). Sessions started outside helm appear in italics with an eye icon; they are read-only.
- **Free agents** is a group for agents with no repository (if enabled).
- Small icons on a session show a queued merge, a "looks stuck" warning, or that it is archived.
- Right-click (or long-press on a phone) a repository or session for a menu: open the conversation, code or changes, copy the branch name, rename, stop, archive, delete, fetch from GitHub, open on GitHub, and more.
- A number beside a repository is its lifetime token use.

At the bottom: **Continue all agents**, **Interrupt all agents** and **Settings**. Plan usage meters or this week's spend show here too.

## The top bar

- **Breadcrumbs** show where you are.
- **Search** (**Cmd/Ctrl+K**) finds sessions, repositories, conversations, commit messages and code, and runs commands.
- **New session** (**+**, glowing).
- **Continue all** (play) and **Interrupt all** (pause): the emergency stop for every working agent. See [Safety and limits](Safety-and-Limits.md).
- **Inbox** bell, with a count.
- **Theme** toggle for light and dark.

## The status bar

Along the bottom: how many sessions are working, need you or are ready for review, how many Claude Code sessions are running outside helm, and tokens used today. The colour dots match the [status colours](Core-Concepts.md#session-status).

## The terminal drawer

Press **Ctrl+`** to open a terminal at the bottom. It starts in the folder of the session or repository you are on. See [Code and terminal](Code-and-Terminal.md).

## Tutorial bubbles

The first time you use helm, small bubbles point at the add-repository button, search, New session, pause/continue and Inbox, one at a time. Dismiss each with **Got it**, or **Turn off tips**. Bring them back under **Settings, then Appearance**.

## Notifications and the tray

On desktop, helm can notify you when a session needs you and keep an icon in the system tray or menu bar. See [Settings](Settings.md#notifications).
