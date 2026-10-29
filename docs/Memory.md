# Memory

The notes agents read at the start of every session, shown per repository so you can see them and tidy them.

> **In short**
> - Open a repository, then its **Memory** tab.
> - Claude Code reads `CLAUDE.md` and memories it saved itself. Codex reads `AGENTS.md` and its own notes.
> - Use **Remember** on one of your messages to teach every future session something.

## The Memory tab

Pick a memory to read it.
- For **Claude Code**: Claude loads the index at the start of every session in the repository, and reads individual memories when they look relevant. Memories appear once an agent writes one, or you add a `CLAUDE.md`.
- For **Codex**: it reads `AGENTS.md` in the repository and in its home folder at the start of every session, and keeps what it learns in one memory folder shared across your projects.

helm shows how many recent sessions read each memory, and flags ones that may be worth a look:
- not read by any recent session and not changed for 45 days (once there are at least three sessions to judge by),
- mention files that no longer exist in the repository,
- read much alike another memory of the same type, so may repeat or contradict it.

A banner filters to the flagged ones. These are hints, not verdicts: helm cannot know that two memories truly contradict each other.

## Remember

Hover one of your messages in a conversation and choose **Remember**. Write it the way you would tell a new colleague, for example "run npm test before committing". helm adds it under **Learned in helm** in the repository's `CLAUDE.md` (or `AGENTS.md` for Codex) so it is read at the start of every session.

> **For developers:** these are normal files in your repository, so they are reviewable and can be committed like any other.

## Standing instructions

For rules that should apply to every session without being a file, use **Standing instructions** under [Settings](Settings.md#agents), or in a repository's Settings tab.

## See also

- [Session conversation](Session-Conversation.md)
- [Repository page](Repository-Page.md)
