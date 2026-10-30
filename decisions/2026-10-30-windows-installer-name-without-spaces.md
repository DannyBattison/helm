## 2026-10-30 · Windows installer is named without spaces

Auto-update on Windows failed with a 404: `latest.yml` named `helm-Setup-0.11.0.exe` but GitHub stored the upload as `helm.Setup.0.11.0.exe` (it replaces spaces with dots; electron-builder's own file name was `helm Setup 0.11.0.exe`). `win.artifactName` is now `${productName}-Setup-${version}.${ext}` so the file name, the name in `latest.yml` and the name on the release agree. Releases up to v0.11.0 stay broken for Windows auto-update; the next release fixes it for builds that include this change.
