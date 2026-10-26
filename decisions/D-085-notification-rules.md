## D-85 · 2026-10-23 · Notification rules
Settings → Notifications adds quiet hours (a window that may cross midnight; sound is always off inside it; an approval or question can still notify, which is a switch), a rule per repository (everything, only things that need you, nothing), and a tray switch. Decided in `src/shared/notify.ts` so it is tested. The per-kind desktop and sound switches still apply first.
Why: user request.
