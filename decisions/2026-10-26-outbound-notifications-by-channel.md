## 2026-10-26 · Outbound notifications go through pluggable channels, email first

Notifications that leave the app (email now; Slack, webhooks later) are *channels*: each has settings under `Settings.outbound[id]` with a shared `enabled` and per-kind `kinds`, and an `OutboundChannel` in `src/core/outbound.ts` registered in one map. `core.ts` hands every notification to `dispatchOutbound`, which applies the same per-repository rules and quiet hours as desktop notifications, then sends through each wanted channel. A failing channel is logged, never thrown.

Email speaks SMTP directly (TLS, STARTTLS or none; AUTH PLAIN/LOGIN) with a small client over `node:net`/`node:tls`, so no dependency is added. Settings cover server, port, security, username, sender address and name, recipients and which events to send. The password is not in settings: it is stored encrypted by the host in `outbound-email.bin` (like the GitHub token), and the UI only learns whether one is set. A "Send test email" button reports the server's error.

A future Slack API key follows the same pattern: a secret in the vault, a settings entry, a channel in the registry.
