## 2026-10-29 · The mobile app and web companion are installable web apps served by the hosted server

The mobile companion is a PWA, not a native shell: `mobile-app/` builds to `/mobile/` on the hosted server, uses the phone layout on any screen, and runs nothing locally (the browser client already routes everything except clipboard/links to the server). A desktop twin, `web-companion/` at `/companion/`, is the same with the window's own layout. Both are the desktop renderer behind `HelmBridge`, started by one shared `hosted/web/boot.ts`; the two folders hold only their entry options, manifest, page and vite config. The worker, notifications code, layout trick, push store and build config are shared in `hosted/`.

Notifications arrive with the app closed by Web Push: the server (`src/push.ts`, `web-push` package) keeps a VAPID key and subscribed devices in `push.json` (0600) in its data dir, `host.notify` sends to them as well as to open pages, and the service worker stays quiet when the app is in view. `/push/*` needs the sign-in cookie. A tap opens the session.

Why a PWA and not Capacitor or React Native: a native shell needs APNs/FCM accounts, signing and a store, none of which can be built or tested here, and would still be a WebView on the same URL. The PWA gets real push on Android and on iOS 16.4+ (once added to the home screen) with no extra infrastructure. The folder split leaves room for a native wrapper later that loads the same URL. The icons are the SVG and the 180px PNG; 192/512 PNGs would suit older Android installers better.

Why: user request, with a second request that the two builds share code and keep only what is unique in their own folders (named `mobile-app` and `web-companion`).
