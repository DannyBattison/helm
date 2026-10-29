# Checkpoints and Compare

Undo, branch off, and race agents against each other.

> **In short**
> - helm saves the worktree before every message you send. **Restore** goes back; **Fork** branches off.
> - **Compare several runs** starts the same task on different models and lets you keep the best.

## Checkpoints

Before each message you send, helm takes a snapshot of the session's files, including uncommitted and new ones. It does not change your branch or stage anything, so it cannot disturb the agent.

- Open the **Checkpoints** list from the session header, or hover a message of yours.
- **Restore** puts the worktree back as it was just before that message. helm takes a safety snapshot first, so a restore can itself be undone. It is refused while the agent is working.
- **Fork** (**Fork this session**, or **Fork into a new session** from a message) starts a new session from that point, with a prompt for what the fork should do.

Not available in a free agent that works in your own folder, since there is no worktree.

## Compare runs

1. In [New session](Starting-a-Session.md), tick **Compare several runs**.
2. Add 2 to 4 variants of model and effort. Click **Start N runs**.
3. Each variant is its own session. Open **Compare runs** from any of them to see all side by side: status, files, lines, commits, tokens, cost and review blockers.
4. **Keep this one** stops and archives the others. Their branches stay until you delete them from the [Archive](Archive.md).

> **For power users:** this is the way to see whether a cheaper model is good enough for a kind of task.

## Continue a session started outside helm

Claude Code sessions started elsewhere (in the terminal or VS Code) appear read-only in the sidebar and under the repository's **Outside sessions** tab. **Continue in helm** copies the conversation into a new helm session, on the branch it was using if that still exists. The original is untouched. Not possible while it is running, or for very large conversations.

## See also

- [Changes and review](Changes-and-Review.md)
- [Session conversation](Session-Conversation.md)
- [Repository page](Repository-Page.md#outside-sessions)
