## D-16 · 2026-10-23 · Deviations from the handoff
- Search placeholder says "Search sessions and repositories", because file and commit search are not built.
- The paperclip attach button is left out of the composer; the `@` button remains.
- The Settings rows "Menu bar icon" and "Density" are left out: there is no tray icon and density changes nothing yet. The taskbar or dock badge shows the count of sessions that need you.
- "Do not disturb while screen sharing" is left out: there is no reliable way to detect screen sharing.
- Shortcuts show Ctrl instead of ⌘ outside macOS.
- Fake traffic lights are replaced by the native window controls (macOS traffic lights, Windows and Linux title bar overlay).
- Settings gained a GitHub OAuth client ID field, and sign-in gained a client ID input and a personal access token fallback (see D-005).
- Diff lines can be commented on by clicking the new-file line number; the handoff only showed an existing thread.
- Opening the Code tab of a session whose file the agent is editing follows it unless "Follow agent" is off.
