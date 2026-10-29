# Settings

Open with **Cmd/Ctrl+comma**, or **Settings** at the bottom of the sidebar. The list on the left has a page for each area. On a phone it is a drop-down list.

> **In short**
> - Most things work out of the box. Come here to set defaults, limits, notifications and looks.
> - Many options can also be set per repository: see [Repositories](#repositories).

## Accounts

### GitHub
Who you are signed in as, your organisations (their repositories appear in **Add repository**), and **Sign out**. Your git name and email are used for commits and pushes. **GitHub OAuth client ID** is for the sign-in itself and normally never needs changing.

### Claude Code
Anthropic's agent. Sign in with a Claude subscription or an API key, and choose **Subscription** or **API tokens** billing. **Command-line tool** lets you point to your own `claude` instead of the bundled one. **Remote Control for new and resumed sessions** lets you follow and drive sessions from claude.ai/code or the Claude app (needs a subscription sign-in; your organisation may block it).

### Codex
OpenAI's agent. Sign in with a ChatGPT plan or an OpenAI API key. Needs the `codex` command-line tool. Notes on how permission modes, memory and subagents map to Codex are shown on this page. Codex reports tokens but no dollar cost, and has no Remote Control.

## Agents

Settings that apply to every agent.
- A switch per agent to turn it on or off. At least one stays on. A turned-off agent cannot start new sessions; existing ones keep working.
- **Default model** and **Default effort** for new sessions.
- **Standing instructions**: rules added to every session, such as "use pnpm, not npm". Applies when a session next starts.
- **Environment variables**: `NAME=value` lines set for every agent and terminal. Do not put secrets here.
- **Permission mode**, **Always allowed commands** and **Always ask commands**. See [Safety and limits](Safety-and-Limits.md).
- **Replies to one message** (with several agents in a session).
- **Sessions working at once**, **Flag stalled agents**, **Subagents per session** and **per repository**, with per-repository overrides.
- **Auto push**, and **Push** after every commit or when ready.
- **Resume agents on launch**: agents that were working when helm closed carry on, one after another.
- **Commit author** (co-author or agent only), **Commit messages** (plain or conventional), **Session trailer**, **Sign commits**.
- **Send messages with** (Enter, or Cmd/Ctrl+Enter) and **Interrupt a working agent with** (Esc, Esc twice, or button only).
- **Run tests before marking ready**.
- **Confirm before deleting a session**.
- **Review model** and **Review automatically**. See [Changes and review](Changes-and-Review.md).

## Automated agents
See [Automations](Automations.md).

## MCP servers
See [MCP servers](MCP-Servers.md).

## Worktrees

How sessions get their folders and what happens afterwards.
- **Free agents** on/off, and **Free agents' folders**.
- **Clone location**, **Branch prefix**, **Fetch before a new session**, **Fetch repositories in the background**.
- **Archive sessions not opened for** a number of days.
- **Merge pull requests by** (merge commit, squash, rebase), **Merge automatically**, **When a session is ready** (pull request or push to the default branch), **Open new pull requests in the browser**, **Open pull requests as drafts**.
- **When its work is merged** (archive, delete or leave), **Remove worktree after merge**, **Delete branch after merge**.
- **Remove worktrees of archived sessions after** a number of days, and **Clear build output when archiving**.
- **Terminal shell**.

## Usage

How helm measures and limits use. **Current plan usage**, **Pause agents at 5-hour usage**, **Pause agents at weekly usage**, **Warn at**, **Weekly limit, all repositories** with per-repository caps, and **At the session limit** (pause or warn). Also the currency shown. See [Safety and limits](Safety-and-Limits.md#money-and-plan-limits).

## Repositories

The top **Repositories** page holds the defaults for every repository. Each repository then has its own page, which is the same as its **Settings** tab: model, effort, permissions, budget, tests, instructions, branch prefix, fetching, files to copy into worktrees, commit style, push, delivery and merge options, plus saved prompts and message wording. Anything left at default follows the global value. Hidden repositories are listed here and can be shown again. See [Repository page](Repository-Page.md#settings).

## Notifications

- **Desktop** and **Sound** switches for: needs you, ready for review, failed and checks. 
- **Quiet hours**, and **Still tell me when an agent is blocked** during them.
- **Show message text** in notifications (turn off when sharing your screen).
- A rule per repository: everything, only things that need you, or nothing.
- **Tray icon**, **Keep the computer awake** while agents work, **Start at login**, **Start in the tray**.
- **Email notifications**: send to an address through your own SMTP server (security, username, password, test button).

The dock or taskbar badge counts sessions that need you.

## Appearance

- **Colour scheme** (several tints), **Accent colour**, and **More colours** to recolour the status dots. **Reset colours**.
- **Tutorial mode** and **Show tips again**.
- **Show organisation in the sidebar**.
- **Interface font**, **Data font**, **Code font**, **Ligatures**.
- **Open files in** your editor, **Interface zoom**, **Open on** (the page shown at launch), **Time format**.
- **Fold tool calls**.
- Light and dark themes are toggled from the top bar.

## Keyboard shortcuts and custom shortcuts
See [Keyboard shortcuts](Keyboard-Shortcuts.md).

## Import and export, and Sync
See [Syncing machines](Syncing-Machines.md).

## Mobile app and companion

Desktop only. **Mobile app** pairs phones: see [Phone app](Phone-App.md). **Companion** connects helm to a companion server so you can see and answer agents from a browser; it is off by default and helm never sends your GitHub token to it.

## About and support

- **Update automatically** (checks at start and every few hours, installs on quit).
- **Keep the activity log for** a number of days.
- **Diagnostics**: saves versions, settings, session states and the recent log as one Markdown file for bug reports. Task text, conversations, file contents and repository paths are left out, and tokens and your home folder are masked.
- **Log**: errors and warnings.

## See also

- [The window](The-Window.md)
- [Safety and limits](Safety-and-Limits.md)
