# helm mobile app (native)

The phone app: the unchanged helm renderer, holding several helm **instances** and switching between them.

- **Hosted** instance: a server reached by URL (`hosted/`), as in the browser.
- **Desktop** instance: a computer reached directly over UDP, with no server of ours in between, using the protocol in `src/shared/p2p/` (the desktop side is `src/core/p2p/`, switched on under Settings → Phone app).

## What is here

| | |
| --- | --- |
| `src/instances.ts` | The list of instances and where it is kept. Adding a computer takes its share code; the one-time secret is dropped once it has accepted the phone, and the phone's own key for it is saved. |
| `src/github.ts` | GitHub sign-in on the phone (device flow, no scopes) to show the computer which GitHub user this is. The token is sent once, encrypted, when pairing, and not kept. |
| `src/p2pConn.ts` | An encrypted link to a computer as the connection `hosted/web/bridge.ts` wants. `createConnectionBridge(connectDesktop(...))` is a `HelmBridge` over UDP; the renderer does not know the difference. |
| `src/notices.ts` | Notifications with the app closed: `collect()` connects to each computer for a moment, shows what is waiting as local notifications, acknowledges it and leaves. Meant to be run by the OS's background task. |
| `src/scan.ts` | Reads a share code from the camera (`getUserMedia` and jsQR, in the web view; no native plugin). |
| `tests/phone.test.ts` | The phone side against the real desktop service over real UDP: pairing, GitHub check, the UI bridge, reconnecting. |

## Pairing

1. Desktop: Settings → Phone app → turn on. It shows a share code (addresses to try, the computer's key, a one-time secret; good for ten minutes).
2. Phone: Add computer → paste the code → sign in to GitHub. The desktop accepts the phone only if its GitHub user is the one signed in on the desktop.
3. Later connections need neither the secret nor GitHub: the phone is recognised by its key, for as long as the same GitHub user is signed in on the computer. Removing the phone in the desktop's settings ends it.

## Not built yet

- **The native shell and UDP plugin.** The protocol runs in TypeScript in the web view and needs only a `UdpSocket` (`send(data, host, port)`, `onMessage`, `close`) from the platform: a Capacitor plugin with a UDP socket on iOS (Network.framework or BSD sockets) and Android (`DatagramSocket`), IPv4 and IPv6, that delivers each received datagram with its sender's address. Everything else is TypeScript. None of it has run on a phone. iOS will ask for local-network permission the first time it talks to a computer on the same network.
- **Capacitor project and instance list screens.** `scan.ts` needs the camera permission declared in the app (`NSCameraUsageDescription`, `CAMERA`), and a screen with a `<video>` to call it from.
- **The background task that calls `collect()`.** iOS background app refresh (`BGAppRefreshTask`) and Android WorkManager decide when it runs: typically every 15 minutes or longer, and iOS may not run it at all for an app that is rarely opened. So a notification can be late, by many minutes. It needs the local notifications plugin to show them. For prompt delivery on Android, a foreground service holding the connection open is possible (a permanent notification and more battery).
- UPnP and NAT-PMP on the desktop: the router's port can be forwarded by hand, and the port is settable.

The browser-only PWA for one hosted server is `../hosted/pwa`.
