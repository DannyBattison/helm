# helm web companion

Use your helm desktop app from a browser on another device, such as a phone or another laptop, while the app keeps running on its own computer. The browser shows the same interface as the desktop app (the phone layout when the window is narrow) and works on the same sessions, and notifications reach it with the page closed.

```
browser ──▶ relay ◀── helm desktop app
  (both connect out; nothing on the desktop needs to be reachable)
```

The relay is a small Node server in `relay/` that you run somewhere both can reach, behind HTTPS. It serves the companion page, signs browsers in with GitHub, pairs them with a desktop app, and passes messages between them.

## Setting up

1. Run the relay (Node 22):
   ```
   cd web-companion && npm ci && npm run build
   HELM_RELAY_SECRET=$(openssl rand -hex 32) npm start     # listens on 127.0.0.1:8788
   ```
   Put a TLS reverse proxy in front of it (Caddy: `companion.example.com { reverse_proxy 127.0.0.1:8788 }`). Websockets must pass through and the `Host` header must be kept. Keep `HELM_RELAY_SECRET` stable, or everyone is signed out and unpaired on restart.
2. In the desktop app: **Settings → Browser companion**, turn it on and enter the relay's address. A pairing code appears.
3. In the browser, open the relay's address, **Sign in with GitHub** (as the account helm is signed in with; no permissions are requested, it only learns the username), and enter the code. It works once and for ten minutes, then a new one appears.
4. Install it from the browser's menu to get its own window and push notifications (needs HTTPS; on iPhone, Add to Home Screen first).

A reload goes straight in. **Sign out all browsers** in the desktop settings ends every pairing.

## What is trusted

- The relay learns usernames, and it carries everything the browser sees and does (it does not read it, but it could). Run your own, behind TLS. It keeps no GitHub token.
- A browser only meets a desktop app signed in as the same GitHub username, and only with that app's current code: single use, 10 minutes, guesses rate limited.
- A paired browser can do what the desktop window can, including the terminal and settings, except what acts on that computer (open a folder, copy). Treat pairing like handing someone your keyboard.
- Notifications cross the relay as Web Push so they can reach a closed page. Their text is in the payload.

## What is in this folder

Only what belongs to this build: `relay/` (the server), `pairing.ts` (sign-in and code screen), `main.ts`, `index.html`, `manifest.webmanifest`, `vite.config.ts`. The desktop side is `src/core/tunnel.ts`. Shared with the other web builds, in `hosted/`: the web client's start-up (`web/boot.ts`), notifications and the service worker, the Web Push store (`src/push.ts`), static serving and cookies (`src/static.ts`, `src/gate.ts`), and the vite config (`vite.base.ts`).

| Variable | Meaning |
| --- | --- |
| `HELM_RELAY_SECRET` | Signs cookies. 32+ random characters. |
| `PORT`, `HOST` | Default 8788 on `127.0.0.1`. |
| `HELM_RELAY_DATA_DIR` | Where push subscriptions are kept. Default `~/.helm-relay`. |
| `HELM_GITHUB_CLIENT_ID` | Another GitHub OAuth app (device flow enabled). Default is helm's. |
| `HELM_RELAY_ORIGINS`, `HELM_RELAY_SECURE_COOKIE`, `HELM_RELAY_WEB`, `HELM_HOSTED_PUSH_CONTACT` | Extra allowed origins, force the Secure flag, another web root, the push contact address. |
