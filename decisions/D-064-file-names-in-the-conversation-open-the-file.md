## D-64 · 2026-10-23 · File names in the conversation open the file
The file name on Read, Edit and Write rows and on edit cards is a link. It opens that file, in that session's worktree, in the editor chosen in Settings: helm's own Code tab (at the file), or VS Code, Cursor or Zed (VS Code and Cursor are given the line too). Paths outside the worktree, patterns (Grep, Glob), sessions whose worktree was removed, and read-only external sessions are shown as plain text.
Why: user request.
