# Reports

What your agents cost, how long things take, and where they need you. Open **Reports** from the sidebar.

> **In short**
> - Pick **7**, **30** or **90 days** at the top, then a tab.
> - Works with a subscription (plan usage) or API tokens (dollar cost).
> - Everything can be exported as CSV.

History starts when you first ran a version of helm that has reports.

## Spend

How much was used and by what: **Spent**, **Tokens**, **Cache hit**, **Per merged session** and **Abandoned** (work that was thrown away). Also:
- **Plan usage pace** for subscriptions.
- **Spend by day**, **By repository**, **By model and effort**.
- **Most expensive sessions**.
- **Cost per outcome**: what merged sessions cost compared with ones that were abandoned.

Codex reports tokens but not a dollar cost, so those sessions show tokens only.

## Throughput

How fast things move: **Waiting on you**, **To first commit**, **To pull request**, **To merge**, **Sessions per week**, **Where the time went** (working, waiting, and so on) and who **Waited longest for you**.

## Approvals

How often agents ask and how you answer: **Asked of you**, **Approved**, **Denied**, **Median wait**. **Suggested allow rules** shows commands you approved over and over, which you could allow permanently. **Commands you were asked about** lists the most common.

## Quality

Signs of trouble:
- **Looks stuck**: sessions that edited one file 10 times, or failed the same command 3 times in a row, without committing.
- **Context window**: sessions closest to filling their memory.
- **Tool calls**, **Files agents touch most** and **Edited again and again**.

## Digest

A short written summary of the period. **Copy** it or **Save** it, for example to paste into a stand-up or a message.

## Audit

The full [activity log](Activity.md) as a table.

**Export** buttons give CSV files for the audit log, spend and sessions.

## System and disk

**System** shows the health of helm and the machine it runs on (memory, and the container's limit when hosted). **Disk** lists every session's worktree, largest first, and how much of it is build output that can safely go.
- **Clean** deletes ignored build output such as `node_modules`, `dist`, `build`, `.next`, `target` and `.venv`. It never touches tracked files or ignored files that are not build output, such as a copied `.env`. Refused while the agent is working.
- **Remove** deletes the worktree of an archived or merged session. The branch and conversation stay. Refused if there are uncommitted files or unpushed commits.

## See also

- [Safety and limits](Safety-and-Limits.md)
- [Settings: usage](Settings.md#usage)
