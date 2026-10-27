## 2026-10-27 · Attached files are capped at 360 MB together, the hosted socket's limit
Replaces the no-limit entry from earlier today. The hosted socket accepts 512 MB per message and files travel as base64 (a third larger), so attached files may add up to 360 MB; there is no per-file cap beyond that. The 10-file cap stays.
Why: user request: cap it at the hard limit.
