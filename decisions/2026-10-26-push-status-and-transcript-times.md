## 2026-10-26 · Push status invalidated on commit and push; transcript events carry a time

Push buttons desynced because the 4s push-status cache was not cleared by commits or auto-pushes, the window was not told when an auto-push finished, and a manual push could race it. Sessions now keep a `pushEpoch` (cache is ignored when it changes), a `pushedAt` the window watches, and manual and automatic pushes for a session run one after another. Transcript events get an `at` time when recorded; agent messages show it beside the user's.
