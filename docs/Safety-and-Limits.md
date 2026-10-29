# Safety and limits

What agents can and cannot do, and the controls you have over them.

> **In short**
> - Agents work in their own worktree. Your checkout is never touched, and nothing is merged without you.
> - Anything beyond reading and editing inside the worktree asks first, unless you allow it.
> - Budgets, plan limits, queues and an emergency stop keep cost and chaos in check.

## What touches your files

| Thing | Touches your own checkout? |
| --- | --- |
| A normal session | No. It works in a separate worktree on its own branch. |
| A free agent with its own scratch folder | No. |
| A free agent that uses **my own folder** | **Yes.** Helm warns about it. |
| Saving in the **Code** tab on a repository page | **Yes**, by design. |
| Merging a pull request | Changes GitHub's branch, not your folder. |

Auto push sends session branches to GitHub. The **Push** buttons can also push the branch checked out in your own folder, when you ask. helm always asks before merging.

## Permission modes

Chosen per session (and as a default in [Settings](Settings.md#agents)):
- **Ask before commands**: reads and edits inside the worktree are allowed; other commands wait for you. (Default.)
- **Allow edits, ask for commands**.
- **Plan only**: the agent reads and thinks, and edits nothing.
- **Allow everything**: no approvals at all. The worktree still keeps the agent off your checkout, but it can reach the network and files outside it. Use with care.

Edits outside the worktree always ask. For Codex, the mode is translated to Codex's own sandbox, as described under Codex in Settings.

## Allow and ask lists

- **Always allowed commands**: patterns like `pnpm test *`. Choosing **Always allow** on an approval adds one. Patterns never match chained commands (`a && b`).
- **Always ask commands**: ask every time even when an allow pattern matches. By default this covers killing processes by name or in bulk, which would take down your other agents. helm's own processes are protected from being killed by agents.
- [Reports, Approvals](Reports.md#approvals) suggests rules from what you keep approving.

## Money and plan limits

- **Session budget**: the most a session spends before pausing (per-token billing). The agent waits in **Needs you**.
- **Weekly limit, all repositories** and **At the session limit** (**Pause** or **Warn only**) under **Settings, then Usage**.
- **Plan usage** (subscriptions): helm shows each agent's 5-hour and weekly windows. **Pause agents at 5-hour usage** and **at weekly usage** stop running sessions at a percentage you choose; you can continue anyway. **Warn at** turns the meters amber.

## Queue and slots

**Sessions working at once** limits how many run together. Extras wait in a queue and start as others finish, or you can start one by hand. Sessions waiting on you do not count.

## Subagent limits

See [Extra agents and subagents](Extra-Agents-and-Subagents.md#subagents-helpers).

## Stuck agents

**Flag stalled agents** marks a quiet session as needing you after a set time. Sessions that loop on one file or one failing command are flagged too.

## Emergency stop

**Interrupt all agents** (top bar pause, sidebar, or **Mod+Shift+X**) pauses every working agent at once. **Continue all agents** (**Mod+Shift+E**) lets them carry on and lets queued sessions start. Interrupted agents stay open and pick up when you reply.

## Undo

Every message has a [checkpoint](Checkpoints-and-Compare.md), and rejecting a hunk takes one first. Merged sessions are archived, not deleted.

## Commits

Commits can carry a **Co-authored-by** trailer naming the session, or be by the agent alone. Commits can be **signed** with your git key. See [Settings, Agents](Settings.md#agents).

## Hosted and phone

If you run helm on a server, the signed-in user effectively has a shell there. See [Hosted version](Hosted-Version.md). A paired phone can do everything the desktop window can; see [Phone app](Phone-App.md).

## See also

- [Inbox](Inbox.md)
- [Reports](Reports.md)
- [Core concepts](Core-Concepts.md)
