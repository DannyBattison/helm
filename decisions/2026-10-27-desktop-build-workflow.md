## 2026-10-27 · Desktop builds on every push to main

`.github/workflows/desktop-build.yml` builds unsigned installers (macOS dmg, Windows nsis exe, Linux AppImage) on each push to main and uploads them as workflow artifacts (14 days), so the latest client can be downloaded without cutting a release. Nothing is published and signing is disabled; `release.yml` stays the tagged, signed path that auto-update reads. Typecheck and tests are left to `ci.yml`.
