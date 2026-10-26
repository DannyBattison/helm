## D-114 · 2026-10-25 · Dialogs and select menus are clamped to the viewport on phones
The dialog overlay's grid track is now `minmax(0, 1fr)`, so a nowrap child (a select label, a branch name, a folder path) can no longer stretch the dialog past the screen; this was making New session overflow horizontally. Select menus are limited to the viewport width and truncate long labels.
Why: user report, New session modal overflowed horizontally on mobile.
