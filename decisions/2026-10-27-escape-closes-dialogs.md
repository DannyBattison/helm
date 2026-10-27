## 2026-10-27 · Escape closes dialogs; file names coloured by status

Every modal `Dialog` with an `onClose` now closes on Escape (unless something inside already handled the key). In the Changes list, file names are coloured by status (added, modified, deleted, renamed). Opening Changes refreshes the session's file count so the tab badge matches the list.
