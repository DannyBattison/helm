## 2026-10-28 · Panel agents are named by model, and the session stays working until all of them have replied

Agents in a session with several are named after their model and version as the pickers show it (`Opus 5.5` is `@opus-5-5`, a second one `@opus-5-5-2`), not `claude`, `claude-2`. Sessions already running keep the names they have.

The owner finishing its turn used to mark the whole session ready or finished while the other agents were still to reply. The session now stays working while any reply to a message is outstanding, and is settled (ready for review, or finished) once the last one is in.
