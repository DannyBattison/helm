# Extra agents and subagents

Two different ways to get more than one agent on a task.

> **In short**
> - **Extra agents** are other models you invite into a session. They read and advise; one **owner** makes the changes.
> - **Subagents** are helpers an agent starts by itself. They appear as a tree under the session.

## Extra agents (a second opinion)

Use these to have, say, Claude and Codex discuss an approach, or to double-check a plan.

**Add them** when you start a session with **Also ask**, or later with the "bring in another agent" button in the message box.

**How it works**
- The first agent is the **owner**. Only the owner edits files, runs commands that change things and commits, so cost, review, checkpoints, queueing and merging all work as normal.
- The others are **read-only**. They can read the code and look around, but cannot edit or run anything that changes things.
- They are named after their model, for example `@opus-5-5`. A second of the same model gets `-2`.
- Write `@name` to ask a particular agent. Naming no one asks everyone, the owner first. You can also right-click an agent's message and choose **Reply to**.
- An agent that mentions another in its reply asks that one to answer next. That is how they discuss. It stops when no one is mentioned.
- **Replies to one message** in [Settings](Settings.md#agents) caps how many replies one message can bring (default 6, or unlimited).
- The session stays **Working** until every reply is in.
- You can change who the owner is. Each agent keeps its own conversation.

## Subagents (helpers)

An agent can start its own helpers for side jobs, like searching or testing.
- They show as a tree under the session in the sidebar, each with its own transcript. Click one to read it.
- Helpers that finish without changing any files are tidied away; there is a row to show them again.
- A session stays working until its subagents are done.
- You can limit them: **Subagents per session** and **Subagents per repository** in [Settings](Settings.md#agents) (defaults 4 and 8), a per-repository override, and a per-session override in the session's usage panel. **Off** stops agents from starting any.
- Codex has its own helpers. The per-session limit is passed to Codex; the per-repository limit is not applied to Codex.

## See also

- [Session conversation](Session-Conversation.md)
- [Safety and limits](Safety-and-Limits.md)
- [Checkpoints and Compare](Checkpoints-and-Compare.md)
