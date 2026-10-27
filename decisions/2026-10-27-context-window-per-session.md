## 2026-10-27 · Context meter uses the session's real window, not a fixed 200k

The meter divided by a hard-coded 200k, so sessions on a 1M-context model showed over 100%. `contextWindow()` in `src/shared/reports.ts` now picks 1M when the model name contains "1m" or the session has already used more than 200k tokens (it can't be in the smaller window), and 200k otherwise. The session header, the session meter and the Reports panel all use it.
