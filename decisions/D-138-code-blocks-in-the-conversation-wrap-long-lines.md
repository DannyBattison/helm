## D-138 · 2026-10-26 · Code blocks in the conversation wrap long lines
Fenced code blocks in messages and the edit diffs in the transcript used `white-space: pre` and scrolled sideways, which cut long lines off on a narrow screen. They now wrap (`pre-wrap`, breaking anywhere when a word is too long). The diff grid's second column became `minmax(0, 1fr)` so it can shrink. Not run in the app.
Why: user request.
