# Automations

Automated agents start sessions for you, on a schedule or when something happens on GitHub.

> **In short**
> - Create them under **Settings, then Automated agents**.
> - Each run is an ordinary session you can follow, answer and stop.
> - They only run while helm is open.

## Create one

1. **Settings, then Automated agents**, then **New agent**.
2. Fill in:
   - **Name**, for example "Review new pull requests".
   - **Runs in**: one repository, or **Every repository (global)**.
   - **When**: pick a trigger (below).
   - **Prompt**: what the agent should do. Variables: `{{repo}}`, `{{number}}`, `{{title}}`, `{{url}}`, `{{branch}}`. The trigger is added to the start of the task.
   - **Model**, **Permissions** and **Budget per session** (per-token billing only).
3. Click **Create**. Use the switch to turn it on or off, **Run now** to try it, **Edit** or **Delete**.

## Triggers

| Trigger | Notes |
| --- | --- |
| **On a schedule** | Every hour, day, weekday or week, at a local time. A missed run starts once when helm next opens. |
| **When a pull request is opened** | Optionally for pull requests targeting one branch. |
| **When a pull request is merged** | Same. |
| **When an issue is opened** | |
| **When a GitHub Actions run succeeds / fails** | Optionally only on one branch. |
| **When commits are pushed to a branch** | One session for all commits that arrived together. `{{title}}` is the latest commit message. |

helm checks GitHub every minute while it is open. Anything that already exists when you create the agent is ignored.

> **Careful:** a global schedule starts one session in every repository each time.

> **For power users:** combine with the queue limit (**Sessions working at once**) so a burst of triggers does not spend your plan at once. See [Safety and limits](Safety-and-Limits.md).

## See also

- [Issues and GitHub](Issues-and-GitHub.md)
- [Starting a session](Starting-a-Session.md)
- [Settings](Settings.md)
