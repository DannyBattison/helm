## 2026-10-27 · The context window is what the agent reports, then the model name, then how much is used
`contextWindow()` (D: context-window-per-session) now returns the size the agent gave (`Session.ctxMax`, set from Codex's token usage) before falling back to the 1M-by-model-name and over-200k rules, which stay for Claude. The session header, session meter, overview and Reports all go through it, and sizes are worded by `windowLabel` (200k, 272k, 1M).
Why: user request, so the context meter is right for Codex's windows as well as Claude's.
