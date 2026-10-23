# Decisions

Append-only log of decisions made for helm. Never edit or delete earlier entries. If a decision changes, add a new entry that supersedes the old one and reference it.

Format: `## D-NNN · YYYY-MM-DD · Title`, then the decision and the reason.

## D-001 · 2026-10-23 · Stack
Electron + Vite (electron-vite) + React + TypeScript, as the handoff suggests. Monaco is bundled locally (no CDN), icons come from the local `@phosphor-icons/web` package, and fonts are copied from the handoff into the app.
Why: the handoff recommends this stack, and a desktop app should work offline.

## D-002 · 2026-10-23 · Port the prototype components rather than rewrite them
The `components/**` primitives and `ui_kits/helm/*.jsx` screens are copied into TypeScript files and rewired to real data. Visuals and copy stay as designed. TypeScript is non-strict (`strict: false`) so the inline-style prototype code compiles without large rewrites.
Why: the design is high fidelity and the primitives are already plain React with token-based inline styles.

## D-003 · 2026-10-23 · Claude sessions run through the Claude Agent SDK
Sessions use `@anthropic-ai/claude-agent-sdk` `query()` with streaming input, `canUseTool` for approvals and questions, `interrupt()` for Esc, and `resume` to continue after an app restart. Models are chosen by alias (sonnet, opus, haiku) so they don't go stale.
Why: it gives structured events, permission callbacks and cost data that parsing CLI output would not.

## D-004 · 2026-10-23 · Main process owns all state
Repos, sessions, settings and activity live in the main process and are persisted as JSON under the app's user data directory. Transcripts are stored per session. The renderer mirrors state pushed over IPC.
Why: sessions must keep running regardless of which view is open, and approvals must resolve from any of the three places they appear.

## D-005 · 2026-10-23 · GitHub sign-in uses the OAuth device flow with a configurable client ID
The client ID comes from `HELM_GITHUB_CLIENT_ID` or a setting, because a GitHub OAuth app must be registered by the owner. The token is encrypted with Electron `safeStorage`. A personal access token paste is offered as a fallback.
Why: the client ID can't be created on the user's behalf, and the app should still be usable without it.

## D-006 · 2026-10-23 · Terminal uses a prebuilt node-pty
`@homebridge/node-pty-prebuilt-multiarch` is used to avoid needing a native build toolchain on Windows. If it fails to load, the terminal falls back to a plain piped shell.
Why: node-pty from source needs Visual Studio build tools.

## D-007 · 2026-10-23 · Features the handoff lists as not designed
A minimal command palette (⌘K), a new-session dialog, and first-run empty states are built using existing components and tokens. The menu-bar dropdown is left out for now; desktop notifications and the dock/taskbar badge cover the "needs you" signal.
Why: the app isn't usable without a way to start a session, and the others are cheap with the existing primitives.

## D-008 · 2026-10-23 · Commit as we go
Work is committed in small steps. Only files created for the app are staged; the untracked design handoff folder and zip are left alone.
Why: user instruction.

## D-009 · 2026-10-23 · .gitignore covers dependencies, build output, secrets and the design bundle
Ignored: `node_modules/`, `out/`, `dist/`, `release/`, logs, `.env*`, OS and editor files, and the design handoff folder and zip. The relevant design assets (tokens, fonts, glyphs, components) are copied into `src/` so the app doesn't depend on the bundle.
Why: user asked for a gitignore up front so unneeded files never get committed. This refines D-008, which left the handoff untracked.
