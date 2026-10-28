## 2026-10-28 · Settings page gains 30 settings, with auto push timing and a fix for stale “unpushed”

Added: default effort, standing instructions, environment variables, review model and automatic review, stalled-agent flag, session budget warn-or-pause, auto-merge, keep awake, start at login / in the tray / on a chosen page, worktree cleanup and build-output clearing, background fetch and fetch-before-session, commit message style and trailer, draft pull requests, notification text, confirm-before-delete, folded tool calls, zoom, time format, activity log retention, and when auto push runs (after each commit or when ready).

Choices and why:
- Every default keeps the behaviour from before the setting existed (time format 24 hour, start page “where I left off”, push after each commit).
- Keep awake, start at login, start in the tray and zoom change the desktop shell, so the Settings page hides them on the hosted server. The environment variables and standing instructions are blanked in the hosted policy’s public view like other server-side settings.
- “Unpushed” counts skip merged sessions. A squash-merged branch deleted on GitHub looked like unpushed work forever because git cannot see a squash as containing its commits.
- With confirm-before-delete off, a session with uncommitted or unpushed work, or one that worked in the user’s own folder, still asks. Turning off the question must not turn off protection of work that exists nowhere else.
- Not built: “show the agent’s reasoning” (the transcript has no reasoning events), a PR test-plan toggle (the body is built from a template, not by the agent) and diagnostics options (left out on request).
