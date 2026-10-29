# helm hosted PWA

helm on a phone, as an installable app (a PWA) served by your hosted helm at `/mobile/`. Nothing runs on the phone but the page: it talks to the server over the same WebSocket as the browser client, so it never calls anything local. It is for one hosted server, the one it is served from; the native app in `../../mobile-app` is the one that can hold several instances.

It uses the phone layout (drawer, one column) on any touch screen, including tablets, and gets push notifications with the app closed.

## Install

1. Serve hosted helm over HTTPS (see `../README.md`). Push and installing both need it.
2. Open `https://your-server/mobile/` on the phone and sign in.
3. Android (Chrome): menu → **Install app**. iPhone/iPad (Safari): Share → **Add to Home Screen**, then open it from the home screen (iOS only allows push for installed apps, 16.4 or later).
4. Tap anywhere once and allow notifications. The app tells the server where to reach the phone.

Tapping a notification opens the session it is about. While the app is open and in view, the page shows notifications itself and the worker stays quiet.

## What is in this folder

Only what differs from the default web client: `main.ts` (the options: `layout: 'phone'`, `push: true`), `index.html`, `manifest.webmanifest` and `vite.config.ts`. Everything else is shared in `../`: `web/boot.ts` (starting a web build), `web/notifications.ts`, `web/worker/sw.js` and `src/push.ts` (notifications and Web Push), `web/layout.ts` (the phone layout on wide screens) and `vite.base.ts` (the build). `npm run build` in `hosted/` builds this to `hosted/dist/web/mobile`.
