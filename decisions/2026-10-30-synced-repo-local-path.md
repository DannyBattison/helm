## 2026-10-30 · Synced repositories get a local path of their own

A repository that arrived by sync kept the sender's `localPath`, which does not exist on this machine, so creating a session failed with "spawn git ENOENT" (Node's message for a missing working folder). A new synced repo now gets `<cloneRoot>/<owner>/<name>` on this machine, and creating a session clones it there if absent. `run()` also names a missing folder or a missing program instead of "spawn git ENOENT". Settings are still not synced.
