## 2026-11-18 · Background commands keep a session working

A session showed "Finished" while the agent was waiting on a command it had started in the background (`run_in_background`), so it looked dead and messages seemed ignored until the command ended and woke the agent. helm now tracks those commands like background subagents: the session shows "Waiting for background command" as working until the command's task notification arrives. Commands inside subagents are not tracked.
