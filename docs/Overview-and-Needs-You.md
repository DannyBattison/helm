# Overview and Needs you

The home page. It shows all your repositories and sessions at a glance, so you can see what is busy, what is waiting for you and what is ready.

> **In short**
> - Open **Overview** from the sidebar (**Alt+1**). **Needs you** (**Alt+3**) shows only sessions waiting on you.
> - Switch between a **List** and a **Board** (kanban) with the toggle.
> - A banner warns when running sessions are likely to conflict.

## The numbers at the top

Tiles show **Working**, **Needs you**, **Ready for review**, **Tokens today** and spend (**This week**, or plan usage if you use a subscription). With no sessions yet, a **Start an agent** prompt takes you to the New session dialog.

## List or Board

- **List** groups sessions by repository, with filters: **Needs you**, **Working**, **Review**, **External** (started outside helm) and **Archived**.
- **Board** shows columns like a kanban: **Needs you**, **Working**, **Ready for review** and **Idle** (done or failed), newest activity first. Cards cannot be dragged, because the agent decides a session's status. The **External** and **Archived** filters always use the list. Helm remembers which layout you chose.

Each row shows the session name, branch, agent and model, how many files and lines changed, context-window use, push status, and a session budget meter if it is paid per token. Click to open it. Use the same right-click menu as in the sidebar.

## Conflict forecast

Every few seconds helm compares live sessions in the same repository, and each against its base, without touching any files. If two are likely to clash, a banner and a badge on the session header say so. Resolving a clash is handed to the agent in one click, since it knows what its own changes meant.

> **For power users:** with more than 14 sessions in one repository, only 14 are compared. Two sessions that edit the same file without committing are flagged as an overlap. Git 2.38 or newer gives the full forecast.

## Needs you

The same view filtered to sessions that are waiting for an approval, a question, a limit, or that failed or look stuck. The **Inbox** is the faster way to clear these: see [Inbox](Inbox.md).

## See also

- [Core concepts](Core-Concepts.md#session-status)
- [Inbox](Inbox.md)
- [Starting a session](Starting-a-Session.md)
