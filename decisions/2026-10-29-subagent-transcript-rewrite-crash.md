## 2026-10-29 · Tool results tolerate a rewritten subagent transcript

Sessions stopped with "Cannot read properties of undefined (reading '0')" while background subagents ran. `doSyncSubagent` rebuilds a subagent's transcript from Claude Code's saved file, so the event at a remembered position could stop being a `tools` group, and the tool-result handler indexed `items` on it. The handler now checks the event kind first. `consume()` also logs the stack of whatever ends a session, and the "subagent blocked" reason says it is helm's limit, so the model does not report it as the user declining.
