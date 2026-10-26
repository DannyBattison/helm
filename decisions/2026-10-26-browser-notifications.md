## 2026-10-26 · Hosted notifications are shown by the browser

The hosted server's `host.notify` sends a `notify` event; `web/bridge.ts` shows it with the Web Notifications API when the tab is unfocused. Permission is requested on the first click (browsers require a gesture). Buttons on notifications are not supported (they need a service worker). Needs HTTPS or localhost.
