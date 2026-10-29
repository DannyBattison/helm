# Starting a session

How to give an agent a job.

> **In short**
> - Press **Cmd/Ctrl+N** (or click **+**), describe the task, click **Start session**.
> - Everything else in the dialog has a sensible default and can be changed later.
> - Attach screenshots or any files for the agent to use.

## Open the dialog

Any of these:
- The **+** button in the top bar.
- **Cmd/Ctrl+N**, or **Alt+N** (browsers keep Cmd/Ctrl+N for a new window).
- **Cmd/Ctrl+Shift+N**: a new session in the repository you are looking at.
- A repository's menu, then **New session**.
- Start from a [GitHub issue or review comments](Issues-and-GitHub.md), or from an [automation](Automations.md).

## The fields

**Repository.** Choose a repository, or **No repository (free agent)** for [free agents](Free-Agents.md).

**Branch.** The branch to start from. It defaults to the repository's default branch. Local branches are offered too. If your local branch has commits not on GitHub yet, or you have uncommitted files, helm tells you what the agent will and will not see.

**Task.** What the agent should do. Be specific about the outcome, and mention files or checks that matter. Paste images or drop files in, or use the paperclip. Images go into the message; other files are given to this agent only.

**Model, permissions and budget.**
- The model list shows every ready agent (Claude Code and Codex) and its models. You can set effort too.
- **Permissions** controls what the agent may do without asking: **Ask before commands**, **Allow edits, ask for commands**, **Plan only** or **Allow everything**. See [Safety and limits](Safety-and-Limits.md#permission-modes).
- **Budget** is the most a session may spend before it pauses, when you pay per token. With a subscription, this field is hidden and plan usage limits in [Settings](Settings.md#usage) apply.

All three can be changed later from the session.

**Start now, or later.** If you limit how many sessions work at once, extra ones wait in a queue and start as others finish. You can also choose **After "(another session)" is merged**, to chain work. A queued session can be started by hand.

**Also work in.** Pick more repositories. The agent gets a worktree in each, from its default branch, on a branch with the same name, and each can have its own pull request.

**Also ask.** Bring other agents into the session as read-only advisers. See [Extra agents and subagents](Extra-Agents-and-Subagents.md).

**Compare several runs.** Start the same task 2 to 4 times with different models or effort, and keep the best. See [Checkpoints and Compare](Checkpoints-and-Compare.md#compare-runs).

## Start

Click **Start session** (or **Queue session**, or **Start N runs**). Press Enter or Cmd/Ctrl+Enter, depending on your send key setting.

## Saved prompts

Once a session is open, the message box has a prompt picker that inserts one of your saved prompts, such as "Add tests". helm fills in `{{repo}}`, `{{branch}}`, `{{base}}` and `{{task}}`, and asks for any other variable. Write your own under **Settings, then Repositories** (for every repository) or in a repository's own **Settings** tab. A repository's prompt with the same name replaces the global one there. The same places let you edit the wording of the messages helm itself sends agents, such as the request to resolve a conflict.

## Files you give a session

- Images attach to the message.
- Other files of any type are uploaded for this agent. There is no size limit beyond what the connection allows.
- Files for a whole repository are kept on the repository page, under **Artifacts**. See [Repository page](Repository-Page.md#artifacts-fixtures).

## Session names

helm gives the session a name, and renames the branch after the agent's own title for it. Names are unique across repositories. Rename any time from the right-click menu.

## See also

- [Session conversation](Session-Conversation.md)
- [Core concepts](Core-Concepts.md)
- [Settings: agents](Settings.md#agents)
