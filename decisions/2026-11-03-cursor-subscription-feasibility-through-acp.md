## 2026-11-03 · Cursor subscription integration is feasible through its CLI ACP interface

Use Cursor's official `agent acp` interface as the candidate integration path for helm. `spike/cursor/` contains a dependency-free initialize probe, subprocess tests and a feature/validation assessment. Keep this separate from production backend registration until signed-in session, approval, resume and billing checks pass. The Cursor CLI is absent here, so this is documentation-backed feasibility with a tested probe, not a successful live connection.

Why: the user requested a proof of concept for connecting a Cursor subscription. Cursor documents ACP for custom clients and CLI account authentication. Subscription coverage depends on the account's plan and selected model; avoid treating the subscription as a general provider API key or promising complete helm feature parity. This extends `2026-10-26-acp-is-viable-for-a-second-backend`; it does not replace either existing native backend.
