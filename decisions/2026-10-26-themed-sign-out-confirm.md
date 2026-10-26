## 2026-10-26 · Themed confirm dialog for GitHub sign-out

Settings > Account sign-out used the native `confirm()`. It now uses the app's `Dialog` with a danger button. No native `confirm`/`alert`/`prompt` calls remain; only the OS file pickers stay native.
