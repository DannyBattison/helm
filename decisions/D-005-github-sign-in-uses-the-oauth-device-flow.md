## D-5 · 2026-10-23 · GitHub sign-in uses the OAuth device flow with a configurable client ID
The client ID comes from `HELM_GITHUB_CLIENT_ID` or a setting, because a GitHub OAuth app must be registered by the owner. The token is encrypted with Electron `safeStorage`. A personal access token paste is offered as a fallback.
Why: the client ID can't be created on the user's behalf, and the app should still be usable without it.
