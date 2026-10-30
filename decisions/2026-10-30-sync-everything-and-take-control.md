## 2026-10-30 · Sync carries everything that is helm's; one instance controls each session

Sync now carries settings too, in switchable categories (sessions, repositories, automated agents, settings, usage and audit, artifacts, branches, worktrees), applied by each side for itself. Never carried: `LOCAL_SETTINGS` (paths, shell, companion, p2p, sync choices, `agentEnv`, email setup) and MCP `env`/`headers`. Settings travel as one record stamped `settingsAt`; the later one wins.

A synced session showed "Merged and archived" because its worktree path was another machine's (`worktreeGone`). Each session now has `owner` (instance id, when it took control). Every other instance holds a read-only copy (`remoteOwner`, shown with a Take control button). Taking control fetches the work into a worktree here and stamps a newer `owner.at`; sync compares `owner.at` before `updatedAt`, so a takeover beats the old owner's later edits, and the old owner stops the session if it was running. Sync protocol version 3.

Work moves through GitHub: **Branches** pushes the branch of sessions the instance controls; **Worktrees** also pushes a snapshot commit (uncommitted and untracked files) to `refs/helm/sync/<id>`. Both default to off because they publish work in progress. Not synced: the activity log, plan usage windows, fx rates, `extArchive`, `automationSeen`.
