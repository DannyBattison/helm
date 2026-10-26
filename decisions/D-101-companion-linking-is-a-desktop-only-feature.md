## D-101 · 2026-10-24 · Companion linking is a desktop-only feature
Linking a companion belongs to the desktop app only. The hosted server will not offer it, and the web client will hide it. The companion code is not in this repository (no branch or history mentions it), so nothing is marked yet: when it lands, its API names go in the hosted server's refused list (`CLIENT_SIDE` in `hosted-server/src/protocol.ts`, or a new desktop-only list beside it) and the UI gates the entry points on a capability the bridge reports, rather than on `platform`.
Why: user request.
