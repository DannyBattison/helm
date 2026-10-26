## D-61 · 2026-10-23 · Delete branch after merge is its own option
Settings has "Delete branch after merge" beside "Remove worktree after merge" (default on, as before), and the Changes tab and the merge-pull-request dialog carry the same choice per session. It deletes the session branch on your computer and on GitHub. git will not delete a checked-out branch, so choosing it also removes the worktree, and the worktree option shows as on and locked. Sessions saved before this existed follow their old worktree setting.
Why: user request.
