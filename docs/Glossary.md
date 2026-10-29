# Glossary

Plain-English meanings for words you will meet in helm.

**Accept / Ask / Reject**: the three buttons on each hunk in [Changes](Changes-and-Review.md#hunk-by-hunk).

**Activity**: a log of everything helm and its agents do. See [Activity](Activity.md).

**Agent**: the AI doing a job. helm supports Claude Code and Codex. See [Core concepts](Core-Concepts.md#agent).

**Approval**: a yes/no question from an agent about running a command. See [Inbox](Inbox.md).

**Archive**: where finished sessions are put away. See [Archive](Archive.md).

**Artifact**: a file an agent hands back to you. See [Artifacts](Artifacts.md).

**Automated agent**: an agent that starts by itself on a schedule or GitHub event. See [Automations](Automations.md).

**Base branch**: the branch a session started from, usually the default branch.

**Branch**: a separate line of changes in git. Each session has its own, named `agent/<name>`.

**Budget**: the most a session may spend before it pauses. See [Safety and limits](Safety-and-Limits.md).

**Checkpoint**: a snapshot taken before each message you send. See [Checkpoints and Compare](Checkpoints-and-Compare.md).

**Checks**: automatic tests GitHub runs on a pull request.

**Checkout**: your own working copy of a project, the folder you normally open. helm leaves it alone.

**Clone**: a copy of a repository on a computer.

**Commit**: a saved set of changes with a message. Agents make these as they go.

**Companion**: an optional way to see and answer agents from another browser. See [Settings](Settings.md#mobile-app-and-companion).

**Compare runs**: starting one task several times with different models. See [Checkpoints and Compare](Checkpoints-and-Compare.md#compare-runs).

**Context window**: how much of the conversation an agent can hold in mind at once. A meter shows how full it is.

**Conflict**: two changes to the same lines that git cannot combine alone. helm forecasts these.

**Diff**: a view of what changed between two versions of files.

**Draft (pull request)**: a pull request marked not ready for review or merging.

**Effort**: how hard a model thinks about a task.

**Fixture**: a file you upload for every session in a repository to use. See [Repository page](Repository-Page.md#fixtures).

**Fork**: start a new session from an earlier point in a conversation.

**Free agent**: an agent not tied to a repository. See [Free agents](Free-Agents.md).

**Hosted**: helm running on a server, used from a browser. See [Hosted version](Hosted-Version.md).

**Hunk**: one block of change within a file's diff.

**Inbox**: everything waiting for you. See [Inbox](Inbox.md).

**MCP server**: a plug-in that gives agents extra tools. See [MCP servers](MCP-Servers.md).

**Memory**: notes agents read at the start of every session. See [Memory](Memory.md).

**Merge**: combine a branch's changes into another branch, usually the main one.

**Needs you**: a session status meaning it is waiting on you. See [Core concepts](Core-Concepts.md#session-status).

**Owner**: in a session with several agents, the only one that makes changes. See [Extra agents and subagents](Extra-Agents-and-Subagents.md).

**Permission mode**: how much an agent may do without asking. See [Safety and limits](Safety-and-Limits.md#permission-modes).

**Plan usage**: how much of your subscription's 5-hour and weekly allowance has been used.

**Pull request (PR)**: a proposal on GitHub to merge a branch. See [Pull requests and merging](Pull-Requests-and-Merging.md).

**Push**: send commits from your computer to GitHub.

**Queue**: sessions waiting for a free slot. See [Safety and limits](Safety-and-Limits.md#queue-and-slots).

**Repository (repo)**: a project on GitHub. See [Repository page](Repository-Page.md).

**Session**: one task given to an agent. See [Core concepts](Core-Concepts.md#session).

**Subagent**: a helper an agent starts for a side job. See [Extra agents and subagents](Extra-Agents-and-Subagents.md#subagents-helpers).

**Worktree**: a separate folder showing a branch, so agents can work without touching your own. See [Core concepts](Core-Concepts.md#worktree-and-branch).
