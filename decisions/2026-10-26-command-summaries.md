## 2026-10-26 · Command summaries say what the command acts on

`commandSummary` now sets aside heredoc bodies, respects quotes, describes only the head of a pipeline, looks through `for`/`if`/`while` blocks to the command inside, and names the target of common programs ("Search for "foo" in src", "Edit Dialogs.tsx", "Commit: message"). Inline Python/Node scripts say which files they read or edit. Shell keywords (`for`, `do`, `done`) are never shown as programs. Unknown programs still fall back to "Run <program>".
