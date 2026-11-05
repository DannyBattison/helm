## 2026-11-05 · The hosted client is the installable app at the root, and sign-ins slide

The separate PWA build at `/mobile/` is gone. The root client now carries the manifest, the push worker (`/sw.js`) and the icons (all in `hosted/web/public`), so installing the server's own address gives push on iOS and Android. `/mobile/` is not redirected. The forced phone layout for tablets (`phoneLayout`) was dropped; the UI picks its layout from the screen as in the browser. `hosted/pwa/` and the second build are removed; `vite.base.ts` stays for the phone app.

The sign-in cookie is now 30 days and renewed (at most hourly) on every page load and socket connect while it is valid, instead of a fixed 7 days. With no `HELM_HOSTED_SECRET`, a key is made once and stored in the data directory instead of changing on every start, so restarts no longer sign everyone out.

Why: the installed app logged out often and got no notifications. Two URLs made it easy to install the build without a worker, each had its own scope and storage, and the cookie expired weekly and on every restart without a configured secret. Anyone who installed `/mobile/` must add the root address to the home screen again, sign in and allow notifications once.
