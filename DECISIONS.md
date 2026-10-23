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

## D-030 · 2026-10-23 · Sessions started outside helm
Each repository has a "Claude sessions" tab listing Claude Code sessions helm did not start, all read-only.
- **Local** sessions (VS Code extension, CLI) are found by project folder with the SDK's `listSessions` (including worktrees) and shown with a live transcript viewer. "Active" comes from `claude agents --json`, Claude Code's own list of running sessions, falling back to "modified in the last 90 seconds" if that can't be run.
- **Cloud** sessions run on Anthropic's servers and have no supported listing, so they are found by repository through GitHub: `claude/*` branches, and pull requests that link to `claude.ai/code/session_…`. helm shows the branch and PR and opens the real session or PR on click. Their conversations cannot be read from helm.
- helm does not call claude.ai's internal session API with the user's Claude login token. That login is for Claude Code itself, not for other apps.
Why: the user wanted to see sessions started elsewhere, local ones by project folder and cloud ones by repository.

## D-031 · 2026-10-23 · Cloud sessions removed
The cloud half of D-030 is removed. Finding cloud sessions through GitHub branches and pull requests did not work well enough to keep: it shows the output of a session, not the session. helm lists local Claude Code sessions only, found by project folder, and the live flag still comes from `claude agents --json`.
Why: user decision.

## D-032 · 2026-10-23 · Plan usage is probed, not waited for
helm asks Claude Code for the data behind `/usage` (the SDK's experimental `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`) at launch, every 5 minutes, and when the window is focused, so the meters show real numbers without a session having produced a rate-limit event. It also detects billing mode (a subscription type means subscription). The method is marked unstable by the SDK, so failures are ignored and the rate-limit events from sessions keep the meters up to date as before.
Why: the meters read "no data yet" until the first message of a session.

## D-033 · 2026-10-23 · Fonts
Three font settings: interface (replaces `--font-sans`), data (replaces `--font-mono`, used for paths, hashes and numbers) and code (editor, terminal and diffs). Bundled via Fontsource so they work offline everywhere: Mona Sans, Inter, IBM Plex Sans, Source Sans 3, Roboto, Open Sans for the interface, and Monaspace Neon, JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Inconsolata, Roboto Mono for monospace. Fonts installed on the computer are offered too, found by measuring text against fallbacks, and any family name can be typed. Hack is not bundled because Fontsource has no package for it.
Why: user asked for common IDE fonts, and then for the rest of the interface to be switchable too.

## D-034 · 2026-10-23 · Logo
The Phosphor steering wheel is a car's, so the logo is a drawn ship's wheel (rim, hub, eight spokes with handles) and is larger in the sidebar and on the sign-in screen.
Why: user feedback.

## D-035 · 2026-10-23 · External sessions in the sidebar
Local Claude Code sessions started outside helm appear under their repository in the left tree: italic titles, an eye icon, a "read-only" tooltip, and "live" for running ones. The most recent four and any live ones are shown, with a link to the rest. They open as a full page with a live transcript. They are refreshed every 15 seconds while the window is focused.
Why: user wanted them visible alongside helm's own sessions, clearly marked as external.

## D-036 · 2026-10-23 · Syntax highlighting outside the editor, only when confident
Code outside Monaco is highlighted with highlight.js (a small core with about 25 languages), coloured by the same `--syn-*` tokens as the editor themes, so it follows the theme and fonts. Where the language is known it is used: from the file name for diffs and edit blocks, from the fence tag for code in messages, and bash for commands. Where it is not, helm detects it only with strong evidence: valid JSON, a decisive marker such as a shebang or `package main`, or at least two separate language-specific signals with a clear lead over the next language. Anything else stays plain. highlight.js's own auto-detection was tried first and rejected: on test snippets it labelled Python as Ruby and barely separated Go from Java. Detection is covered by tests, including prose, command output and short fragments staying plain.
Why: user asked for highlighting wherever code is visible, but only when confident.

## D-037 · 2026-10-23 · History is cached and read lazily
Git history is read in two parts. A cache holds the raw log, keyed by a hash of every ref, in memory and on disk, so opening a repository paints the last read at once while a fresh check runs; only the colours that depend on current sessions are recomputed each time. The log reads 150 commits first and 300 more each time you scroll near the bottom, up to 3,000. Per-commit stats were dropped from the list and are read when a commit is opened (and cached). Worktrees are read only when their tab is opened. While data loads, tables show skeleton rows in their own grid so nothing shifts. On a 30,000-commit test repository a cached paint takes about 1 ms and a first read of 150 commits about 46 ms. Dropping the stats made no measurable difference on that repository, whose commits are tiny.
Why: user asked for caching, lazy loading and placeholders for slow, large histories.

## D-038 · 2026-10-23 · Reordering the sidebar
Repositories can be dragged to reorder, and sessions within their repository. Subagents have no handle of their own and always travel with their parent. The order is the order of the stored lists, so the Overview ledger follows it. Dragging a session onto another repository is not supported.
Why: user request.

## D-039 · 2026-10-23 · External sessions on the Overview
Sessions started outside helm also appear in the Overview ledger under their repository, in italics with an eye icon and "external · read-only", with an External filter, a count in the summary line and an "external live" item in the status bar. Live ones also show under the Working filter. The most recent five and any live ones are listed per repository.
Why: user asked for them to be visible there as well as in the sidebar.

## D-040 · 2026-10-23 · Sessions can start from local branches
New sessions used to branch from `origin/<base>` only, as the handoff describes. That hides any commit not yet pushed: this repository's `main` was 15 commits ahead of GitHub, whose `main` held only a README, so a session started on it saw an empty project. The New session dialog now lists where a session can start from: a local branch with unpushed commits is offered as "main · local, N not on GitHub" and is the default, next to `origin/main`; branches in step with GitHub still start from the freshly fetched `origin/` copy. The dialog says when unpushed commits are included, when the chosen base would hide them, and how many uncommitted files in the checkout will not be in the session. Uncommitted files are deliberately never copied, so an agent always starts from a commit.
Why: found when a session on helm's own repository could not see the code.

## D-041 · 2026-10-23 · Lifetime tokens per repository
helm keeps a running total per repository of input, output and cache-read tokens and the API-priced cost, updated on every message (subagents included) and persisted separately from sessions, so deleting a session does not lose its usage. The first time it loads, it is seeded from the sessions that exist. The total shown is input + output + cache read, the same definition as the Tokens column; the tooltip gives the breakdown and, in API-token mode, the cost. It appears in the repository header and on the Overview's repository rows.
Why: user asked for lifetime tokens per project.

## D-042 · 2026-10-23 · Highlighting inside shell commands
Commands shown for approval are highlighted piece by piece. The shell is highlighted as shell, and a heredoc body in the language of the file it writes (from the extension) or the interpreter it feeds (`python3 - <<EOF`), else only if the language can be detected confidently, else left plain. Lines are preserved one for one and all text is escaped.
Why: a long heredoc that wrote a JavaScript file showed as plain text.

## D-043 · 2026-10-23 · Deleting a session
Right-clicking a session in the left tree opens a menu: open conversation, open code, review changes, copy branch name, stop, and delete. Delete opens a dialog that asks separately about the worktree (on by default) and the branch (off by default). It warns when removing the worktree would lose uncommitted files, and when deleting the branch would lose commits that are not on GitHub (or exist nowhere else), and says the GitHub copy of a pushed branch is never touched. A branch can only be deleted together with its worktree, because git will not delete a checked-out branch, so ticking the branch ticks the worktree. Deleting also removes the session's saved transcripts and its subagents' transcripts; lifetime token totals are kept. The Session page's Delete button uses the same dialog.
Behaviour changed: deleting a session used to always delete its branch. The Worktrees tab's Remove now keeps the branch, matching its own confirmation text. Removing a worktree after a merged pull request still deletes the branch.
Why: user request. The old behaviour could silently discard unpushed commits.

## D-044 · 2026-10-23 · Repository context menu
Right-clicking a repository in the left tree opens a menu: new session, jump to History, Code, Branches & worktrees or Pull requests, fetch from GitHub, open on GitHub, open in the editor chosen in Settings (or the Code tab when that is helm), show in the file manager, copy the path or GitHub URL, and remove from helm. Removing asks for confirmation and is refused while the repository still has sessions, so no worktrees are orphaned; the folder on disk and GitHub are never touched, and usage history is kept. The repository page is now keyed by its tab as well as its id, so jumping to a tab works when already on that repository.
Why: user request for common repository tasks one click away.

## D-045 · 2026-10-23 · Pending approvals survive closing helm
Quitting used to cancel every pending approval and mark the session stopped, and an unresolved Approve button in the transcript then did nothing. Now quitting ends the agent processes but leaves each session as it was. On launch a session that was waiting on the user stays in Needs you, marked as restarted, in the Overview, the sidebar badge and the transcript. Answering it starts the session again from its saved Claude conversation (`resume`) with the answer as the next message: an approved command is pre-approved once so it runs when the agent re-issues it, a denial or answer is explained to the agent, a plan approval switches the session to "Allow edits", and a raised limit lets it continue. Sessions that were simply working are marked stopped with a Resume button. Transcript buttons now appear only while something is really waiting; otherwise the row reads "No longer waiting".
Why: reported bug. A session waiting for approval at close showed an Approve button that did nothing, and was missing from the dashboard.
Verified by killing helm hard and by quitting normally while an approval was pending, then approving after relaunch: the command ran, once.

## D-046 · 2026-10-23 · Logo text is optically centred
"helm" is nudged down by 0.14em so its painted letters, not its line box, are centred on the wheel. Measured from screenshots: before, the word's ink centre was 2px above the wheel's; after, they match, in the sidebar and on the sign-in screen.
Why: lowercase text without descenders looks high inside a centred line box.

## D-047 · 2026-10-23 · Archiving sessions
Sessions can be archived by hand (right-click, or the Archive button on the session page) or automatically once they have not been opened for N days (Settings → Worktrees, default 14, 0 never). Archived sessions are hidden from the left tree, the Overview and its counts, and are listed in a new Archive page with the reason (by you, or idle for N days), a filter, Restore and Delete. A toggle beside "Repositories" in the left tree shows them inline, dimmed with an archive icon; the Overview has an Archived filter. Archiving keeps everything: worktree, branch, transcript and usage. "Opened" means opening the session, messaging it, or any change in its state. Messaging an archived session restores it. A session that is running or waiting on you cannot be archived, and is never archived automatically; neither is one that finished with changes and has no pull request yet, because hiding it would hide work that needs review. Sessions started outside helm follow the same rules by their last activity, and can be archived or restored by hand, which also overrides the age rule.
Why: user request, to keep the left tree to current work without losing anything.

## D-048 · 2026-10-23 · Long sessions: cached, windowed, virtualised
A session file can be gigabytes (one real one is 1.7 GB, 832 events of conversation) and the SDK takes ~8 s to read it. External transcripts are now read once in the background and cached in memory by file size and modification time, and re-read at most every max(4 s, 3x the read time) while the file changes. The API returns a window (`tail`, or `start`/`end`) plus `total` and `ready`; the first call waits 700 ms so small sessions return immediately, large ones show a "Reading a 1.7 GB session file" skeleton and are polled. Earlier events load as you scroll up. The conversation, subagent transcripts and external viewer use a shared virtualised list (react-virtuoso), and transcript items are memoised.
Why: user report that long sessions scroll slowly.

## D-049 · 2026-10-23 · Remote Control default
Settings → Agents has a toggle that starts Remote Control (`/rc`) in every session, via the SDK `settings` option `remoteControlAtStartup`. It is only sent when on, so a user's own Claude Code setting is never switched off by helm. It applies when a session next starts (new, resumed or restarted). Default off, because it needs a subscription sign-in and may be blocked by organisation policy.
Why: user request.

## D-050 · 2026-10-23 · Session names and rename
Claude Code names each conversation after its first turns (the SDK exposes it as the session `summary`). helm reads it at the end of every turn, ignoring it when it is just the first prompt echoed back, and shows it in the left tree, the session header and Needs-you cards instead of the slug. You can rename from the right-click menu (or by double-clicking the header title); your name wins, and is also written back to Claude Code with `renameSession` so VS Code shows the same name. "Use Claude's name" clears it. The branch and worktree are never renamed; the original id stays as the tooltip/fallback.
Why: user request.
