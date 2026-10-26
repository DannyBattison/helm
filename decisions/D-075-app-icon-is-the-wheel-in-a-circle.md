## D-75 · 2026-10-24 · App icon is the wheel in a circle
The app icon is the helm wheel, white on a dark circle with transparent corners. The source is `build/icon.svg`; `build/icon.png` and `build/icon.icns` are rendered from it. electron-builder picks up `build/icon.icns` for the macOS app, and the window and dock icon are set at run time so it also shows when running in development.
Why: user request.
