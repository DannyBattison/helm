# helm mobile app (native)

The phone app: the unchanged helm renderer, holding several helm **instances** and switching between them.

- **Hosted** instance: a server reached by URL (`hosted/`), as in the browser.
- **Desktop** instance: a computer reached directly over UDP, with no server of ours in between, using the protocol in `src/shared/p2p/` (the desktop side is `src/core/p2p/`, switched on under Settings → Phone app).

## What is here

| | |
| --- | --- |
| `src/main.ts`, `src/ui.ts` | The screens before helm's own UI: the list of computers and servers, adding one (scan the QR code or paste, then GitHub), and opening one. |
| `src/native.ts` | The UDP socket (the native plugin) and the preferences the instance list is kept in. |
| `src/headless.ts`, `collect.html` | The page the background task runs: collect and finish. |
| `src/instances.ts` | The list of instances and where it is kept. Adding a computer takes its share code; the one-time secret is dropped once it has accepted the phone, and the phone's own key for it is saved. |
| `src/github.ts`, `src/session.ts` | GitHub sign-in on the phone (device flow, no scopes), done when the app first starts, with a button to copy the code. The token is kept in the Keychain / Keystore and sent to a computer once, encrypted, when pairing with it, so it can check this is the same GitHub user as the one signed in there. It is never sent when reconnecting. Signing out (on the list screen) deletes it. |
| `src/p2pConn.ts` | An encrypted link to a computer as the connection `hosted/web/bridge.ts` wants. `createConnectionBridge(connectDesktop(...))` is a `HelmBridge` over UDP; the renderer does not know the difference. |
| `src/notices.ts` | Notifications with the app closed: `collect()` connects to each computer for a moment, shows what is waiting as local notifications, acknowledges it and leaves. Meant to be run by the OS's background task. |
| `src/scan.ts` | Reads a share code from the camera (`getUserMedia` and jsQR, in the web view; no native plugin). |
| `tests/phone.test.ts` | The phone side against the real desktop service over real UDP: pairing, GitHub check, the UI bridge, reconnecting. |

## Pairing

1. Desktop: Settings → Phone app → turn on. It shows a share code (addresses to try, the computer's key, a one-time secret; good for ten minutes).
2. Phone: Add computer → paste the code → sign in to GitHub. The desktop accepts the phone only if its GitHub user is the one signed in on the desktop.
3. Later connections need neither the secret nor GitHub: the phone is recognised by its key, for as long as the same GitHub user is signed in on the computer. Removing the phone in the desktop's settings ends it.

## Building

One-time: **Node 22 or newer** (`node -v`; with nvm, `nvm install` in the repository root reads `.nvmrc`; with Homebrew, `brew install node@22`). Older Node fails with errors like `'node:util' does not provide an export named 'styleText'`. Then `npm ci` here, in `../hosted` and in the repository root (the page is built from the shared renderer).

| Command (here, or `npm run mobile:…` from the root) | |
| --- | --- |
| `npm run build` | Builds the page into `www/`: the app (`index.html`) and the background page (`collect.html`). |
| `npm run sync` | Builds, then copies it and the plugins into `android/` and `ios/`. Run after any change to the TypeScript. |
| `npm run android` | Sync, then opens the project in Android Studio. `npm run android:run` builds and runs on a connected phone or emulator. |
| `npm run android:apk` | Sync, then builds `android/app/build/outputs/apk/debug/app-debug.apk` with Gradle (needs a JDK 21 and the Android SDK). Install it with `adb install -r` or by copying it to the phone. |
| `npm run ios` | Sync, then opens the project in Xcode (macOS only, with CocoaPods: run `pod install` in `ios/App` the first time). Pick your team under Signing & Capabilities and run on your phone. `npm run ios:run` builds and runs. |
| `npm run doctor` | Capacitor's check of the setup. |

No Android Studio or Xcode? GitHub builds it: **Actions → mobile → Run workflow** (tick Android and/or iOS) attaches an APK and/or IPA to the run, and **Actions → release → Run workflow** builds the phone apps along with the desktop installers and hosted images (tick Android and iOS there; the files are attached to the release). The Android build is signed with your keystore if the `ANDROID_*` secrets are set (see the comment at the top of `.github/workflows/mobile.yml`) and otherwise with a throwaway key; the iOS build is unsigned (install with Sideloadly or AltStore) unless the `IOS_*` secrets are set. These workflows have not been run yet.

A free Apple account can install on your own iPhone, but the app stops opening after seven days and has to be reinstalled; a paid account ($99 a year) removes that and allows TestFlight.

## The native parts

Everything else is TypeScript. These are written but **have never been compiled or run** (no Android SDK or Xcode where they were written), so expect to fix small build errors:

- `android/app/src/main/java/app/helm/mobile/`: `HelmUdp.java` (sockets), `HelmUdpPlugin.java` (the Capacitor plugin), `CollectWorker.java` (WorkManager task that runs `collect.html` in a hidden web view and shows notifications), `MainActivity.java` (registers the plugin and schedules the task).
- `ios/App/App/`: `HelmUdp.swift`, `HelmUdpPlugin.swift`, `ViewController.swift` (registers the plugin; the storyboard points at it), `BackgroundCollect.swift` (`BGAppRefreshTask` that runs `collect.html` in a hidden web view). The four files are added to `App.xcodeproj` by hand; if Xcode complains, remove and re-add them to the App target. `Info.plist` carries the camera, local-network and background-task entries.

Notifications while the app is closed arrive when the OS runs that task, typically every 15 minutes or longer; iOS may not run it for an app that is rarely opened. While the app is open they arrive at once. The first time, the app asks for permission to notify.

## Notifications and opening a session

Tapping a notification opens the app on that session: on Android the background task's notification carries a `helm://open?instance=…&session=…` link (an intent filter in the manifest), on iOS Capacitor's notification plugin reports the `instance`, `session` and `kind` fields the task put in the notification, and notifications the app shows itself carry the same fields. If that computer is already open it goes straight there; otherwise the app opens it first. See `src/open.ts`.

## Not done

- Screens beyond the list and adding a computer or server (a hosted server opens in the web view at `/mobile/`, with its own sign-in; getting back is the Android back button or the ⇄ tab on the right edge).

The browser-only PWA for one hosted server is `../hosted/pwa`.
