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

## D-051 · 2026-10-23 · Memory tab per repository
A Memory tab on each repository shows what Claude Code has remembered for it (`~/.claude/projects/<path with non-alphanumerics as dashes>/memory`): the MEMORY.md index, each memory with its type (user, feedback, project, reference) and description, plus the CLAUDE.md files that apply (repo, repo/.claude, CLAUDE.local.md, ~/.claude). Search covers names, descriptions and the text; a type filter narrows the list; `[[name]]` and `(file.md)` links jump between memories. A memory can be edited or deleted (deleting also removes its line from the index); the folder opens in the file manager. The main process only reads, writes or deletes paths that its own listing returned, so a path from the renderer cannot reach other files.
Why: user request. Agents read these files at the start of every session, so seeing and pruning them shapes their behaviour. Agents, commands, skills, MCP servers and hooks were left out until this proves useful.

## D-052 · 2026-10-23 · Composer: full-box focus ring, images, @ files, effort, history
The focus glow is drawn on the whole composer box (it follows the box's border radius) instead of on the textarea, using the box's own focus state. Additions, chosen from the VS Code input: the textarea grows with its text (to about nine lines); paste, drop or attach PNG/JPEG/GIF/WebP images (up to 6, 5 MB each) shown as chips and sent to the agent as image blocks, and kept in the transcript; typing `@` opens a file list for the session's worktree (arrows, Enter or Tab to pick, Esc closes it without interrupting the agent); an effort selector (default, low, medium, high, extra high, max) applied to the running conversation and to later starts; a context-used percentage; a draft per session that survives switching away; and the up/down arrows recall earlier messages. Slash commands and a model picker with descriptions were left out for now.
Why: user request.

## D-053 · 2026-10-23 · Merge directly, skipping the pull request
Settings → Worktrees → "When a session is ready" chooses between a pull request (default) and merging straight into the default branch; the Changes tab can override it per session. A direct merge commits the ticked files, fetches the base, merges the base into the session branch when it has moved (aborting cleanly and saying so on conflicts), then pushes `HEAD:<base>`, which is always a fast-forward so nothing on GitHub is overwritten. A protected branch refuses the push and the error says to use a pull request. Afterwards the local copy of the base is fast-forwarded when that touches no one's work (a clean checkout of it, or a branch nobody has checked out); otherwise it is left alone and the reason is shown. The button needs a second click to confirm because it publishes to GitHub. The session records `mergedInto`/`mergedAt`, which count like an open pull request for auto-archive. Tried against a local bare remote: fast-forward, base-moved (merge commit then push) and conflicting (aborted, worktree clean).
Why: user request.

## D-054 · 2026-10-23 · Merged sessions are archived, not deleted
A merged pull request (or a direct merge) no longer deletes the session. The worktree and branch are cleaned up as before, controlled by "Remove worktree after merge", but the session itself follows a new setting, "When its work is merged": archive it (default), delete it, or leave it. An archived merged session keeps its conversation, usage and change counts and is found in the Archive with "merged into <base>"; its worktree is gone, so Code and Changes explain that and the composer is replaced by a note, and sending to it is refused. Merges are now noticed for every session with a pull request, not only those set to remove the worktree. Sessions already deleted by the old behaviour cannot be recovered.
Why: user report that a merged session vanished. A finished session is history worth keeping.

## D-055 · 2026-10-23 · Copy untracked files uses gitignore patterns
The "copy untracked files" setting is now a multi-line box of .gitignore-format patterns (`.env`, `config/*.local.json`, `**/secrets.*`, `!keep.env`, `# comment`). git does the matching (`ls-files --others --ignored --exclude-from`), so negation, folders, `**` and comments behave as in a .gitignore; tracked files are never copied. Capped at 500 files and 50 MB each; a bad pattern never stops a session starting. The old comma-separated value is converted to one pattern per line on first load.
Why: user request.

## D-056 · 2026-10-23 · Merge a pull request from inside helm
An open pull request can be merged without leaving helm: a Merge button on its row in the repository's Pull requests tab, "Merge pull request" in a session's header, and "merge it here" on the Changes tab. All open a confirmation dialog showing the title, a warning for a draft or failing/running checks, the method (merge commit, squash or rebase; default in Settings → Worktrees), and a choice to delete the branch on GitHub (on by default when the session removes its worktree). Drafts are refused with an explanation, and GitHub's own refusal (conflicts, required reviews or checks, protected branch) is shown as is. On success the session, if helm started it, is settled immediately (worktree and branch removed as configured, then archived/deleted/left per the setting) rather than waiting for the two-minute poll.
Why: user request. Merging is outward-facing, so it always asks first.

## D-057 · 2026-10-23 · Commit author and push-on-commit are prompt-level settings
`commitAuthor` is `coauthor` (user authors, `Co-authored-by: helm session` trailer) or `sole` (the agent's Bash gets `GIT_AUTHOR_NAME/EMAIL` for Claude and a non-attributing `Helm-Session:` trailer). `pushOnCommit` replaces the "do not push" instruction with "push after every commit". Both apply when a session next starts. The history view recognises either trailer.
Why: helm cannot hook the agent's own `git commit`, so the system prompt and environment are the only levers.

## D-058 · 2026-10-23 · Column drag follows the mouse
Dragging a column's right edge moves that edge, and only to where the mouse goes. Before the flexible column (or in a table with none) the column itself grows and the flexible column absorbs it. The flexible column's edge takes width from the column on its right. After the flexible column, which is anchored to the table's right edge, a column and its right neighbour trade width, because growing it alone moved its left edge instead. Where a column has no sized neighbour to trade with (the last column before a fixed one), there is no handle, since its edge cannot move.
Why: user report that dragging right could expand a column to the left.

## D-059 · 2026-10-23 · GitHub link on a commit checks the commit is pushed
The GitHub button in the commit panel first checks that the commit is reachable from a remote branch (`git branch -r --contains`). A commit that only exists on this computer has no page on GitHub, which showed as a 404; helm now says it is not on GitHub yet and to push the branch. History lists every local branch, so unpushed commits are common.
Why: user report of a 404.

## D-060 · 2026-10-23 · Allow everything permission mode
A fourth permission mode, "Allow everything", in Settings, the new-session dialog and each session's composer. It maps to the SDK's `bypassPermissions`, so no command or edit asks for approval. Every session is started with `allowDangerouslySkipPermissions` so a running conversation can be switched into it from the composer; that flag alone does not change the mode. Budgets, plan-usage pauses and the subagent limits still apply, because they do not depend on the approval prompt. The setting says plainly that the worktree protects your checkout but not the network or files outside it.
Why: user request.

## D-061 · 2026-10-23 · Delete branch after merge is its own option
Settings has "Delete branch after merge" beside "Remove worktree after merge" (default on, as before), and the Changes tab and the merge-pull-request dialog carry the same choice per session. It deletes the session branch on your computer and on GitHub. git will not delete a checked-out branch, so choosing it also removes the worktree, and the worktree option shows as on and locked. Sessions saved before this existed follow their old worktree setting.
Why: user request.

## D-062 · 2026-10-23 · Push buttons per session, per repository and overall
Push status lists every branch that has commits GitHub lacks: each session's branch and the branch checked out in each repository's own folder (that folder is not a session, so its commits had nowhere to be pushed from). A Push button with the commit count appears in a session's header when it has unpushed commits, "Push all" in each repository's header pushes that repository's sessions and checkout, and "Push all" on Overview pushes everything. They are disabled when everything is on GitHub, and the tooltip lists what would be pushed. Uncommitted files are reported, never pushed. Replaces the earlier Push all, which looked only at sessions and so was disabled with none.
Why: user could not find where to push.

## D-063 · 2026-10-23 · Lifetime tokens are visible everywhere they apply
The lifetime token total per repository was only on the repository page and on Overview rows for repositories that had sessions, so with no sessions it was nowhere. It now also shows beside each repository in the left tree, and Overview has a "Tokens by repository" section listing every repository, with or without sessions, with a bar, the total, and cost when billing is by API.
Why: user report that it could not be seen.

## D-064 · 2026-10-23 · File names in the conversation open the file
The file name on Read, Edit and Write rows and on edit cards is a link. It opens that file, in that session's worktree, in the editor chosen in Settings: helm's own Code tab (at the file), or VS Code, Cursor or Zed (VS Code and Cursor are given the line too). Paths outside the worktree, patterns (Grep, Glob), sessions whose worktree was removed, and read-only external sessions are shown as plain text.
Why: user request.

## D-065 · 2026-10-23 · Reports, built from data helm already keeps plus three small ledgers
A Reports screen (left tree, below Activity) with tabs for Spend, Throughput, Approvals, Quality, Digest and Audit over the last 7, 30 or 90 days. All figures come from `src/shared/reports.ts`, pure functions over sessions, a per-day usage ledger and an audit log, so they are unit-tested without Electron. New records: `daily` (cost and tokens per day, repository and model, kept for good, because the old `usage` list was cut to 15 days), `audit` (commands run, files edited, approvals and answers, newest 5,000), and on each session its tool counts, per-file edit counts, `prAt` and a `stuck` reason. Spend history therefore starts when this version first runs; older sessions still count in the outcome and throughput figures. Spend: totals, per day, repository, model and effort, cache hit, a monthly pace, the pace of the 5-hour and weekly plan windows and when they would be hit, cost per merged session, per commit and per 100 lines, and the share of spend on sessions that were abandoned (archived with no pull request or merge). Throughput: sessions started, merged and abandoned per week, median time to first commit, pull request and merge, time in each status, and how long agents waited on you. Approvals: decisions, median wait, which commands you are asked about, and an "always allow" suggestion for a command approved five times and never denied. Quality: tool calls and failures, sessions that look stuck, context fullness against an assumed 200k window, files touched by many sessions, and files edited again and again. The digest is Markdown to copy or save; spend, sessions and the audit log export as CSV. Tokens, keys, passwords and credentials in URLs are masked (`src/shared/redact.ts`) before anything reaches the audit log. A session looks stuck after 10 edits to one file, or 3 failures in a row of one command, with no commit; it is flagged in the sidebar and header and in Reports, and nothing is paused automatically.
Why: user request for all reports. Data was the missing piece, not charts.

## D-066 · 2026-10-23 · Checkpoints before every message, restore, and fork
Before each message you send (and at the start), helm saves the worktree as a hidden commit parented on HEAD, built with a temporary index (`read-tree`, `add -A`, `write-tree`, `commit-tree`) and kept alive by `refs/helm/<session>/<n>`. It includes uncommitted and untracked files (not ignored ones), moves no branch and stages nothing, so it cannot disturb the agent. The user message in the transcript records its checkpoint number. Restore (hover a message, or the Checkpoints list in the session header) first takes a safety checkpoint, then resets the branch to the checkpoint's parent, cleans untracked files and re-applies the saved files, so a restore can itself be undone; it is refused while the agent is working. The agent is told on the next message that the worktree was rewound. Fork starts a new session at one of your messages (or at now): a worktree seeded from that checkpoint, and a copy of the Claude Code conversation up to just before the message (`forkSession` with `upToMessageId`, then the file is copied into the folder Claude Code uses for the new worktree), found by matching your message's text and which occurrence of it it is. Refs are deleted with the session. History and its cache ignore `refs/helm`. Rejecting a hunk also takes a checkpoint first.
Why: Cursor's checkpoints are the feature people miss most; git can do it without a second copy of the files.

## D-067 · 2026-10-23 · Hunk-level review in Changes
Each hunk has Accept, Ask and Reject. Accept records the hunk's id (a hash of the file and the changed lines, not line numbers, so it survives other hunks moving) on the session, and Changes shows "n/m accepted" with a tick on files fully accepted and an "Accept all". Ask opens the existing line comment on the hunk's first changed line. Reject applies the hunk backwards to the working tree (`git apply -R --recount`) after a checkpoint, tells the agent the file changed, and says plainly if the hunk no longer applies. Accepted hunks do not gate anything: the PR and Merge buttons only warn about unaccepted hunks and review blockers. Partial commits (committing some hunks of a file) were left out; Reject covers the same need without staging.
Why: user request. Reviewing by file is too coarse for agent diffs.

## D-068 · 2026-10-23 · Review by Claude
A button on the Changes tab starts a separate, read-only Claude (the session's model, `permissionMode: dontAsk`, only Read, Grep, Glob and a short list of read-only `git` and shell commands allowed; edit tools and subagents disallowed) that reads the diff against the base and returns structured findings (blocker, warning, note, with file and line). They show in the right panel, a file finding opens that file, and blockers and warnings can be sent to the agent in one click. The review records the commit it saw and says when the branch has moved on. Its cost goes to the repository's totals and the usage ledger but not to the session's cost, because the session's cost is replaced by the SDK total after each turn. It cannot be exercised in tests without a Claude login, so only its parsing and prompt are unit-tested.
Why: user request.

## D-069 · 2026-10-23 · Conflict forecast
Every 20 seconds, and only when a session's commits, files or line counts have changed, helm compares each pair of live sessions in a repository, and each against its base, using `git merge-tree --write-tree --name-only` (git 2.38 or newer, in memory, touching no worktree). Two files edited by both sessions but not yet committed are reported as overlaps from `filesTouched`, since git only sees commits; older git gets overlaps only. Results are shown as a banner on Overview, a badge on the session header, and in `AppState.forecast`. At most 14 sessions per repository are compared.
Why: user request. Parallel agents touching the same files is the main way many sessions go wrong.

## D-070 · 2026-10-23 · Compare runs, and continuing outside sessions
New session has "Compare several runs": 2 to 4 variants of model and effort for one task, each its own session in a shared `group`. The Compare screen puts them side by side (status, files, lines, commits, tokens, cost, review blockers); "Keep this one" stops and archives the rest and leaves their branches until deleted from the Archive. "Continue in helm" on a session started outside helm copies its conversation (`forkSession` into the new worktree's Claude Code folder) and starts a helm session from the branch it was on if that exists, otherwise from the default branch. The original is untouched; a running session, or a file over 300 MB, is refused.
Why: user request (fan-out, continue external sessions).

## D-071 · 2026-10-23 · Inbox, driven from the keyboard
"Needs you" in the left tree, the bell and the ⌘K list now open an Inbox: a list of everything waiting on a person, and the detail of the selected item. Order: agents blocked on an approval or question (oldest first), limits reached, failed sessions, sessions that look stuck, finished work with no pull request or merge, then queued sessions (`src/shared/inbox.ts`). j and k move; a approves, A always allows (only when there is a pattern), d denies, n opens a box to deny with an instruction, 1 to 9 pick an answer when there is exactly one question, a or c continues past a limit, r resumes a failed session, s starts a queued one, Enter opens the session. With several questions there is no single option to press, so the session is opened. The Overview and its "Needs you" filter are unchanged.
Why: user request. Approvals are the most frequent action in helm.

## D-072 · 2026-10-23 · Queue: a limit on sessions working at once, and "after another session is merged"
Settings → Claude Code has "Sessions working at once" (0 is no limit). A new session beyond the limit is queued: it gets its worktree and branch straight away but its agent does not start. New session also has "After <session> is merged": the queued session's untouched branch is reset to the base once that merge lands (a session that no longer exists is not waited for), so it starts from code that includes the first one's work. Sessions are released oldest first whenever anything changes. A session waiting on you does not use a slot. Messaging a queued session, or Start now, starts it at once; Cancel takes it out of the queue without running it. Queued sessions have status idle with the reason as their step.
Why: user request. Without it, a plan window can be spent by whichever sessions were started first.

## D-073 · 2026-10-23 · GitHub issues and review comments become sessions
Repository → Issues lists open issues; Start session opens New session with the task filled in from the issue, its labels and the last 12 comments (HTML comments removed, long text cut), and remembers the issue on the session, so the suggested pull request text says "Closes #n". Pull requests → Fix comments starts a session from the pull request's branch with its review comments as the task. A session with a pull request has "Send new review comments to the agent", which sends only what arrived since the last time (not by you) and records when. All of it uses the REST API with the existing token.
Why: user request.

## D-074 · 2026-10-23 · Notification rules
Settings → Notifications adds quiet hours (a window that may cross midnight; sound is always off inside it; an approval or question can still notify, which is a switch), a rule per repository (everything, only things that need you, nothing), and a tray switch. Decided in `src/shared/notify.ts` so it is tested. The per-kind desktop and sound switches still apply first.
Why: user request.

## D-075 · 2026-10-23 · ⌘K searches conversations, commits and code
Typing in the palette (two or more characters, after a short pause) also searches what you and Claude said and the commands and files in the 80 most recently used sessions, commit messages in every repository (plus a commit hash), and, from inside a session or repository, its code with `git grep` (three or more characters). Conversations are read from disk and not kept in memory, so searching does not grow helm's memory. Results are grouped under the sessions, repositories and actions that already matched; a conversation result opens that session (not the exact message), a commit opens the repository's history, and a code result opens the file at its line in a session.
Why: user request.

## D-076 · 2026-10-23 · Memory: who read it, what looks wrong, and "Remember this"
The Memory tab shows how many sessions read each memory (found from the Read tool calls and `cat` commands in the saved conversations) and flags, by heuristic, memories not read by any recent session and not changed for 45 days (only once at least 3 sessions are in that window), memories that mention files no longer in the repository, and memories of one type that read alike (word overlap of 60% or more), which may duplicate or contradict each other. A banner filters to the flagged ones. The flags are hints: helm cannot tell that two memories truly contradict each other. Hovering one of your messages in a conversation offers Remember, which adds it as a line under "Learned in helm" in the repository's CLAUDE.md, its CLAUDE.local.md, or your own ~/.claude/CLAUDE.md, creating the section or file if needed and never adding a line twice.
Why: user request.

## D-077 · 2026-10-23 · Disk use and cleaning
Reports → Disk lists every session worktree with its size (`du -sk`, or a bounded walk on Windows) and how much of that is build output that can go, remembered for five minutes. Clean deletes node_modules, dist, build, out, .next, target, .venv and a few similar folders at the top of a worktree, and only where git ignores the folder and nothing in it is tracked, so ignored files that are not build output, such as the copied .env, are never touched. It is refused while the agent is working. Remove takes an archived or merged session's worktree away (the branch and conversation stay), and is refused with uncommitted files or unpushed commits.
Why: user request. Each worktree carries its own node_modules.

## D-078 · 2026-10-23 · Tray, notification buttons, icons, updates and releases
The tray (menu bar on macOS) shows a count and a menu of what is waiting, each with the actions that fit (approve, always allow, deny, pick an answer, resume), and only acts on the question the menu was built for. On macOS an approval notification has Approve and Deny buttons. Closing the window hides it to the tray on Windows only: some Linux desktops show no tray, and the window would be unreachable. The app and tray icons are drawn from the existing helm glyph (`build/icon.png`, `resources/`). Updates use electron-updater against GitHub Releases, check at launch and every six hours, and are switched off in a development build; Settings → About and support shows the state. `npm run release` and `.github/workflows/release.yml` build for the three platforms on a version tag; the mac build uses the hardened runtime with entitlements for the bundled Claude Code binary and the terminal module. Signing and notarization read their certificates from repository secrets listed in the workflow and the README. None of the updater, signing or tray could be exercised here (no Electron binary, no display, no certificates), so they are written to the documentation but unverified.
Why: user request.

## D-079 · 2026-10-23 · Diagnostics bundle, and a log
Errors and warnings from the main process, uncaught exceptions, crashed processes and errors in the window are written to `helm.log` in the user data folder (rolled at 1 MB) and kept in memory. Settings → About and support saves a Markdown support bundle: versions, a summary of settings, repositories, each session's state and the recent log. It leaves out task text, conversations, file contents and repository paths, masks tokens and keys, and replaces the home folder with ~.
Why: user request.

## D-080 · 2026-10-23 · Windows paths in session files are understood anywhere
`rel()` now treats a path or worktree that starts with a drive letter as a Windows path, whatever platform helm runs on. This makes `tests/subagent.test.ts`, whose fixture came from a Windows machine, pass on Linux, which the release workflow needs; behaviour on a single platform is unchanged. A hunk sent from the window to be reverted is also checked in the main process to have the shape the diff reader produces, so it can only touch the one file named.
Why: the test failed on Linux before this work; hardening found in review.
