## 2026-11-18 · Stopping a session forgets its background commands

Verified the background-command fix (a6d2064): a session now stays "working" while a command it started in the background runs, and resumes on the task notification. Added a test. A user stop clears the tracked commands, so a stopped session cannot stay "working" forever waiting for a notification that may never come.
