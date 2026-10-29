# helm mobile app (native)

Planned, not built yet. A native shell (Capacitor) around the unchanged helm renderer that can hold several helm instances and switch between them:

- a **hosted** instance: a URL plus a token from a pairing code, over WebSocket;
- a **desktop** instance: reached peer to peer, with no server of ours in between. The desktop opens one UDP port, learns its reachable addresses (router port forward if enabled, STUN, local and IPv6 and VPN addresses) and shows them as a share code; the phone probes all of them and talks to whichever answers first, over an encrypted, authenticated channel pinned to the desktop's key.

The p2p protocol is written once in TypeScript against a small `UdpSocket` interface (Node's `dgram` on the desktop, a thin native plugin on the phone), so it is shared and testable. The desktop side lives in `src/core/`.

The browser-only PWA for a single hosted server is `../hosted/pwa`.
