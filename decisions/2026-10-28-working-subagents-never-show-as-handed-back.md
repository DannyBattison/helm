## 2026-10-28 · Working subagents never show as handed back
A subagent whose launch result said "Async agent launched" was finished and archived at once when its definition ran in the background without `run_in_background` in the input, so the sidebar listed it as handed back while it worked. Such launches now count as background and finish with their task notification, and the sidebar never counts or hides an archived subagent that is still working.
Why: user report of working subagents appearing as handed back.
