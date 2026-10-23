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

## D-010 · 2026-10-23 · Permission model for agent tool calls
`canUseTool` auto-allows reads, edits inside the session worktree and a short list of read-only commands. Other commands wait in "Needs you" unless they match the always-allowed patterns in Settings. "Always allow" derives a pattern from the command (`pnpm test *`) and adds it to that global list. Edits outside the worktree always ask. Replying in the composer while a request waits answers a question or denies an approval with an explanation.
Why: matches the design's three approval surfaces and keeps agents inside their worktree without prompting for every read.

## D-011 · 2026-10-23 · Cost tracking and budgets
Cost is the SDK's cumulative `total_cost_usd` from each result message. Between results, an estimate from token usage and list prices is added so a budget can stop a long turn. The session budget and the repository weekly cap both pause the session into "Needs you" with an "Add $5 and resume" action.
Why: results only arrive at the end of a turn, and budgets need to bite during one.

## D-012 · 2026-10-23 · Session status rules
A finished turn with changes or commits becomes `ready`; with none it becomes `idle` ("Done"). Interrupt and Pause are the same action and leave the session `idle` so a reply resumes it. On app start any session that was working or waiting is set to `idle` and resumed from its saved Claude session id when the user replies.
Why: sessions can't keep running when helm is closed, and the status should never claim otherwise.

## D-013 · 2026-10-23 · Agent commits carry a Co-authored-by trailer
The system prompt asks the agent to end commit messages with `Co-authored-by: helm session <id> <noreply@helm.app>`. Commits are authored with the user's git identity because the worktree inherits it.
Why: the Settings copy promises authorship by the user with the session in a trailer, and the history view uses the trailer to mark agent commits.

## D-014 · 2026-10-23 · Always-allow patterns never match chained commands
A pattern like `echo *` is a glob, so on its own it would also approve `echo hi && rm -rf …`. Commands containing `; & | < > ` $( ${` or a newline never match an allow pattern or the read-only list, and "Always allow" is not offered for them (they need approval each time).
Why: found while testing a real approval; the glob made the allowlist a bypass.

## D-015 · 2026-10-23 · Packaging
`electron-builder` with `npmRebuild: false`, because the prebuilt node-pty is N-API and has no sources to rebuild. `@anthropic-ai/**` and `@homebridge/**` are unpacked from the asar. When packaged, the Claude binary is taken from `app.asar.unpacked` (the SDK resolves a path inside the asar, which cannot be executed). A CLI path set in Settings overrides the bundled binary. Removed the `postinstall` rebuild for the same reason.
Why: verified by running the packaged app: sessions and the terminal both work.

## D-016 · 2026-10-23 · Deviations from the handoff
- Search placeholder says "Search sessions and repositories", because file and commit search are not built.
- The paperclip attach button is left out of the composer; the `@` button remains.
- The Settings rows "Menu bar icon" and "Density" are left out: there is no tray icon and density changes nothing yet. The taskbar or dock badge shows the count of sessions that need you.
- "Do not disturb while screen sharing" is left out: there is no reliable way to detect screen sharing.
- Shortcuts show Ctrl instead of ⌘ outside macOS.
- Fake traffic lights are replaced by the native window controls (macOS traffic lights, Windows and Linux title bar overlay).
- Settings gained a GitHub OAuth client ID field, and sign-in gained a client ID input and a personal access token fallback (see D-005).
- Diff lines can be commented on by clicking the new-file line number; the handoff only showed an existing thread.
- Opening the Code tab of a session whose file the agent is editing follows it unless "Follow agent" is off.

## D-017 · 2026-10-23 · Editor gutter compares against the session base
Gutter bars in the Code tab diff against the merge-base with the session's base branch, not HEAD, so they show everything the session changed even after the agent committed.
Why: with HEAD the bars vanished as soon as the agent committed.

## D-018 · 2026-10-23 · Dev and test aids
`HELM_DEV_SEED=1` keeps a seeded user and skips the startup status recovery, so a prepared user-data directory can be used for screenshots and manual checks. It has no effect on normal runs. Logic that doesn't need Electron has vitest tests in `tests/`.
Why: lets the UI be checked against a real git worktree without a GitHub account.

## D-019 · 2026-10-23 · GitHub OAuth client ID is built in
The registered OAuth app's client ID (`Ov23liTYcKE5lBWCEAAV`) is the default in `src/main/store.ts`, so sign-in no longer asks for it. The sign-in field only appears if the setting is empty, and Settings → Account keeps an override. `HELM_GITHUB_CLIENT_ID` still wins when set. Supersedes the "ask for it" part of D-005.
Why: client IDs are public, and asking every user for one was the wrong experience once the app was registered.

## D-020 · 2026-10-23 · Billing mode: subscription or API tokens
A new setting `billing` is `subscription` (Claude Max or Pro login) or `api` (pay per token). It is detected from the first session (`apiKeySource` of `none` means a Claude login) and can be changed in Settings. In subscription mode there are no dollar budgets anywhere: no session budget, repository caps, weekly dollar limit or cost columns. The sidebar and Overview show plan usage instead. In API mode everything works as before, with dollar budgets.
Why: the user runs on a Max 5x plan and doesn't set budgets, but other people pay per token, so both stay supported and configurable.

## D-021 · 2026-10-23 · Plan usage comes from Claude Code's rate-limit events
The SDK emits `rate_limit_event` messages with `unifiedWindows.five_hour` and `seven_day` utilisation as fractions plus reset times (verified against the user's account). helm stores the latest values and shows them as the 5-hour and weekly meters. In subscription mode the user can set percentage limits for each window; reaching one pauses running sessions into "Needs you" with a "Continue anyway" action that lasts until that window resets.
Why: it is the real subscription usage, not an estimate from dollar costs.

## D-022 · 2026-10-23 · Currency
Amounts are stored in USD and displayed in a chosen currency. On first launch the currency is picked from the IP address (ipapi.co), falling back to the OS locale. Rates come from frankfurter.dev (ECB data) and are cached for 12 hours, with built-in fallback rates when offline. The IP lookup happens once, only on first launch, and only until a currency has been detected.
Why: the user is in the UK and asked for GBP by default. The one-off IP request is the only network call that sends the user's address to a third party.

## D-023 · 2026-10-23 · Subagents
Subagents started with the Agent tool are tracked as a tree under their session. Each has its own transcript, stored separately. Limits are on subagents running at once, per session and per repository, with defaults in Settings (4 and 8), per-repository overrides in Settings and a per-session override in the session's usage panel. 0 turns subagents off. The limits are enforced by a `PreToolUse` hook on the Agent tool that denies the call with a reason the model can act on, because `canUseTool` is not called for tools the permission mode already allows.
Why: the user asked for per-project and per-agent limits, a tree view and access to every transcript.

## D-024 · 2026-10-23 · Resizable tables and panes
All tables have resizable columns (drag the edge of a header cell) and the sidebar and side panes have drag handles. Sizes persist in localStorage per table or pane. Tables that had no header row (commit history, pull requests) gained one so there is something to drag.
Why: user decision.

## D-025 · 2026-10-23 · Hands-on code browsing outside sessions
The repository view gains a Code tab: browse and edit your own checkout or any session worktree with Monaco, with quick open, search across files and a commit box. The Code APIs take a workspace id, either a session id or `repo:<owner/name>` for the checkout. Commit history rows open a diff dialog for each file.
Why: user asked to see diffs from history and to browse and edit code directly, like a lightweight IDE with a hands-on feel.

## D-026 · 2026-10-23 · Subagent transcripts are read from Claude Code's session file
Claude Code does not stream a subagent's own messages, only `task_started`, `task_progress` and `task_notification` events. helm uses those for live status, tool counts and tokens, and rebuilds each subagent's transcript with the SDK's `getSubagentMessages`. That file is written lazily, often only once the whole turn is over, so helm re-reads it when the turn ends, when a subagent finishes and every 4 seconds while you are looking at a running subagent. Reads for one subagent run one at a time so an older read cannot overwrite a newer one. Background subagents stay "running" until their task notification arrives.
Why: found by testing with real sessions. Reading the stream alone gave empty transcripts.

## D-027 · 2026-10-23 · Currency switch rounds limits
Changing the display currency converts the dollar limits to whole amounts in the new currency ($100 becomes £75, not £74.76). Limits are still stored in USD.
Why: limits that look like £74.76 are awkward to read and edit.

## D-028 · 2026-10-23 · Code view works on any workspace and refreshes from disk
A workspace is a session worktree or `repo:<owner/name>`, the repository's own checkout. Open clean files reload from disk when the window regains focus, so edits made in another editor appear. The inline Diff compares against the merge-base with the session's base (HEAD for your checkout), and the working-copy side stays editable. The commit box appears for your own checkout only; sessions commit through the Changes tab.
Why: user wants to browse and edit code hands-on, alongside other tools such as the VS Code extension.

## D-029 · 2026-10-23 · Cleaning up test sessions
Testing with real sessions creates worktrees under `~/.helm/worktrees` and project folders in `~/.claude/projects`. These were removed after testing. The same applies to any session you delete in helm: the worktree goes, but Claude Code's own session history under `~/.claude` stays, as it does for any Claude Code session.
Why: avoid leaving test clutter in the user's Claude history.
