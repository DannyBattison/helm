# Session conversation

The **Conversation** tab is where you talk to the agent and watch it work. Every session has three tabs: **Conversation**, **Code** and **Changes**.

> **In short**
> - Read what the agent says and does; reply any time.
> - Approve or deny commands and answer questions right in the conversation (or from the [Inbox](Inbox.md)).
> - Stop, pause, continue, restore and fork from here.

## What you see

- Your messages and the agent's replies, with the agent's logo.
- **Tool calls** (reading files, searching, running commands). Long commands fold into a one-line summary, and you can open them. **Fold tool calls** in [Settings](Settings.md#appearance) groups tool calls tighter.
- **Edits** shown as small diffs.
- **Commits** as they happen, with the commit hash and message.
- Notes about things helm did, such as a push, a limit or a failure.
- Tables and code blocks, with a **copy** button on code.
- Files and images the agent hands over, which are [artifacts](Artifacts.md). Click an image to enlarge it.
- File names you can click to open the file in the **Code** tab.

The header shows the session name, branch (with a **Copy branch name** button), push status, the **Checkpoints** and **Fork this session** buttons, and a conflict or "looks stuck" badge when relevant.

## The message box

- Type and send. By default **Enter** sends and **Shift+Enter** adds a new line; you can switch to **Cmd/Ctrl+Enter** in [Settings](Settings.md#agents).
- **@** mentions a file. Start typing a name and choose from the list.
- The paperclip or paste attaches an image. Other files dropped here become [artifacts](Repository-Page.md#fixtures) of the repository.
- The up arrow brings back your last message. Drafts are kept when you switch away.
- Pick the **model**, **effort**, and **permission mode** for this session from the controls under the box.
- The **Context window** meter shows how full the agent's memory of this conversation is. The **Session budget** meter appears when you pay per token.
- The prompt picker inserts a saved prompt. See [Starting a session](Starting-a-Session.md#saved-prompts).
- The "bring in another agent" button adds a read-only second opinion. See [Extra agents and subagents](Extra-Agents-and-Subagents.md).

## Approvals and questions

When the agent wants to run something it is not already allowed to, the session shows **Needs you** and an approval card appears:
- **Approve** once, **Always allow** (saves a pattern), or **Deny**. To deny and redirect, just reply in the message box with what it should do instead.
- Questions come as a form. Answer and send.

See [Safety and limits](Safety-and-Limits.md) for how permissions work.

## Stop, pause, continue

- **Interrupt** (the button next to Send, or **Esc**; you can choose **Esc twice** or **Button only** in Settings) pauses the agent where it is. The session stays open and a new message picks it up. **Pause** and **Interrupt** are the same thing.
- **Stop** ends the session's agent entirely. **Resume** starts it again.
- **Retry merge**, **Cancel merge** and **Start now** appear when a merge is queued or the session is queued.
- **Continue all** and **Interrupt all** in the top bar do this for every session.

## Plan only

Set the permission mode to **Plan only** to have the agent read and think without editing. Good for "tell me how you would do this first".

## Hover a message

Hovering one of your messages offers:
- **Restore**: put the worktree back as it was just before that message.
- **Fork**: start a new session from that point.
- **Remember**: add what you said to the repository's [Memory](Memory.md) so agents read it at the start of every session.

See [Checkpoints and Compare](Checkpoints-and-Compare.md).

## Looks stuck

helm flags a session when it edits one file ten times, or fails the same command three times in a row, without committing. It also marks a working session as needing you when it has produced no output for a while (choose how long under **Flag stalled agents** in [Settings](Settings.md#agents)).

## Renaming, archiving, deleting

Right-click the session in the sidebar. See [Archive](Archive.md).

## Sessions with subagents

If an agent starts helper agents, they appear under the session in the sidebar. See [Extra agents and subagents](Extra-Agents-and-Subagents.md).

## See also

- [Changes and review](Changes-and-Review.md)
- [Code and terminal](Code-and-Terminal.md)
- [Keyboard shortcuts](Keyboard-Shortcuts.md)
