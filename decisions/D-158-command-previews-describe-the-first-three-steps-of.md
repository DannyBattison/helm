## D-158 · 2026-10-26 · Command previews describe the first three steps of a chain
`commandSummary` no longer appends "and more" to a chained command. It describes each step (past `cd`, `set` and `export`), drops repeats, lists up to three joined by commas ("Install dependencies, Run the build script, Run the tests"), and adds "and N more" only for the rest. The agent's own description still wins when given.
Why: user request; almost every command is chained, so "and more" was on every preview.
