## D-96 · 2026-10-24 · App icon: accent wheel on the dark background, transparent outside the circle
`build/icon.svg` now draws the wheel in the accent colour (`--violet-500`, #a78bfa) on a flat circle in the dark theme's app background (`--gray-50`, #0e0e12) instead of a white wheel on a gradient. `build/icon.png` and `build/icon.icns` are re-rendered from it with a real alpha channel, so everything outside the circle is fully transparent.
Why: user request.
