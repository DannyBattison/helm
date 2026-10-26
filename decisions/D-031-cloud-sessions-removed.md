## D-31 · 2026-10-23 · Cloud sessions removed
The cloud half of D-030 is removed. Finding cloud sessions through GitHub branches and pull requests did not work well enough to keep: it shows the output of a session, not the session. helm lists local Claude Code sessions only, found by project folder, and the live flag still comes from `claude agents --json`.
Why: user decision.
