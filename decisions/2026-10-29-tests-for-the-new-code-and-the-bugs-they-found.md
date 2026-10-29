## 2026-10-29 · Tests for the phone, web and p2p code, and the bugs they found

Whole-repo coverage went from 93.6% statements, 89.0% branches, 89.3% functions and 97.0% lines to 96.3%, 92.0%, 93.0% and 98.6% (the same command CI uses, `vitest run --coverage`). Every new file is at 90% or more on lines, branches and functions, and none was left out of the report: the phone app (`mobile/src`, with jsdom and mocked Capacitor plugins, including the screens in `main.ts`), the web client (`hosted/web`, the service worker, `static.ts`, `host.ts`), the p2p protocol (`src/shared/p2p`), and the desktop side (`src/core/p2p`). `jsdom` is a dev dependency, used per test file. `hosted/tests/web-*.test.ts` are typechecked by `hosted/tsconfig.web.json` (they need DOM types), not the server one.

Real bugs found by writing them, each fixed and kept as a regression test:
- the shared bridge left an unhandled rejection if the connection dropped while it refreshed the state after a reconnect;
- the phone app never showed why a camera scan failed (the error went to a page that was redrawn at once);
- a host whose `authorize` threw immediately let the throw escape the socket callback and left that first message marked as being decided, so a retry was ignored;
- one damaged reply from a probed address made the real reply fail, because finishing the handshake changed its state before checking the reply (now done on a copy);
- a link whose peer went silent closed at 100 s, not the intended 75 s (the 25 s check used `>`; now `>=`);
- a second STUN server that would not resolve threw away the first server's good answer;
- switching the phone service off left the router forwarding showing as mapped;
- saves of the pairing file were fire-and-forget and could overlap, leaving a file that no longer parsed and losing the identity and every pairing; they are now one at a time, written to a temporary file and renamed, and `shutdown()` waits for the last one.

Not covered on purpose: `hosted/src/server.ts` (the entry point, which starts the whole core), the native Java and Swift, and unreachable defensive branches the test authors listed (for example guards behind checks that already return).

Why: user request (90 to 95% on Codecov).
