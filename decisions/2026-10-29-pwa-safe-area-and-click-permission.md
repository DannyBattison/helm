## 2026-10-29 · PWA keeps clear of the notch and asks for notifications on click

The installed iPhone app uses `viewport-fit=cover` with a translucent status bar, so the UI drew under the Dynamic Island. `#root` now pads by `env(safe-area-inset-*)`, which is zero on desktop and in browser tabs. The notification permission prompt moved from `pointerdown` to `click`, because iOS only accepts `click` as a user activation for `Notification.requestPermission()`.
