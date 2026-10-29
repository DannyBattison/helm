# Inbox

Everything waiting on you, in one list. Clear it from the keyboard.

> **In short**
> - Open with the bell at the top, **Inbox** in the sidebar, or **Alt+2**.
> - Pick an item on the left; act on it on the right.
> - Most actions are one key: **a** approve, **d** deny, **Enter** open.

## What lands here

In this order:
1. **Approval**: an agent wants to run a command or change something and needs a yes.
2. **Question**: an agent asks you something. Answer it right here.
3. **Limit reached**: a session hit its budget, or plan usage hit your pause point.
4. **Failed**: the session hit an error.
5. **Merge failed**: a queued merge could not complete.
6. **Looks stuck**: the agent has produced nothing for a while, or keeps repeating itself.
7. **Ready for review**: finished work with no pull request yet.
8. **File for you**: an agent handed over a file (see [Artifacts](Artifacts.md)). It waits until you dismiss it.
9. **Queued**: a session waiting for a free slot.

## Approving commands

An approval shows the command, with a short summary of its first few steps. Choose:
- **Approve**: allow this once.
- **Always allow**: remember a pattern like `pnpm test *` so it stops asking. Patterns never match chained commands, and a list of "always ask" commands (such as killing processes in bulk) still asks.
- **Deny**: refuse. Use the box to deny and tell the agent what to do instead.

## Keyboard

| Key | Does |
| --- | --- |
| **j** / **k** | Next / previous item |
| **a** | Approve (or continue past a limit) |
| **A** | Always allow (only when there is a pattern) |
| **d** | Deny |
| **n** | Deny with a note for the agent |
| **1** to **9** | Pick an answer when there is exactly one question |
| **c** | Continue past a limit |
| **r** | Resume a failed session, or retry a failed merge |
| **x** | Cancel a failed queued merge |
| **s** | Start a queued session |
| **Enter** | Open the session |

On desktop, the tray or menu-bar menu shows the same items.

## Pending approvals survive restarts

Approvals waiting when you close helm are still waiting when you open it again.

## See also

- [Safety and limits](Safety-and-Limits.md)
- [Session conversation](Session-Conversation.md)
- [Settings: notifications](Settings.md#notifications)
