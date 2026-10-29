## 2026-10-29 · The phone app has two tabs, Servers and Settings, that stay visible

`mobile-app/src/nav.ts` (tested) and `ui.ts`: a bottom bar with **Servers** (the list, adding a computer or server, and tapping one opens helm's own UI above the bar) and **Settings** (the GitHub account with Log out, and the saved connections with Remove). The bar is shown once signed in and is hidden on the GitHub sign-in screens. The app's own pages stop above it (`--tabs`), and helm's `#root` is made shorter by the same amount, so nothing in helm's UI needed changing; dialogs drawn over the whole window sit under the bar.

A computer stays connected while Settings is shown over it, and tapping Servers returns to it; tapping Servers while looking at it goes back to the list, which reloads the page, since helm's renderer holds one computer's state per page load. The Android back button steps out of a sub-screen, then off Settings or the open computer, then minimises. Log out deletes the GitHub token and reloads to the sign-in screen (connections are kept: they belong to the phone's keys, not the login). The ⇄ tab is gone. A hosted server now opens in the in-app browser (it needs its own cookies), so Done returns to the app and its tabs rather than navigating the page away.

Not run on a device; the layout (tab bar height with the safe area, the shortened root) is the part most likely to need a nudge.

Why: user request.
