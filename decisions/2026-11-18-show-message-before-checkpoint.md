## 2026-11-18 · A sent message shows before its checkpoint is saved

`send` used to save a checkpoint of the worktree before pushing the user's message to the transcript, so in a large worktree nothing appeared for a long time. The message is now pushed at once and the session shows "Saving your files before the agent acts"; the checkpoint number is attached to the message when the save finishes. The agent still only receives the message after the checkpoint.
