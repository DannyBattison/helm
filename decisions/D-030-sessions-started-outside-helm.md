## D-30 · 2026-10-23 · Sessions started outside helm
Each repository has a "Claude sessions" tab listing Claude Code sessions helm did not start, all read-only.
- **Local** sessions (VS Code extension, CLI) are found by project folder with the SDK's `listSessions` (including worktrees) and shown with a live transcript viewer. "Active" comes from `claude agents --json`, Claude Code's own list of running sessions, falling back to "modified in the last 90 seconds" if that can't be run.
- **Cloud** sessions run on Anthropic's servers and have no supported listing, so they are found by repository through GitHub: `claude/*` branches, and pull requests that link to `claude.ai/code/session_…`. helm shows the branch and PR and opens the real session or PR on click. Their conversations cannot be read from helm.
- helm does not call claude.ai's internal session API with the user's Claude login token. That login is for Claude Code itself, not for other apps.
Why: the user wanted to see sessions started elsewhere, local ones by project folder and cloud ones by repository.
