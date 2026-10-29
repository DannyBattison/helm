# FAQ

Quick answers, grouped by the kind of question.

## Getting going

**Do I need to know git?**
No. helm handles branches, commits and pushes for you. The [Glossary](Glossary.md) explains the words you will meet.

**What do I need to use helm?**
A GitHub account, and a Claude subscription or API key, or Codex with a ChatGPT plan or OpenAI API key. See [Getting started](Getting-Started.md).

**Can I use it without a repository?**
Yes, with a [free agent](Free-Agents.md).

**No agent shows up when I start a session.**
Turn one on under **Settings, then Agents**, and sign in under **Settings, then Accounts**. A model list stays empty until an agent is ready.

**A folder I want to add is refused.**
Only repositories with a GitHub remote can be added. Push it to GitHub first, or create a new repository from **Add repository, then New**.

## Safety

**Will an agent change my files?**
Not in a normal session: it works in its own copy on its own branch. The exceptions are a free agent you point at your own folder, and saving in the Code tab of a repository page. See [Safety and limits](Safety-and-Limits.md#what-touches-your-files).

**How do I stop everything right now?**
The pause button in the top bar, or **Cmd/Ctrl+Shift+X**. **Continue all agents** (**Cmd/Ctrl+Shift+E**) resumes.

**Can I undo something an agent did?**
Yes. Every message has a [checkpoint](Checkpoints-and-Compare.md). You can also reject single hunks in [Changes](Changes-and-Review.md).

**How do I stop it spending too much?**
Set a session budget, a weekly limit, and plan-usage pause points. See [Safety and limits](Safety-and-Limits.md#money-and-plan-limits).

## Sessions

**What does "Needs you" mean?**
The agent is waiting for an approval or an answer, hit a limit, failed or looks stuck. See [Inbox](Inbox.md).

**A session says "Done" but nothing changed.**
Done means the agent finished with no changes to review. Reply to continue it.

**helm was closed while a session was running.**
It cannot run while helm is closed. On the next launch it shows as Done, and a reply continues it. Turn on **Resume agents on launch** to have working agents pick up again by themselves.

**Why is my session queued?**
You have **Sessions working at once** set and the slots are full. It starts when one frees up, or you can start it by hand.

**Where did my merged session go?**
Merged sessions are archived, not deleted. Open [Archive](Archive.md).

**The agent keeps asking permission for the same command.**
Choose **Always allow**, or add a pattern to **Always allowed commands**. [Reports, Approvals](Reports.md#approvals) suggests candidates.

**Two sessions are changing the same files.**
helm warns of likely conflicts; see [Overview and Needs you](Overview-and-Needs-You.md#conflict-forecast). The agent can resolve it in one click.

## Pull requests

**Merge is refused.**
GitHub's own message is shown: conflicts, required reviews or checks, or a protected branch. See [Pull requests and merging](Pull-Requests-and-Merging.md).

**My branch is not on GitHub.**
**Auto push** is on by default, and a failed push is retried at the next commit. Check [Activity](Activity.md) for the reason. A **Push** button shows when commits are unpushed.

## Disk and speed

**helm is using a lot of disk.**
Each worktree has its own `node_modules` and build output. See **Reports, then System and Disk** to clean them, and **Settings, then Worktrees** to remove old worktrees automatically.

## Other devices

**Can I use helm from my phone?**
Yes: the [Phone app](Phone-App.md), or a [hosted](Hosted-Version.md) server in the browser.

**Can I move to another computer?**
Use [Export and import](Syncing-Machines.md#export-and-import), or sync with a hosted server.

## Reporting a problem

Under **Settings, then About and support**, **Diagnostics** saves a file with versions, settings and recent logs, leaving out your conversations, file contents and repository paths. Attach it to an issue on GitHub.
