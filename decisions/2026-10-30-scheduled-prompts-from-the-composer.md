## 2026-10-30 · Scheduled prompts are set from the session composer

A clock button beside the paperclip opens a small popup: the prompt, a date and time, and a repeat (once, hourly, daily, weekdays, weekly). Scheduled prompts live on the session (`scheduled`), so they sync and persist with it, and core sends them through the normal `send` every 15 seconds. A repeating prompt moves to its next slot before it sends, and a missed run fires once rather than catching up. Archived sessions do not send.
