## 2026-11-05 · Pin the PWA root to the screen and let the status bar own the bottom inset

The installed app left a gap under the status bar: `#root` was `100dvh` with bottom safe-area padding, and iOS standalone reports a viewport shorter than the screen. `#root` is now `position: fixed; inset: 0` with only top and side padding for the notch. The status bar grows by `env(safe-area-inset-bottom)` and paints its background under the home indicator, so it sits on the bottom edge.
