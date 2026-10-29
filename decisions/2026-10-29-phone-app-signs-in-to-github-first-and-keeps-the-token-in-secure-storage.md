## 2026-10-29 · The phone app signs in to GitHub on first launch and keeps the token in secure storage

Refines the pairing check in [2026-10-29-phone-app-reaches-desktops-over-an-encrypted-udp-link](2026-10-29-phone-app-reaches-desktops-over-an-encrypted-udp-link.md). Before, the app ran the device flow every time a computer was added. Now `mobile-app/src/session.ts` signs in once, at launch (the app does not show its list without it), and keeps the token (and the login) in the Keychain / Keystore through `@aparajita/capacitor-secure-storage`, with iCloud sync off. Adding a computer reuses it; reconnecting never sends it. Each start asks GitHub whether the token still works (a revoked one is forgotten and the sign-in screen returns; offline, the saved one is trusted, since the computer refuses a bad token anyway). Sign out is on the list screen. The sign-in screen has a Copy code button (`@capacitor/clipboard`) next to Open GitHub.

The token has no scopes, so it only proves who the user is, and a computer that gets one (through a code scanned by mistake) cannot do anything else with it, but it does not expire by itself: revoke it at github.com/settings/applications. Hosted servers could accept the same token as a sign-in (a native app cannot use their same-origin cookies); that needs server changes and is not done.

Said plainly: the secure-storage plugin and the sign-in screens are native-dependent and untried on a phone; the account logic is tested with a fake GitHub and fake storage.

Why: user request.
