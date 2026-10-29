# Changes and review

The **Changes** tab of a session shows exactly what the agent changed, and is where you decide what to do with it.

> **In short**
> - Read the diff file by file, or hunk by hunk. **Accept**, **Ask** or **Reject** each hunk.
> - Ask another agent to review the work for you.
> - When you are happy, commit, open a pull request, or merge.

> **New to git?** A *diff* is a view of what changed: lines added in green, removed in red. A *hunk* is one block of change within a file.

## Reading the changes

- The file list can be shown as a **list** or a **tree** grouped by folder (helm remembers your choice). Click a file to see its diff.
- Switch between **Unified** (one column) and **Split** (before and after side by side).
- Changed images show the old and new version side by side.
- **Open in Code tab** jumps to the file in the editor.
- The list compares the session with where it branched off, so you still see everything after the agent has committed.

A session that works in your own folder (a free agent using **Use my own folder**) is not tracked here. helm leaves git alone in that folder.

## Hunk by hunk

Each hunk has three buttons:
- **Accept** marks it as reviewed. The tab shows "n/m accepted" and a tick on files fully accepted; **Accept all** does the lot. Accepting is a note to yourself: it does not stop you committing or merging, but helm warns about unaccepted hunks.
- **Ask** opens a comment on that line for the agent.
- **Reject** undoes the hunk in the worktree after saving a [checkpoint](Checkpoints-and-Compare.md), and tells the agent the file changed. If the hunk no longer applies, helm says so.

## Comments for the agent

Leave a comment on any line with **Leave a comment for the agent**. Comments are sent together, as one batch, when you ask for changes. If the session has a pull request, **Send new review comments to the agent** sends only the comments that arrived on GitHub since last time.

## Review by an agent

The review button starts a separate, **read-only** agent that reads the diff and returns findings, each marked **blocker**, **warning** or **note**, with file and line. Click a finding to open the file. **Send blockers and warnings to the agent** hands them to the session in one click. The review says when the branch has moved on since it looked.
- Choose which model reviews in [Settings](Settings.md#agents) (**Review model**), and whether to **Review automatically** when a session becomes ready.
- A review's cost counts towards the repository's totals, not the session's.

It also notes when the agent has not run tests or linters in this session. **Run tests before marking ready** in Settings asks the agent to do that.

## Conflict forecast

If another session is likely to clash with this one, a badge shows on the session header. See [Overview and Needs you](Overview-and-Needs-You.md#conflict-forecast). The agent can resolve it for you in one click.

## Finishing

Depending on your settings and the session, the main button on the Changes tab is one of:
- **Commit only**: commit what is uncommitted, with a message you write.
- **Create pull request**, then **Merge pull request #N** once it is open.
- **Merge directly**: no pull request; the branch is brought up to date with the base branch. A protected branch refuses this.

You can open a pull request **as a draft**, choose whether to **Remove worktree after merge** and **Delete the branch after merge**. Everything is covered in [Pull requests and merging](Pull-Requests-and-Merging.md).

## See also

- [Session conversation](Session-Conversation.md)
- [Code and terminal](Code-and-Terminal.md)
- [Safety and limits](Safety-and-Limits.md)
