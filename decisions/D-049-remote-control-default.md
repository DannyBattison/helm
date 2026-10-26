## D-49 · 2026-10-23 · Remote Control default
Settings → Agents has a toggle that starts Remote Control (`/rc`) in every session, via the SDK `settings` option `remoteControlAtStartup`. It is only sent when on, so a user's own Claude Code setting is never switched off by helm. It applies when a session next starts (new, resumed or restarted). Default off, because it needs a subscription sign-in and may be blocked by organisation policy.
Why: user request.
