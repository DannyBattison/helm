## D-95 · 2026-10-24 · Main's app icon wins over the icon drawn for the tray work
Both D-065 (main) and D-079 (this branch) added `build/icon.png`. The wheel in a circle from D-065 is kept, since it has a source (`build/icon.svg`) and an `.icns` rendered from it; the tray images in `resources/` are unchanged. The two `extraResources` lists in `package.json` are joined into one, because a duplicate key in JSON silently keeps only the last and the packaged app would have lost `build/icon.png`. The macOS build points at `build/icon.icns`.
Why: merging main into this branch.
