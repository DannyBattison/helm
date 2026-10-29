# Pull requests and merging

How an agent's work gets into your project.

> **In short**
> - Open a pull request from the **Changes** tab. helm writes the title and description.
> - Merge from inside helm, now or **when the checks pass**.
> - Merging always asks you first.

> **New to git?** A *pull request* (PR) is a proposal on GitHub to add a branch's changes to the main code, where others (or you) can review it. *Checks* are automatic tests GitHub runs on it.

## Open a pull request

On the session's **Changes** tab:
- Edit the **title** and **description** if you like. The suggested title is the first line of the task, shortened; the description holds the task, the commits and file counts.
- Tick **Open as draft** if it is not ready.
- Click **Create pull request**. The button then becomes **Merge pull request #N**, and **View on GitHub** opens it.

While it is open, helm keeps its summary block in the description up to date as the agent pushes more. If you rewrite the description yourself, helm leaves it alone. The title is never changed after it is opened.

Settings you may want (under **Settings, then Worktrees**, and per repository): **When a session is ready** (open a pull request or push straight to the default branch), **Open new pull requests in the browser**, and **Open pull requests as drafts**.

## Merge

**Merge pull request** opens a dialog:
- It shows the title and warns for drafts and for checks that are running or failing. Each check is listed with its state and links to GitHub.
- Choose the method: **merge commit** (keeps every commit), **squash** (one commit) or **rebase**. The default is set in Settings.
- Choose whether to delete the branch on GitHub.
- Drafts are refused with an explanation. If GitHub refuses (conflicts, required reviews or checks, a protected branch), you see its message.

You can reach the same dialog from the session's header and from the repository's **Pull requests** tab.

### Merge when checks pass

Choose **Queue: merge when its checks pass** and helm merges it itself once they pass. A pull request with no checks is merged after two minutes. The session stays in the sidebar with a merge icon until then. If checks fail, or GitHub refuses, a **Merge failed** item appears in the [Inbox](Inbox.md) with **retry** and **cancel**.

You can also set **Merge automatically** in Settings: once checks pass, or once they pass and it has been approved. This only applies to pull requests opened from helm.

### Merge directly

Skip the pull request and put the branch straight onto the default branch. A protected branch refuses this. It cannot be queued.

## After the merge

By default helm archives the session (it is not deleted), and can remove the worktree and delete the branch, on your computer and on GitHub. Choose under **When its work is merged**, **Remove worktree after merge** and **Delete the branch after merge**. See [Archive](Archive.md).

## Pull requests tab

On a repository, **Pull requests** lists open pull requests with checks, and offers **Merge** and **Fix comments**, which starts a session from the pull request's branch with its review comments as the task. See [Repository page](Repository-Page.md) and [Issues and GitHub](Issues-and-GitHub.md).

## Pushing

By default helm pushes a session's branch after every commit (**Auto push**), so nothing exists only on your computer. A failed push is shown in [Activity](Activity.md) and tried again at the next commit. You can push when the session is ready instead, or turn it off. When there are unpushed commits a **Push** button shows in the session header, and **Push all** on a repository or on Overview pushes everything. Free agents are not pushed.

## Several repositories

A session that works in more than one repository gets one pull request per repository, each from the Changes tab. Merging directly and review apply to the first repository only.

## See also

- [Changes and review](Changes-and-Review.md)
- [Settings](Settings.md#worktrees)
- [Safety and limits](Safety-and-Limits.md)
