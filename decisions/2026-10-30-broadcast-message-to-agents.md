## 2026-10-30 · Broadcast sends one message to many agents

A megaphone button in the header (between New session and Continue all; in the sidebar footer on mobile) opens a dialog with just the message box and a "Send to" picker, defaulting to every agent. Filtering happens in core (`sessions.broadcast`), not only in the dialog: archived, merged, worktree-gone and other-owner sessions never receive it, even if their ids are passed. It reuses `send`, so queued sessions start and the hold from Interrupt all is cleared, as with any message.
