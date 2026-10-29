# Core concepts

The few ideas that everything else in helm is built on.

> **In short**
> - A **repository** is a project on GitHub. A **session** is one task an agent works on.
> - Each session gets its own **worktree** (a private copy of the project) on its own **branch**, so agents never interfere with your files or each other.
> - A coloured **status** tells you which sessions need you.

## Repository

A project hosted on GitHub that you have added to helm. helm keeps a clone of it on the machine it runs on. Repositories are listed in the left sidebar. See [Repository page](Repository-Page.md).

## Session

One task given to one agent (or a small team of agents). It has a conversation, a set of changes, and usually ends as a pull request. Sessions are listed under their repository in the sidebar and on the [Overview](Overview-and-Needs-You.md).

Session names are unique across all repositories. You can rename a session at any time.

## Agent

The AI doing the work. helm supports **Claude Code** and **Codex**. You choose the agent and model per session when you [start one](Starting-a-Session.md). A session can also include extra read-only agents for a second opinion: see [Extra agents and subagents](Extra-Agents-and-Subagents.md). Agents can be turned on and off under **Settings, then Agents**.

## Worktree and branch

> **New to git?** A *branch* is a separate line of changes to your project. A *worktree* is a separate folder on disk showing that branch. Together they mean the agent can change files freely without touching your own copy.

When a session starts, helm creates a worktree and a branch named `agent/<session-name>` (the prefix can be changed under [Settings](Settings.md#worktrees)). Your own checkout is never touched. helm pushes the branch to GitHub after each commit by default, so nothing lives only on your computer; this can be turned off.

> **For developers:** the branch starts from the repository's default branch, or any branch you pick, including local ones.

## Free agent

An agent that is not tied to a repository, for research, writing, scripts and one-off jobs. See [Free agents](Free-Agents.md).

## Session status

| Status | Colour meaning | What it means | What you do |
| --- | --- | --- | --- |
| **Working** | Busy | The agent is running. | Nothing, or watch along. |
| **Needs you** | Attention | It is waiting for an approval or an answer, hit a limit, or looks stuck. | Open the [Inbox](Inbox.md). |
| **Ready for review** | Ready | A turn finished with changes or commits. | Review on the Changes tab. |
| **Done** | Quiet | A turn finished with nothing to review. | Reply to continue, or archive. |
| **Failed** | Error | The session hit an error. | Open it, then resume or archive. |

Sessions cannot run while helm is closed, so helm never claims they are. If helm was closed while a session was working, it sets it to Done and picks it back up when you reply. You can also turn on **Resume agents on launch** in Settings.

## Checkpoints

Before every message you send, helm saves a snapshot of the worktree. You can restore it or fork a new session from it. See [Checkpoints and Compare](Checkpoints-and-Compare.md).

## Pull request

A proposal on GitHub to merge a branch into the main code. This is the normal way an agent's work reaches your project. See [Pull requests and merging](Pull-Requests-and-Merging.md).

## Where to go next

- [The window](The-Window.md)
- [Glossary](Glossary.md)
- [Safety and limits](Safety-and-Limits.md)
