## 2026-10-29 · The phone app is built by `mobile.yml`, which the release workflow calls, with a checkbox per platform

Replaces the manual `mobile-android.yml` mentioned in [2026-10-29-mobile-app-is-a-capacitor-project-with-a-native-udp-plugin](2026-10-29-mobile-app-is-a-capacitor-project-with-a-native-udp-plugin.md) (that file is gone). `.github/workflows/mobile.yml` builds Android and/or iOS and uploads `mobile-android` / `mobile-ios` artifacts, the way `desktop.yml` does; it can be run by hand (tick the platforms) or called by `release.yml`. GitHub's manual-run form has no multiselect, so `release.yml` now has one checkbox per thing to build: desktop installers and hosted images (both ticked by default, as before) and Android and iOS (off by default, since they are new and unproven). `publish` runs when the ticked builds succeed (unticked ones are skipped), attaches the APK and IPA to the release with the installers, and tags the images only if they were built. A release without the desktop installers is not marked "latest", so the app's auto-update ignores it.

Signing: Android is signed with the `ANDROID_*` keystore secrets if present, else a throwaway key (it installs but cannot update an install from a different run). iOS is built unsigned and, with the `IOS_*` certificate and profile secrets, re-signed with `codesign` in the job (not through xcodebuild's own signing, which trips over the CocoaPods targets); unsigned IPAs are installed with a sideloading tool. Version names come from the release version; the version code is the run number (Android) and the build number (iOS). No TestFlight or Play upload.

Said plainly: never run. Written without GitHub Actions, an Android SDK or Xcode, so expect to fix a step on the first run.

Why: user request.
